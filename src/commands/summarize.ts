import { readArticle, resolveTitle } from "../article.js";
import { createAdminClient } from "../admin.js";

export interface SummarizeOptions {
  file: string;
  title?: string;
  account?: string;
  maxLength?: number;
  json: boolean;
}

/** wxpub summarize：AI 生成文章摘要（digest 候选；ai:summary 权限）。 */
export async function runSummarize(options: SummarizeOptions): Promise<void> {
  const article = await readArticle(options.file);
  const title = resolveTitle(options.title, article);
  const client = createAdminClient();
  const summary = await client.summarize({
    title,
    content: article.content,
    maxLength: options.maxLength,
    account: options.account,
  });
  if (options.json) {
    console.log(JSON.stringify({ title, summary }));
    return;
  }
  console.log(summary);
}
