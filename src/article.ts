import { readFile } from "node:fs/promises";

/** 读取的文章：Markdown 原文 + 从首个 H1 提取的候选标题。 */
export interface Article {
  content: string;
  /** 正文首个 `# 一级标题`；无 H1 时为 undefined */
  h1Title?: string;
}

/** 读取 Markdown 文件并提取 H1 标题（--title 缺省时的标题来源）。 */
export async function readArticle(filePath: string): Promise<Article> {
  const content = await readFile(filePath, "utf8");
  const match = content.match(/^#\s+(.+?)\s*$/m);
  return { content, h1Title: match ? match[1].trim() : undefined };
}

/** 标题定夺：显式 --title > 正文 H1；都缺时报错（草稿箱必须标题）。 */
export function resolveTitle(explicitTitle: string | undefined, article: Article): string {
  const title = (explicitTitle ?? article.h1Title ?? "").trim();
  if (!title) {
    throw new Error("缺少标题：用 --title 指定，或在正文开头写一行 `# 标题`");
  }
  return title;
}
