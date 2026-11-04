import { describe, expect, it } from "vitest";

import { resolveTitle } from "../src/article.js";

describe("标题定夺", () => {
  it("显式 --title 优先", () => {
    expect(resolveTitle("显式标题", { content: "# 正文H1" })).toBe("显式标题");
  });

  it("--title 缺省时取正文首个 H1", () => {
    expect(
      resolveTitle(undefined, { content: "前言\n# 第一个\n## 二级\n# 第二个", h1Title: "第一个" }),
    ).toBe("第一个");
  });

  it("都没有时报可行动的错误", () => {
    expect(() => resolveTitle(undefined, { content: "没有一级标题" })).toThrow(/--title/);
    expect(() => resolveTitle("   ", { content: "x", h1Title: "y" })).toThrow(/--title/);
  });
});
