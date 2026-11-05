import { readFile } from "node:fs/promises";

import { WxpubClient } from "../client.js";
import { resolveConfig } from "../config.js";

export interface IllustrateOptions {
  account: string;
  file: string;
  title?: string;
  presetId?: number;
  json: boolean;
}

/** AI 生图含出图+上传全链路，10-60s 常态，给足超时余量 */
const ILLUSTRATE_TIMEOUT_MS = 180_000;

/** wxpub illustrate：AI 生成正文配图，输出可直接粘贴进 markdown 的插图片段。 */
export async function runIllustrate(options: IllustrateOptions): Promise<void> {
  const config = resolveConfig();
  const text = await readFile(options.file, "utf8");
  const client = new WxpubClient({ ...config, timeoutMs: ILLUSTRATE_TIMEOUT_MS });
  const result = await client.generateIllustration(options.account, text, {
    title: options.title,
    presetId: options.presetId,
  });
  if (options.json) {
    console.log(
      JSON.stringify({
        media_id: result.mediaId ?? null,
        url: result.url ?? null,
        markdown: result.markdown ?? null,
      }),
    );
    return;
  }
  console.log(`✓ 配图已生成并上传永久素材`);
  if (result.prompt) {
    console.log(
      `  画面 prompt：${result.prompt.slice(0, 80)}${result.prompt.length > 80 ? "…" : ""}`,
    );
  }
  if (result.mediaId) {
    console.log(`  media_id：${result.mediaId}`);
  }
  if (result.markdown) {
    console.log(`\n  插入正文：${result.markdown}`);
  }
}
