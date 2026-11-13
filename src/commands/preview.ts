import { writeFile } from "node:fs/promises";

import { createAdminClient } from "../admin.js";
import { readArticle } from "../article.js";

export interface PreviewOptions {
  file: string;
  theme: string;
  out?: string;
  json: boolean;
}

/** wxpub preview：按主题 key 渲染公众号样式 HTML（登录通道）。 */
export async function runPreview(options: PreviewOptions): Promise<void> {
  const article = await readArticle(options.file);
  const client = createAdminClient();
  const html = await client.previewTheme({ themeKey: options.theme, content: article.content });
  if (options.out) {
    await writeFile(options.out, html, "utf8");
    if (options.json) {
      console.log(JSON.stringify({ theme: options.theme, out: options.out, chars: html.length }));
    } else {
      console.log(`已写出 ${options.out}（${html.length} 字符，主题 ${options.theme}）`);
    }
    return;
  }
  if (options.json) {
    console.log(JSON.stringify({ theme: options.theme, html }));
    return;
  }
  console.log(html);
}
