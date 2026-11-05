#!/usr/bin/env node

import { createRequire } from "node:module";

import { Command } from "commander";

import { WxpubApiError } from "./client.js";
import { runImage } from "./commands/image.js";
import { runLogin } from "./commands/login.js";
import { runMaterials } from "./commands/materials.js";
import { runMe } from "./commands/me.js";
import { runPublish } from "./commands/publish.js";
import { runTheme } from "./commands/theme.js";

// 版本号单一真源 = package.json（发版只改那里，--version 永远同步）
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const program = new Command();

program
  .name("wxpub")
  .description("公众号发文 CLI — markdown 直投草稿箱（wechat-publish-service 客户端）")
  .version(version)
  .option("--json", "输出 JSON（供 coding agent / 程序消费）", false);

program
  .command("login")
  .description("配置服务地址与 API Key（保存到 ~/.wxpub/config.json）")
  .requiredOption("--base-url <url>", "服务地址，如 https://yyps.net")
  .requiredOption("--api-key <key>", "API Key（sk_…）")
  .action((options) => {
    runLogin(options);
  });

program
  .command("me")
  .description("查看登录态与服务健康")
  .action(async () => {
    await runMe({ json: program.opts().json });
  });

program
  .command("publish")
  .description("投递 markdown 文章到公众号草稿箱")
  .requiredOption("-a, --account <key>", "公众号账号 key（如 danxin）")
  .requiredOption("-f, --file <path>", "markdown 文件路径")
  .option("-t, --title <title>", "标题；缺省取正文首个 # 一级标题")
  .option("--digest <text>", "分享摘要（≤54 字）")
  .option("--author <name>", "笔名；缺省用服务端账号配置")
  .option(
    "--cover <mode>",
    "封面策略：ai=AI出图(默认) / auto=服务端兜底 / provided=用固定封面 / none",
    undefined,
  )
  .option("--cover-prompt <text>", "cover=ai 时的画面提示词；缺省由服务端 LLM 提炼")
  .option("--thumb <mediaId>", "cover=provided 时的封面素材 media_id")
  .option("--force", "跳过幂等去重，强制创建新草稿", false)
  .action(async (options) => {
    await runPublish({ ...options, json: program.opts().json });
  });

program
  .command("theme")
  .description("查询账号默认主题")
  .requiredOption("-a, --account <key>", "公众号账号 key")
  .action(async (options) => {
    await runTheme({ ...options, json: program.opts().json });
  });

program
  .command("materials")
  .description("查询账号永久素材列表")
  .requiredOption("-a, --account <key>", "公众号账号 key")
  .option("--type <type>", "素材类型（默认 image）")
  .option("--offset <n>", "偏移量", (value) => Number.parseInt(value, 10))
  .option("--count <n>", "每页条数（1-20）", (value) => Number.parseInt(value, 10))
  .action(async (options) => {
    await runMaterials({ ...options, json: program.opts().json });
  });

program
  .command("image")
  .description("上传本地图片为微信永久素材，输出可内嵌正文的 mmbiz URL")
  .requiredOption("-a, --account <key>", "公众号账号 key")
  .requiredOption("-f, --file <path>", "图片文件路径")
  .action(async (options) => {
    await runImage({ ...options, json: program.opts().json });
  });

program.parseAsync().catch((err: unknown) => {
  if (err instanceof WxpubApiError) {
    console.error(`✗ ${err.message}`);
  } else if (err instanceof Error) {
    console.error(`✗ ${err.message}`);
  } else {
    console.error("✗ 未知错误", err);
  }
  process.exitCode = 1;
});
