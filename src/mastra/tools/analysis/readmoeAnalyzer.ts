import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { google } from "../../models";
import { Agent } from "@mastra/core";

/**
 * ミニエージェントの定義
 *
 * 注意: このファイル内で直接Agentを定義する理由：
 * 循環参照の問題を回避するため。
 *
 * 問題：
 * 1. src/mastra/agents/index.tsがreadmeAnalyzerToolをインポート
 * 2. readmeAnalyzerToolがAgentをインポートすると循環参照が発生
 * 3. 「ReferenceError: Cannot access 'readmeAnalyzerTool' before initialization」エラーが発生
 *
 * 解決策：
 * ローカルでAgentインスタンスを作成し、循環参照を断ち切る
 */
const miniAgent = new Agent({
  model: google("gemini-2.0-flash-001"),
  name: "miniAgent",
  instructions:
    "あなたはGitHubリポジトリを解析して、Cursor AIアシスタントのためのルールセット（チートシート）を生成するエージェントです。",
});

// READMEの解析ツール
export const readmeAnalyzerTool = createTool({
  id: "readme-analyzer",
  description:
    "リポジトリのREADMEファイルを解析して重要な情報を構造化データとして抽出します",
  inputSchema: z.object({
    repositoryPath: z.string().describe("リポジトリのパス"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    content: z.string().optional(),
    metadata: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        architecture: z.string().optional(),
        installation: z.string().optional(),
        usage: z.string().optional(),
        contributing: z.string().optional(),
        license: z.string().optional(),
      })
      .optional(),
  }),
  execute: async ({ context }) => {
    const { repositoryPath } = context;

    try {
      // READMEファイルの候補リスト
      const readmeVariants = [
        "README.md",
        "Readme.md",
        "readme.md",
        "README",
        "README.markdown",
        "README.txt",
      ];

      //　READMEファイルの探索
      let readmeContent = "";
      let readmePath = "";

      for (const variant of readmeVariants) {
        const filePath = path.join(repositoryPath, variant);
        try {
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            readmePath = filePath;
            readmeContent = await fs.readFile(filePath, "utf-8");
            break;
          }
        } catch (error) {
          // ファイルが存在しない場合は次のVariant を試す
          // biome-ignore lint/correctness/noUnnecessaryContinue: <explanation>
          continue;
        }
      }

      if (!readmeContent) {
        return {
          success: false,
          message: "READMEファイルが見つかりませんでした。",
        };
      }

      // AIモデルを使用してメタデータを抽出
      const metadata = await extractMetadataWithAI(readmeContent);

      return {
        success: true,
        message: `READMEファイル ${readmePath}の解析が完了しました。`,
        content: readmeContent,
        metadata,
      };
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    } catch (error: any) {
      return {
        success: false,
        message: `READMEファイルの解析中にエラーが発生しました: ${error.message}`,
      };
    }
  },
});

/**
 * AIモデルを使用してREADMEファイルからメタデータを抽出する関数
 */
async function extractMetadataWithAI(content: string): Promise<{
  title: string;
  description: string;
  technologies: string[];
  architecture: string;
  installation: string;
  usage: string;
  contributing: string;
  license: string;
}> {
  // デフォルト値を設定
  const defaultMetadata = {
    title: "",
    description: "",
    technologies: [],
    architecture: "",
    installation: "",
    usage: "",
    contributing: "",
    license: "",
  };
  try {
    // AIモデル用のプロンプト
    const promptText = `
あなたはREADMEファイルから構造化されたメタデータを抽出する専門家です。
以下のREADMEファイルの内容を解析し、JSONフォーマットで以下の情報を抽出してください：

1. title: プロジェクトのタイトル（通常は最初の見出し）
2. description: プロジェクトの簡潔な説明
3. technologies: プロジェクトで使用されている技術スタックのリスト（配列形式）
4. architecture: プロジェクトのアーキテクチャや構造の説明
5. installation: インストール手順
6. usage: 使用方法
7. contributing: コントリビューションに関する情報
8. license: ライセンス情報

見つからない情報については空文字列または空配列を返してください。技術スタックは単語のリストとして抽出してください。

README内容:
${content}

JSON形式での回答のみ返してください：
`;

    const result = await miniAgent.generate(promptText).then((res) => res.text);

    console.log(result);

    // JSONを抽出
    const jsonMatch =
      result.match(/```json\n([\s\S]*?)\n```/) || result.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      // JSONを抽出してパース
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const extractedData = JSON.parse(jsonStr);

      // 必要なフィールドがあることを確認し、デフォルト値とマージ
      return {
        ...defaultMetadata,
        ...extractedData,
        // 技術スタックが文字列の場合は配列に変換
        technologies: Array.isArray(extractedData.technologies)
          ? extractedData.technologies
          : typeof extractedData.technologies === "string"
          ? [extractedData.technologies]
          : defaultMetadata.technologies,
      };
    }

    // JSONの抽出に失敗した場合
    console.warn(
      "AIモデルからJSONを抽出できませんでした。デフォルト値を使用します。"
    );
    return defaultMetadata;
  } catch (error) {
    console.error(
      "AIモデルによるメタデータ抽出中にエラーが発生しました:",
      error
    );
    return defaultMetadata;
  }
}
