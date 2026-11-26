import { describe, it, expect } from "vitest";
import { readArticle, resolveTitle, resolveDigest } from "../src/article.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("article front-matter（元数据随文件走）", () => {
  it("解析 --- 块的 title/digest 并从正文剥离；--digest/--title 仍最高优先", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wxpub-fm-"));
    const f = join(dir, "a.md");
    await writeFile(f, `---\ntitle: 文件头标题\ndigest: 文件头摘要，两下点击 3 秒\n---\n\n# 正文标题\n\n正文内容`, "utf8");
    const article = await readArticle(f);
    expect(article.frontTitle).toBe("文件头标题");
    expect(article.frontDigest).toBe("文件头摘要，两下点击 3 秒");
    expect(article.h1Title).toBe("正文标题");
    // 正文剥离 front-matter 与首行 H1（标题走草稿标题字段，不重复出现在正文）
    expect(article.content.startsWith("---")).toBe(false);
    expect(article.content).not.toContain("# 正文标题");
    expect(article.content).toContain("正文内容");
    // 决策链：显式 > front-matter > H1 / 无
    expect(resolveTitle("显式标题", article)).toBe("显式标题");
    expect(resolveTitle(undefined, article)).toBe("文件头标题");
    expect(resolveDigest("显式摘要", article)).toBe("显式摘要");
    expect(resolveDigest(undefined, article)).toBe("文件头摘要，两下点击 3 秒");
    await rm(dir, { recursive: true });
  });

  it("无 front-matter 的普通文件不受影响（首行 H1 照旧提取并剥离、digest 为空）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wxpub-fm2-"));
    const f = join(dir, "b.md");
    await writeFile(f, `# 只有标题\n\n正文里的 --- 分隔线不算 front-matter`, "utf8");
    const article = await readArticle(f);
    expect(article.h1Title).toBe("只有标题");
    expect(article.frontDigest).toBeUndefined();
    expect(article.frontTitle).toBeUndefined();
    expect(article.content).not.toContain("# 只有标题");
    expect(article.content).toContain("--- 分隔线不算");
    await rm(dir, { recursive: true });
  });

  it("正文中段的 H1 不剥离（可能是章节结构，只有首行 H1 是标题重复）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wxpub-fm4-"));
    const f = join(dir, "d.md");
    await writeFile(f, `开头一段引子文字。\n\n# 中段章节标题\n\n小节内容`, "utf8");
    const article = await readArticle(f);
    expect(article.content).toContain("# 中段章节标题");
    expect(article.content).toContain("开头一段引子文字");
    await rm(dir, { recursive: true });
  });

  it("空串 digest 归一为 undefined（不把空摘要发上服务端）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wxpub-fm3-"));
    const f = join(dir, "c.md");
    await writeFile(f, `---\ndigest:   \n---\n\n# t`, "utf8");
    const article = await readArticle(f);
    expect(resolveDigest(undefined, article)).toBeUndefined();
    await rm(dir, { recursive: true });
  });
});
