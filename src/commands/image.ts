import { readFile } from "node:fs/promises";
import path from "node:path";

import { WxpubClient } from "../client.js";
import { resolveConfig } from "../config.js";

export interface ImageOptions {
  account: string;
  file: string;
  json: boolean;
}

/** wxpub image：本地图片上传为微信永久素材，输出可内嵌正文的 mmbiz URL。 */
export async function runImage(options: ImageOptions): Promise<void> {
  const config = resolveConfig();
  const bytes = await readFile(options.file);
  const fileName = path.basename(options.file);
  const client = new WxpubClient(config);
  const result = await client.uploadImage(options.account, fileName, bytes);
  if (options.json) {
    console.log(JSON.stringify({ media_id: result.mediaId, url: result.url ?? null }));
    return;
  }
  console.log(`✓ 已上传永久素材`);
  console.log(`  media_id：${result.mediaId}`);
  if (result.url) {
    console.log(`  正文插图：![](${result.url})`);
  }
}
