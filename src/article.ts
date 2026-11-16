import { readFile } from "node:fs/promises";

/** 读取的文章：Markdown 正文 + front-matter/H1 提取的候选元数据。 */
export interface Article {
  /** 已剥离 front-matter 块的正文（元数据不进草稿正文） */
  content: string;
  /** 正文首个 `# 一级标题`；无 H1 时为 undefined */
  h1Title?: string;
  /** front-matter `digest:`；分享摘要的缺省来源 */
  frontDigest?: string;
  /** front-matter `title:`；优先级低于 --title、高于 H1 */
  frontTitle?: string;
}

/**
 * 解析文件头 front-matter（`---` 围栏内的 `key: value` 行）并从正文剥离。
 * 零依赖手写：只认文件首行 `---` 开头、至下一行 `---` 的块；无块则原样返回。
 */
function splitFrontMatter(raw: string): { body: string; meta: Record<string, string> } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: raw, meta: {} };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { body: raw.slice(m[0].length), meta };
}

/** 读取 Markdown 文件，提取 front-matter 元数据与 H1 标题。 */
export async function readArticle(filePath: string): Promise<Article> {
  const raw = await readFile(filePath, "utf8");
  const { body, meta } = splitFrontMatter(raw);
  const match = body.match(/^#\s+(.+?)\s*$/m);
  return {
    content: body,
    h1Title: match ? match[1].trim() : undefined,
    frontDigest: meta.digest || undefined,
    frontTitle: meta.title || undefined,
  };
}

/** 标题定夺：显式 --title > front-matter title > 正文 H1；都缺时报错（草稿箱必须标题）。 */
export function resolveTitle(explicitTitle: string | undefined, article: Article): string {
  const title = (explicitTitle ?? article.frontTitle ?? article.h1Title ?? "").trim();
  if (!title) {
    throw new Error("缺少标题：用 --title 指定，或在正文开头写一行 `# 标题`（也可文件头 front-matter `title:`）");
  }
  return title;
}

/** 摘要定夺：显式 --digest > front-matter digest > 无（空摘要=微信截正文开头，通常效果差）。 */
export function resolveDigest(explicitDigest: string | undefined, article: Article): string | undefined {
  return (explicitDigest ?? article.frontDigest ?? undefined)?.trim() || undefined;
}
