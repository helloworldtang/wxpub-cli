import { describe, expect, it } from "vitest";

import { WxpubApiError, WxpubClient } from "../src/client.js";

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

/** 捕获请求并返回预设响应的 fetch 替身（依赖注入，不 mock 模块）。 */
function captureFetch(status: number, body: unknown) {
  const captured: CapturedRequest[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    captured.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { captured, impl };
}

function makeClient(impl: (url: string, init?: RequestInit) => Promise<Response>): WxpubClient {
  return new WxpubClient({
    baseUrl: "https://yyps.net/",
    apiKey: "sk_live_test",
    fetchImpl: impl,
  });
}

describe("WxpubClient.publish（传输层契约）", () => {
  it("sk_ Key 走 X-API-Key 通道；body 为 JSON 且含防重放字段", async () => {
    const { captured, impl } = captureFetch(200, { media_id: "MzIxN", duplicate: false });
    const result = await makeClient(impl).publish({
      account: "danxin",
      title: "标题",
      content: "# 正文",
    });
    expect(result.mediaId).toBe("MzIxN");
    expect(result.duplicate).toBe(false);

    const req = captured[0];
    expect(req?.url).toBe("https://yyps.net/api/mp/publish");
    expect(req?.init?.method).toBe("POST");
    const headers = req?.init?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("sk_live_test");
    const body = JSON.parse(String(req?.init?.body)) as Record<string, unknown>;
    expect(body.content_format).toBe("markdown");
    expect(body.account).toBe("danxin");
    expect(typeof body.timestamp).toBe("number");
    expect(typeof body.nonce).toBe("string");
    expect(body).not.toHaveProperty("theme");
  });

  it("JWT（三段点分）走 Authorization: Bearer 通道", async () => {
    const { captured, impl } = captureFetch(200, { media_id: "M1" });
    const client = new WxpubClient({
      baseUrl: "https://yyps.net",
      apiKey: "eyJhbGciOiJ9.eyJzdWIiOiJ9.sig",
      fetchImpl: impl,
    });
    await client.publish({ account: "a", title: "t", content: "c" });
    const headers = captured[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer eyJhbGciOiJ9.eyJzdWIiOiJ9.sig");
  });

  it("draft_id 字段兼容：无 media_id 但有 draft_id 也算成功", async () => {
    const { impl } = captureFetch(200, { draft_id: "D1" });
    const result = await makeClient(impl).publish({ account: "a", title: "t", content: "c" });
    expect(result.mediaId).toBe("D1");
  });

  it("422 业务失败抛 WxpubApiError 且分开提示（非网络故障）", async () => {
    const { impl } = captureFetch(422, { error: "标题不能为空" });
    await expect(
      makeClient(impl).publish({ account: "a", title: "", content: "c" }),
    ).rejects.toThrow(WxpubApiError);
  });

  it("重复投递（duplicate=true 且带 media_id）正常返回并标注", async () => {
    const { impl } = captureFetch(200, { media_id: "MzIxN", duplicate: true });
    const result = await makeClient(impl).publish({ account: "a", title: "t", content: "c" });
    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(true);
  });
});

describe("WxpubClient.accountTheme / listMaterials（传输层契约）", () => {
  it("theme 走 GET + account 查询参数；解析 theme_key/theme_name", async () => {
    const { captured, impl } = captureFetch(200, {
      success: true,
      account: "danxin",
      theme_key: "green",
      theme_name: "品牌绿",
    });
    const theme = await makeClient(impl).accountTheme("danxin");
    expect(theme.themeKey).toBe("green");
    expect(theme.themeName).toBe("品牌绿");
    const req = captured[0];
    expect(req?.url).toBe("https://yyps.net/api/mp/account-theme?account=danxin");
    expect(req?.init?.method).toBe("GET");
    expect((req?.init?.headers as Record<string, string>)["X-API-Key"]).toBe("sk_live_test");
  });

  it("materials 走 POST JSON：account/material_type/offset/count/timestamp", async () => {
    const { captured, impl } = captureFetch(200, {
      success: true,
      total_count: 1,
      items: [{ media_id: "M1", name: "封面", url: "https://mmbiz.qpic.cn/x" }],
    });
    const result = await makeClient(impl).listMaterials("danxin", { count: 5 });
    expect(result.items[0]?.url).toBe("https://mmbiz.qpic.cn/x");
    const body = JSON.parse(String(captured[0]?.init?.body)) as Record<string, unknown>;
    expect(body.account).toBe("danxin");
    expect(body.material_type).toBe("image");
    expect(body.count).toBe(5);
    expect(typeof body.timestamp).toBe("number");
  });
});

describe("WxpubClient.uploadImage（multipart 契约）", () => {
  it("multipart 字段：account 与 nonce 必填 + file 带文件名", async () => {
    const { captured, impl } = captureFetch(200, {
      success: true,
      media_id: "M1",
      url: "https://mmbiz.qpic.cn/pic",
    });
    const result = await makeClient(impl).uploadImage(
      "danxin",
      "cover.png",
      new Uint8Array([1, 2]),
    );
    expect(result.mediaId).toBe("M1");
    expect(result.url).toBe("https://mmbiz.qpic.cn/pic");

    const form = captured[0]?.init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("account")).toBe("danxin");
    expect(typeof form.get("nonce")).toBe("string");
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("cover.png");
  });
});
