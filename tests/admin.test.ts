import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { WxpubAdminClient } from "../src/admin.js";
import { WxpubApiError } from "../src/client.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

/** 构造三段式 JWT（payload 只含 exp，预检只解这一个字段）。 */
function fakeJwt(expSecs: number): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256" })}.${enc({ exp: expSecs })}.${enc({ sig: "x" })}`;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const VALID_JWT = fakeJwt(nowSec() + 600);

function captureFetch(status: number, body: unknown) {
  const captured: CapturedRequest[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    captured.push({ url, init });
    // 204/无实体的响应体必须是 null（Response 构造器约束）；null 也覆盖空 body 用例
    const payload = body === null ? null : typeof body === "string" ? body : JSON.stringify(body);
    return new Response(payload, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { captured, impl };
}

function makeAdminClient(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
  apiKey: string = VALID_JWT,
): WxpubAdminClient {
  return new WxpubAdminClient({
    baseUrl: "https://yyps.net/",
    apiKey,
    fetchImpl: impl,
  });
}

function reqBody(req: CapturedRequest | undefined): Record<string, unknown> {
  return JSON.parse(String(req?.init?.body)) as Record<string, unknown>;
}

describe("admin 通道守卫", () => {
  it("sk_ Key：前置拦截零网络，指路 wxpub login", async () => {
    const { captured, impl } = captureFetch(200, { data: [] });
    await expect(makeAdminClient(impl, "sk_live_x").myQuota()).rejects.toThrow(/wxpub login/);
    expect(captured).toHaveLength(0);
  });

  it("过期 JWT：预检拦截零网络，带重登指引", async () => {
    const { captured, impl } = captureFetch(200, { data: [] });
    await expect(makeAdminClient(impl, fakeJwt(nowSec() - 120)).myQuota()).rejects.toThrow(
      /已过期.*wxpub login/,
    );
    expect(captured).toHaveLength(0);
  });

  it("有效 JWT：Bearer 通道 + 显式 UA", async () => {
    const { captured, impl } = captureFetch(200, { data: [] });
    await makeAdminClient(impl).myQuota();
    const req = captured[0];
    expect(req?.url).toBe("https://yyps.net/api/publish/admin/quota/me");
    const headers = req?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer .+\..+\..+$/);
    expect(headers["User-Agent"]).toBe(`wxpub-cli/${version}`);
  });

  it("403 无权限：WxpubApiError 透传服务端 message", async () => {
    const { impl } = captureFetch(403, { error: "缺少权限 ai:writing" });
    await expect(makeAdminClient(impl).listDrafts()).rejects.toThrow(/缺少权限 ai:writing/);
  });
});

describe("accounts / quota / tones", () => {
  it("listAccounts：GET，解析 data.items", async () => {
    const { captured, impl } = captureFetch(200, {
      data: {
        items: [{ id: 1, account_key: "danxin", account_name: "码骨丹心", is_active: true }],
      },
    });
    const items = await makeAdminClient(impl).listAccounts();
    expect(items).toHaveLength(1);
    expect(items[0]?.account_key).toBe("danxin");
    expect(captured[0]?.init?.method).toBe("GET");
    expect(captured[0]?.init?.body).toBeUndefined();
  });

  it("myQuota：解析 data 数组（含 remaining=-1）", async () => {
    const { impl } = captureFetch(200, {
      data: [
        { resource: "llm_text", limit: 50, used: 3, remaining: 47 },
        { resource: "llm_image", limit: 0, used: 1, remaining: -1 },
      ],
    });
    const items = await makeAdminClient(impl).myQuota();
    expect(items[0]?.remaining).toBe(47);
    expect(items[1]?.remaining).toBe(-1);
  });

  it("listTones：解析调性数组（scope 透传）", async () => {
    const { impl } = captureFetch(200, {
      data: [
        { id: 2, name: "丹心", persona: "p", style_rules: "s", scope: "system", is_active: true },
      ],
    });
    const tones = await makeAdminClient(impl).listTones();
    expect(tones[0]?.scope).toBe("system");
  });
});

describe("draft CRUD", () => {
  it("listDrafts：可选 query 拼接；不传则无 query", async () => {
    const { captured, impl } = captureFetch(200, {
      data: [{ id: 1, title: "t", status: "draft", content_chars: 10, has_outline: false }],
    });
    await makeAdminClient(impl).listDrafts({ status: "draft", limit: 5 });
    expect(captured[0]?.url).toBe(
      "https://yyps.net/api/publish/admin/writing/drafts?status=draft&limit=5",
    );

    const second = captureFetch(200, { data: [] });
    await makeAdminClient(second.impl).listDrafts();
    expect(second.captured[0]?.url).toBe("https://yyps.net/api/publish/admin/writing/drafts");
  });

  it("createDraft：undefined 字段不进 body（字段级省略）", async () => {
    const { captured, impl } = captureFetch(200, {
      data: {
        id: 7,
        title: "t",
        content: "",
        outline_json: null,
        tone_preset_id: null,
        account_id: null,
        status: "draft",
      },
    });
    const draft = await makeAdminClient(impl).createDraft({ title: "t" });
    expect(draft.id).toBe(7);
    const body = reqBody(captured[0]);
    expect(captured[0]?.init?.method).toBe("POST");
    expect(body.title).toBe("t");
    expect(body).not.toHaveProperty("account_id");
    expect(body).not.toHaveProperty("content");
    expect(body).not.toHaveProperty("tone_preset_id");
  });

  it("getDraft：id 进路径；404 抛错", async () => {
    const { captured, impl } = captureFetch(200, {
      data: {
        id: 7,
        title: "t",
        content: "正文",
        outline_json: null,
        tone_preset_id: null,
        account_id: null,
        status: "draft",
      },
    });
    const draft = await makeAdminClient(impl).getDraft(7);
    expect(draft.content).toBe("正文");
    expect(captured[0]?.url).toBe("https://yyps.net/api/publish/admin/writing/drafts/7");

    const notFound = captureFetch(404, { error: "草稿不存在" });
    await expect(makeAdminClient(notFound.impl).getDraft(999)).rejects.toThrow(/草稿不存在/);
  });

  it("updateDraft：PUT 字段级合并；tonePresetId=null 显式解绑进 body", async () => {
    const { captured, impl } = captureFetch(200, {
      data: {
        id: 7,
        title: "新标题",
        content: "c",
        outline_json: null,
        tone_preset_id: null,
        account_id: null,
        status: "ready",
      },
    });
    const draft = await makeAdminClient(impl).updateDraft(7, {
      title: "新标题",
      status: "ready",
      tonePresetId: null,
    });
    expect(draft.status).toBe("ready");
    expect(captured[0]?.init?.method).toBe("PUT");
    const body = reqBody(captured[0]);
    expect(body.title).toBe("新标题");
    expect(body.status).toBe("ready");
    expect(body.tone_preset_id).toBeNull();
    expect(body).not.toHaveProperty("content");
  });

  it("deleteDraft：DELETE + 空响应体不炸", async () => {
    const { captured, impl } = captureFetch(204, null);
    await expect(makeAdminClient(impl).deleteDraft(7)).resolves.toBeUndefined();
    expect(captured[0]?.init?.method).toBe("DELETE");
  });

  it("data 包装缺失：unwrapData 回退顶层不炸", async () => {
    const { impl } = captureFetch(200, {
      id: 7,
      title: "裸顶层",
      content: "",
      outline_json: null,
      tone_preset_id: null,
      account_id: null,
      status: "draft",
    });
    const draft = await makeAdminClient(impl).getDraft(7);
    expect(draft.title).toBe("裸顶层");
  });
});

describe("AI 写作五件套", () => {
  it("generateOutline：POST body 含 idea/tone_preset_id；解析嵌套 sections", async () => {
    const { captured, impl } = captureFetch(200, {
      data: {
        sections: [
          {
            id: "s1",
            heading: "背景",
            angle: "为什么",
            key_points: ["a"],
            word_target: 400,
            status: "pending",
            subsection: [
              {
                id: "s1-1",
                heading: "子节",
                angle: "",
                key_points: [],
                word_target: 200,
                status: "pending",
                subsection: [],
              },
            ],
          },
        ],
      },
    });
    const outline = await makeAdminClient(impl).generateOutline(7, {
      idea: "写缓存",
      tonePresetId: 2,
    });
    expect(outline.sections[0]?.subsection[0]?.id).toBe("s1-1");
    expect(captured[0]?.url).toBe("https://yyps.net/api/publish/admin/writing/drafts/7/outline");
    const body = reqBody(captured[0]);
    expect(body.idea).toBe("写缓存");
    expect(body.tone_preset_id).toBe(2);
  });

  it("expandSection：section_id 在 URL 路径，body 只含 key_points_override/reroll", async () => {
    const { captured, impl } = captureFetch(200, {
      data: {
        section_id: "s1-1",
        heading: "子节",
        content: "回填整篇",
        section_md: "本节",
        replaced: false,
      },
    });
    const result = await makeAdminClient(impl).expandSection(7, {
      sectionId: "s1-1",
      reroll: true,
      keyPointsOverride: ["要点1"],
    });
    expect(result.content).toBe("回填整篇");
    expect(captured[0]?.url).toBe(
      "https://yyps.net/api/publish/admin/writing/drafts/7/sections/s1-1/expand",
    );
    const body = reqBody(captured[0]);
    expect(body).toEqual({ key_points_override: ["要点1"], reroll: true });
  });

  it("lintDraft：POST lint-rules；解析 GateReport", async () => {
    const { captured, impl } = captureFetch(200, {
      data: {
        checked_at: "2026-11-13T00:00:00Z",
        tone: { score: 4, issues: [], cliche_hits: [["赋能", 2]], prose_chars: 1200 },
      },
    });
    const report = await makeAdminClient(impl).lintDraft(7);
    expect(report.tone.score).toBe(4);
    expect(report.tone.cliche_hits[0]).toEqual(["赋能", 2]);
    expect(captured[0]?.url).toBe("https://yyps.net/api/publish/admin/writing/drafts/7/lint-rules");
    expect(captured[0]?.init?.method).toBe("POST");
  });

  it("reviewDraft：解析审稿四问", async () => {
    const { impl } = captureFetch(200, {
      data: {
        checked_at: "2026-11-13T00:00:00Z",
        tone: { score: 3, issues: [], cliche_hits: [], prose_chars: 800 },
        review: { answers: [{ question: "活人思考", score: 0.4, comment: "略生硬" }] },
      },
    });
    const report = await makeAdminClient(impl).reviewDraft(7);
    expect(report.review?.answers[0]?.question).toBe("活人思考");
  });

  it("generateTitles：解析候选数组（按服务端序）", async () => {
    const { impl } = captureFetch(200, {
      data: [
        { title: "标题A", score: 8.5, risk: null, risk_reason: null },
        { title: "标题B", score: 6.0, risk: "过于平淡", risk_reason: "无悬念" },
      ],
    });
    const titles = await makeAdminClient(impl).generateTitles(7);
    expect(titles[0]?.title).toBe("标题A");
    expect(titles[1]?.risk).toBe("过于平淡");
  });

  it("LLM 任务超时注入：长任务方法带自定义超时仍正常完成", async () => {
    // 传输层超时行为已由 client.test.ts 的 AbortController 机制覆盖；
    // 此处只钉「长任务方法注入更长超时后通路正常」。
    const { impl } = captureFetch(200, { data: [] });
    const titles = await makeAdminClient(impl).generateTitles(7);
    expect(Array.isArray(titles)).toBe(true);
  });
});

describe("history", () => {
  it("listHistory：query 用 page_size（非 size）；解析分页字段", async () => {
    const { captured, impl } = captureFetch(200, {
      data: {
        items: [
          {
            id: 3,
            account_id: 1,
            article_title: "标题",
            status: "published",
            created_at: "2026-11-13",
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      },
    });
    const page = await makeAdminClient(impl).listHistory({
      page: 1,
      pageSize: 20,
      accountId: 1,
      status: "published",
    });
    expect(page.total).toBe(1);
    expect(page.items[0]?.article_title).toBe("标题");
    expect(captured[0]?.url).toBe(
      "https://yyps.net/api/publish/admin/history?page=1&page_size=20&account_id=1&status=published",
    );
  });

  it("getHistory：id 进路径", async () => {
    const { captured, impl } = captureFetch(200, {
      data: {
        id: 3,
        account_id: 1,
        article_title: "标题",
        status: "published",
        created_at: "2026-11-13",
        media_id: "M1",
      },
    });
    const item = await makeAdminClient(impl).getHistory(3);
    expect(item.media_id).toBe("M1");
    expect(captured[0]?.url).toBe("https://yyps.net/api/publish/admin/history/3");
  });

  it("historyStats：路径在 admin 根下（/stats 非 /history/stats）；account_id 可选", async () => {
    const { captured, impl } = captureFetch(200, {
      data: {
        total_publishes: 10,
        success_count: 9,
        failed_count: 1,
        success_rate: 0.9,
        today_count: 1,
        week_count: 3,
        month_count: 6,
      },
    });
    const stats = await makeAdminClient(impl).historyStats(1);
    expect(stats.success_rate).toBe(0.9);
    expect(captured[0]?.url).toBe("https://yyps.net/api/publish/admin/stats?account_id=1");

    const noArg = captureFetch(200, {
      data: {
        total_publishes: 0,
        success_count: 0,
        failed_count: 0,
        success_rate: 0,
        today_count: 0,
        week_count: 0,
        month_count: 0,
      },
    });
    await makeAdminClient(noArg.impl).historyStats();
    expect(noArg.captured[0]?.url).toBe("https://yyps.net/api/publish/admin/stats");
  });

  it("deleteHistory：DELETE 成功", async () => {
    const { captured, impl } = captureFetch(204, null);
    await expect(makeAdminClient(impl).deleteHistory(3)).resolves.toBeUndefined();
    expect(captured[0]?.init?.method).toBe("DELETE");
  });

  it("regenCover：POST regenerate-cover；preset_id 省略语义；解析 job_id", async () => {
    const { captured, impl } = captureFetch(200, { data: { job_id: 42, message: "已提交" } });
    const job = await makeAdminClient(impl).regenCover(3);
    expect(job.job_id).toBe(42);
    expect(captured[0]?.url).toBe("https://yyps.net/api/publish/admin/history/3/regenerate-cover");
    expect(reqBody(captured[0])).toEqual({});
  });

  it("manualCover：POST mark-manual-cover；解析 message", async () => {
    const { captured, impl } = captureFetch(200, { data: { message: "已标记手工封面" } });
    const result = await makeAdminClient(impl).manualCover(3);
    expect(result.message).toBe("已标记手工封面");
    expect(captured[0]?.url).toBe("https://yyps.net/api/publish/admin/history/3/mark-manual-cover");
  });
});

describe("summarize / preview", () => {
  it("summarize：老接口顶层 JSON；蛇形 body；success:false 抛错", async () => {
    const { captured, impl } = captureFetch(200, { success: true, summary: "这是摘要" });
    const summary = await makeAdminClient(impl).summarize({
      title: "标题",
      content: "正文",
      maxLength: 120,
      account: "danxin",
    });
    expect(summary).toBe("这是摘要");
    const body = reqBody(captured[0]);
    expect(body.max_length).toBe(120);
    expect(body.account).toBe("danxin");

    const failed = captureFetch(200, { success: false, message: "AI 摘要服务不可用" });
    await expect(
      makeAdminClient(failed.impl).summarize({ title: "t", content: "c" }),
    ).rejects.toThrow(/AI 摘要服务不可用/);
  });

  it("summarize：403 权限缺失透传", async () => {
    const { impl } = captureFetch(403, { error: "缺少权限 ai:summary" });
    await expect(
      makeAdminClient(impl).summarize({ title: "t", content: "c" }),
    ).rejects.toBeInstanceOf(WxpubApiError);
  });

  it("previewTheme：body 契约（theme_key/content/content_format）；取 data.html", async () => {
    const { captured, impl } = captureFetch(200, { data: { html: "<section>渲染</section>" } });
    const html = await makeAdminClient(impl).previewTheme({
      themeKey: "danxin-red",
      content: "# t",
    });
    expect(html).toBe("<section>渲染</section>");
    expect(reqBody(captured[0])).toEqual({
      theme_key: "danxin-red",
      content: "# t",
      content_format: "markdown",
    });
  });
});
