import { WxpubClient } from "../client.js";
import { readArticle, resolveDigest, resolveTitle } from "../article.js";
import { resolveConfig } from "../config.js";

export interface PublishOptions {
  account: string;
  file: string;
  title?: string;
  digest?: string;
  author?: string;
  cover?: "ai" | "auto" | "provided" | "none";
  coverPrompt?: string;
  thumbMediaId?: string;
  force?: boolean;
  json: boolean;
}

/** wxpub publish：markdown 直投公众号草稿箱。 */
export async function runPublish(options: PublishOptions): Promise<void> {
  const config = resolveConfig();
  const article = await readArticle(options.file);
  const title = resolveTitle(options.title, article);
  const digest = resolveDigest(options.digest, article);
  const client = new WxpubClient(config);
  const result = await client.publish({
    account: options.account,
    title,
    content: article.content,
    digest,
    author: options.author,
    cover: options.cover,
    coverImagePrompt: options.coverPrompt,
    thumbMediaId: options.thumbMediaId,
    forcePublish: options.force,
  });
  if (options.json) {
    console.log(
      JSON.stringify({ ok: result.ok, media_id: result.mediaId, duplicate: result.duplicate }),
    );
    return;
  }
  const dedupNote = result.duplicate ? "（内容未变，幂等去重，未新建草稿）" : "";
  console.log(`✓ 已投递到草稿箱${dedupNote}`);
  console.log(`  标题：${title}`);
  console.log(`  账号：${options.account}`);
  if (result.mediaId) {
    console.log(`  media_id：${result.mediaId}`);
  }
  if (!digest && !result.duplicate) {
    console.log("  ⚠ 未设置摘要（分享卡/会话列表将截正文开头）——建议 --digest 或文件头 front-matter `digest:`");
  }
  if (options.cover === "ai" || (!options.cover && !result.duplicate)) {
    console.log("  封面：AI 出图为后台异步任务，稍后可在公众号后台确认");
  }
}
