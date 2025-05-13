import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// 統計分析ツール
// リポジトリの言語統計情報を分析し、コード複雑度や保守性も分析します。
export const tokeiAnalyzerTool = createTool({
  id: "tokei-analyzer",
  description: "tokeiを使ってリポジトリの言語統計とコード複雑度を分析します",
  inputSchema: z.object({
    repositoryPath: z.string().describe("リポジトリのパス"),
    format: z
      .enum(["json", "toml", "cbor", "yaml"])
      .optional()
      .default("json")
      .describe("出力フォーマット"),
    sortBy: z
      .enum(["files", "lines", "code", "comments", "blanks"])
      .optional()
      .default("lines")
      .describe("ソート方法"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    statistics: z.any().optional(),
    languageSummary: z
      .record(
        z.string(),
        z.object({
          files: z.number(),
          lines: z.number(),
          code: z.number(),
          comments: z.number(),
          blanks: z.number(),
          complexity: z.number().optional(),
        })
      )
      .optional(),
    totalSummary: z
      .object({
        files: z.number(),
        lines: z.number(),
        code: z.number(),
        comments: z.number(),
        blanks: z.number(),
        commentRatio: z.number(),
      })
      .optional(),
  }),
  execute: async ({ context }) => {
    const { repositoryPath, format, sortBy } = context;

    try {
      // tokei コマンドがインストールされているか確認
      try {
        await execAsync("which tokei");
      } catch (error) {
        return {
          success: false,
          message:
            'tokeiがインストールされていません。"brew install tokei" または "cargo install tokei" でインストールしてください。',
        };
      }

      // tokeiコマンドを構築
      let command = `cd "${repositoryPath}" && tokei --output ${format}`;
      if (sortBy) {
        command += ` --sort ${sortBy}`;
      }

      // tokeiコマンド実行
      const { stdout, stderr } = await execAsync(command);
      if (stderr) {
        return {
          success: false,
          message: `tokeiの実行中にエラーが発生しました: ${stderr}`,
        };
      }

      // 結果をパース
      let statistics: Record<string, unknown> | string;
      try {
        statistics = format === "json" ? JSON.parse(stdout) : stdout;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `tokeiの出力をパースできませんでした: ${errMsg}`,
        };
      }

      // 言語ごとのサマリーを作成
      const languageSummary: Record<
        string,
        {
          files: number;
          lines: number;
          code: number;
          comments: number;
          blanks: number;
          complexity?: number;
        }
      > = {};

      let totalFiles = 0;
      let totalLines = 0;
      let totalCode = 0;
      let totalComments = 0;
      let totalBlanks = 0;

      if (format === "json") {
        type TokeiLanguageStats = {
          blanks: number;
          code: number;
          comments: number;
          files: number;
          lines: number;
        };

        for (const [lang, data] of Object.entries(
          statistics as Record<string, TokeiLanguageStats>
        )) {
          if (lang !== "Total") {
            const { blanks, code, comments, files, lines } = data;

            languageSummary[lang] = {
              files,
              lines,
              code,
              comments,
              blanks,
              // 複雑度の計算（仮の計算方法、実際にはもっと複雑）
              complexity: Math.round((comments / (code || 1)) * 100) / 100,
            };

            totalFiles += files;
            totalLines += lines;
            totalCode += code;
            totalComments += comments;
            totalBlanks += blanks;
          }
        }
      }

      const totalSummary = {
        files: totalFiles,
        lines: totalLines,
        code: totalCode,
        comments: totalComments,
        blanks: totalBlanks,
        commentRatio:
          Math.round((totalComments / (totalCode || 1)) * 100) / 100,
      };

      return {
        success: true,
        message: "tokeiによる言語統計分析が完了しました。",
        statistics,
        languageSummary,
        totalSummary,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `tokeiの実行に失敗しました: ${errMsg}`,
      };
    }
  },
});
