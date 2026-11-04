import { describe, expect, it } from "vitest";

import { buildPublishPayload } from "../src/client.js";

describe("buildPublishPayload（wire 契约）", () => {
  it("必填字段与传输字段名：content_format=markdown + timestamp + nonce", () => {
    const payload = buildPublishPayload(
      { account: "danxin", title: "标题", content: "# 你好" },
      () => 1_730_000_000,
      () => "abc123",
    );
    expect(payload.account).toBe("danxin");
    expect(payload.title).toBe("标题");
    expect(payload.content).toBe("# 你好");
    // 渲染与主题判定在服务端：markdown 直传是契约核心
    expect(payload.content_format).toBe("markdown");
    expect(payload.timestamp).toBe(1_730_000_000);
    expect(payload.nonce).toBe("abc123");
  });

  it("绝不携带 theme —— 显式 theme 会覆盖 yyps 账号默认主题（2026-10-25 定案）", () => {
    const payload = buildPublishPayload({ account: "a", title: "t", content: "c" });
    expect(payload).not.toHaveProperty("theme");
  });

  it("可选项映射到 wire 字段名；未设置的选项不进 payload", () => {
    const payload = buildPublishPayload({
      account: "a",
      title: "t",
      content: "c",
      digest: "摘要",
      author: "笔者",
      cover: "provided",
      coverImagePrompt: "水墨山水",
      thumbMediaId: "MEDIA",
      forcePublish: true,
    });
    expect(payload.digest).toBe("摘要");
    expect(payload.author).toBe("笔者");
    expect(payload.cover).toBe("provided");
    expect(payload.cover_image_prompt).toBe("水墨山水");
    expect(payload.thumb_media_id).toBe("MEDIA");
    expect(payload.force_publish).toBe(true);
  });

  it("forcePublish=false 时省略 force_publish（服务端默认 false）", () => {
    const payload = buildPublishPayload({ account: "a", title: "t", content: "c" });
    expect(payload).not.toHaveProperty("force_publish");
    expect(payload).not.toHaveProperty("digest");
    expect(payload).not.toHaveProperty("cover");
  });
});
