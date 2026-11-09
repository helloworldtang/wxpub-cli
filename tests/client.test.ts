import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { WxpubApiError, WxpubClient } from "../src/client.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

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
    expect(headers["User-Agent"]).toBe(`wxpub-cli/${version}`);
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

describe("WxpubClient.accountTone（传输层契约）", () => {
  it("GET + account 查询参数；解析 tone 的 wire 字段", async () => {
    const { captured, impl } = captureFetch(200, {
      success: true,
      account: "danxin",
      tone: {
        name: "丹心·工程叙事",
        persona: "冷静的工程叙事者",
        style_rules: "问题-排查-根因-复盘",
        length_min: 1200,
        length_max: 2500,
      },
    });
    const result = await makeClient(impl).accountTone("danxin");
    expect(result.tone?.persona).toBe("冷静的工程叙事者");
    expect(result.tone?.lengthMax).toBe(2500);
    expect(captured[0]?.url).toBe("https://yyps.net/api/mp/account-tone?account=danxin");
    expect(captured[0]?.init?.method).toBe("GET");
  });

  it("tone=null 表示未绑定，正常返回不报错", async () => {
    const { impl } = captureFetch(200, { success: true, account: "danxin", tone: null });
    const result = await makeClient(impl).accountTone("danxin");
    expect(result.tone).toBeNull();
  });

  it("未知账号 404 抛 WxpubApiError", async () => {
    const { impl } = captureFetch(404, { message: "未知账号: nobody" });
    await expect(makeClient(impl).accountTone("nobody")).rejects.toThrow(WxpubApiError);
  });
});

describe("WxpubClient.generateIllustration（传输层契约）", () => {
  it("POST JSON：account/text 必带 + timestamp 防重放 + title/preset_id 映射", async () => {
    const { captured, impl } = captureFetch(200, {
      success: true,
      media_id: "M1",
      url: "https://mmbiz.qpic.cn/pic",
      markdown: "![配图](https://mmbiz.qpic.cn/pic)",
      prompt: "深色厂房,红色发光管道",
    });
    const result = await makeClient(impl).generateIllustration("danxin", "正文文本", {
      title: "标题",
      presetId: 7,
    });
    expect(result.markdown).toContain("mmbiz");
    const body = JSON.parse(String(captured[0]?.init?.body)) as Record<string, unknown>;
    expect(body.account).toBe("danxin");
    expect(body.text).toBe("正文文本");
    expect(body.title).toBe("标题");
    expect(body.preset_id).toBe(7);
    expect(typeof body.timestamp).toBe("number");
  });

  it("业务失败（HTTP 200 + success:false）抛带 message 的错误", async () => {
    const { impl } = captureFetch(200, { success: false, message: "未配置图像生成厂商" });
    await expect(makeClient(impl).generateIllustration("danxin", "文本")).rejects.toThrow(
      /未配置图像生成厂商/,
    );
  });
});

describe("凭据前置预检（委托票过期/临期，authHeaders 收口）", () => {
  /** 构造三段式 JWT（payload 只含 exp，预检只解这一个字段）。 */
  function fakeJwt(expSecs: number): string {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${enc({ alg: "RS256" })}.${enc({ exp: expSecs })}.${enc({ sig: "x" })}`;
  }
  const nowSec = () => Math.floor(Date.now() / 1000);

  function makeJwtClient(
    apiKey: string,
  ): { client: WxpubClient; captured: CapturedRequest[] } {
    const captured: CapturedRequest[] = [];
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
      captured.push({ url, init });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    return { client: new WxpubClient({ baseUrl: "https://yyps.net", apiKey, fetchImpl: impl }), captured };
  }

  it("已过期 JWT：请求前拦截，零网络，错误带重登指引", async () => {
    const { client, captured } = makeJwtClient(fakeJwt(nowSec() - 120));
    await expect(client.accountTone("danxin")).rejects.toThrow(
      /已过期.*wxpub login/,
    );
    expect(captured).toHaveLength(0);
  });

  it("临期 JWT（剩 ≤60s，与 login 的有效口径同界）：同样拦截", async () => {
    const { client, captured } = makeJwtClient(fakeJwt(nowSec() + 30));
    await expect(client.accountTone("danxin")).rejects.toThrow(/仅剩.*wxpub login/);
    expect(captured).toHaveLength(0);
  });

  it("有效 JWT：不误拦，走 Bearer 通道正常请求", async () => {
    const { client, captured } = makeJwtClient(fakeJwt(nowSec() + 600));
    await client.accountTone("danxin");
    expect(captured).toHaveLength(1);
    const headers = captured[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer .+\..+\..+$/);
  });

  it("health() 无凭据路径不被预检拦截（me 命令仍可查服务健康）", async () => {
    const { client, captured } = makeJwtClient(fakeJwt(nowSec() - 120));
    await expect(client.health()).resolves.toBe(true);
    expect(captured).toHaveLength(1); // /health 请求已发出
  });
});
