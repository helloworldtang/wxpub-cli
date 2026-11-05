import { randomUUID } from "node:crypto";

import type { WxpubConfig } from "./config.js";

/** publish 请求的用户输入（不含协议自动字段）。 */
export interface PublishInput {
  account: string;
  title: string;
  /** Markdown 原文；渲染与主题判定在服务端完成 */
  content: string;
  digest?: string;
  author?: string;
  /** ai | auto | provided | none；不传则走服务端账号配置的默认封面策略 */
  cover?: "ai" | "auto" | "provided" | "none";
  /** cover=ai 时的画面提示词；不传则服务端 LLM 读全文提炼 */
  coverImagePrompt?: string;
  /** cover=provided 时的固定封面素材 id */
  thumbMediaId?: string;
  /** 跳过幂等去重，强制创建新草稿 */
  forcePublish?: boolean;
}

/** /api/mp/publish 请求体（wire 契约：content_format=markdown、绝不携带 theme）。 */
export interface PublishPayload {
  account: string;
  title: string;
  content: string;
  content_format: "markdown";
  timestamp: number;
  nonce: string;
  digest?: string;
  author?: string;
  cover?: string;
  cover_image_prompt?: string;
  thumb_media_id?: string;
  force_publish?: boolean;
}

/** 组装 publish 请求体。timestamp/nonce 由调用方注入以便测试。 */
export function buildPublishPayload(
  input: PublishInput,
  now: () => number = () => Math.floor(Date.now() / 1000),
  nonce: () => string = () => randomUUID().replaceAll("-", ""),
): PublishPayload {
  const payload: PublishPayload = {
    account: input.account,
    title: input.title,
    content: input.content,
    content_format: "markdown",
    timestamp: now(),
    nonce: nonce(),
  };
  if (input.digest !== undefined) payload.digest = input.digest;
  if (input.author !== undefined) payload.author = input.author;
  if (input.cover !== undefined) payload.cover = input.cover;
  if (input.coverImagePrompt !== undefined) payload.cover_image_prompt = input.coverImagePrompt;
  if (input.thumbMediaId !== undefined) payload.thumb_media_id = input.thumbMediaId;
  if (input.forcePublish) payload.force_publish = true;
  return payload;
}

export interface PublishResult {
  ok: boolean;
  /** 公众号草稿素材 id（成功时必有） */
  mediaId?: string;
  /** 同一篇重复投递被幂等去重短路 */
  duplicate: boolean;
  message: string;
  raw: unknown;
}

export interface AccountTheme {
  ok: boolean;
  account: string;
  themeKey?: string;
  themeName?: string;
  /** 主题配置 JSON（服务端渲染用；本地渲染调用方取色用） */
  themeConfig?: unknown;
  message: string;
}

export interface MaterialItem {
  mediaId: string;
  name?: string;
  url?: string;
  updateTime?: number;
}

export interface MaterialsResult {
  ok: boolean;
  message: string;
  totalCount: number;
  items: MaterialItem[];
}

export interface UploadResult {
  ok: boolean;
  message: string;
  /** 永久素材 media_id */
  mediaId?: string;
  /** 微信 CDN URL（mmbiz…），可直接内嵌正文 */
  url?: string;
}

/** 账号绑定的写作调性（persona 人设 + style_rules 结构规则 + 建议字数区间）。 */
export interface TonePreset {
  name: string;
  persona: string;
  styleRules: string;
  lengthMin?: number;
  lengthMax?: number;
}

export interface AccountToneResult {
  ok: boolean;
  account: string;
  /** null = 账号未绑定调性（或已删/停用），回落无调性写作 */
  tone: TonePreset | null;
}

export interface IllustrationResult {
  ok: boolean;
  message: string;
  mediaId?: string;
  /** mmbiz URL，可直接内嵌 markdown 正文 */
  url?: string;
  /** 现成的插图片段 ![配图](url) */
  markdown?: string;
  /** 服务端 LLM 提炼的画面 prompt（透明度/复用价值） */
  prompt?: string;
}

/** 服务端错误（4xx/5xx 或业务失败），携带状态码与响应体。 */
export class WxpubApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "WxpubApiError";
    this.status = status;
    this.body = body;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface WxpubClientOptions extends Partial<WxpubConfig> {
  /** 依赖注入：测试捕获请求用 */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** wechat-publish-service 客户端（API-Key 通道）。 */
export class WxpubClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: WxpubClientOptions) {
    if (!options.baseUrl || !options.apiKey) {
      throw new Error("WxpubClient 需要 baseUrl 与 apiKey");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** sk_ 开头是 API Key（X-API-Key）；三段点分是 JWT（Bearer 委托票）。 */
  private authHeaders(): Record<string, string> {
    const isJwt = !this.apiKey.startsWith("sk_") && this.apiKey.split(".").length === 3;
    return isJwt ? { Authorization: `Bearer ${this.apiKey}` } : { "X-API-Key": this.apiKey };
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = controller.signal.aborted
        ? `超时（${this.timeoutMs}ms）`
        : (err as Error).message;
      throw new WxpubApiError(`请求 ${path} 失败：${reason}`, 0, null);
    } finally {
      clearTimeout(timer);
    }
    const text = await resp.text();
    let body: unknown = null;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      body = text;
    }
    if (!resp.ok) {
      const message =
        (body as { error?: string; message?: string } | null)?.error ??
        (body as { message?: string } | null)?.message ??
        `HTTP ${resp.status}`;
      throw new WxpubApiError(`服务端返回 ${resp.status}：${message}`, resp.status, body);
    }
    return body;
  }

  /** 服务健康检查（GET /health）。 */
  async health(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const resp = await this.fetchImpl(`${this.baseUrl}/health`, { signal: controller.signal });
      return resp.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 投递文章到公众号草稿箱。成功判据与 exomind 对齐：有 media_id 即成功。 */
  async publish(input: PublishInput): Promise<PublishResult> {
    const body = (await this.request("/api/mp/publish", {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(buildPublishPayload(input)),
    })) as Record<string, unknown>;

    const mediaId =
      (typeof body.media_id === "string" && body.media_id) ||
      (typeof body.draft_id === "string" && body.draft_id) ||
      undefined;
    const duplicate = body.duplicate === true;
    const ok = mediaId !== undefined || body.success === true || body.errcode === 0;
    const message =
      (typeof body.message === "string" && body.message) ||
      (typeof body.error === "string" && body.error) ||
      "";
    if (!ok) {
      throw new WxpubApiError(message || "投递失败（服务端未返回 media_id）", 0, body);
    }
    return { ok: true, mediaId, duplicate, message, raw: body };
  }

  /** 查询账号默认主题（不传 theme 发文时服务端即用它渲染）。 */
  async accountTheme(account: string): Promise<AccountTheme> {
    const body = (await this.request(
      `/api/mp/account-theme?account=${encodeURIComponent(account)}`,
      { method: "GET", headers: this.authHeaders() },
    )) as Record<string, unknown>;
    if (body.success !== true) {
      throw new WxpubApiError((body.message as string) || "查询账号主题失败", 0, body);
    }
    return {
      ok: true,
      account: (body.account as string) ?? account,
      themeKey: (body.theme_key as string) || undefined,
      themeName: (body.theme_name as string) || undefined,
      themeConfig: body.theme_config,
      message: (body.message as string) || "",
    };
  }

  /** 查询永久素材列表。 */
  async listMaterials(
    account: string,
    options: { type?: string; offset?: number; count?: number } = {},
  ): Promise<MaterialsResult> {
    const body = (await this.request("/api/mp/materials/list", {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        account,
        material_type: options.type ?? "image",
        offset: options.offset ?? 0,
        count: options.count ?? 10,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    })) as Record<string, unknown>;
    if (body.success !== true) {
      throw new WxpubApiError((body.message as string) || "查询素材失败", 0, body);
    }
    const items = Array.isArray(body.items)
      ? (body.items as Record<string, unknown>[]).map((item) => ({
          mediaId: (item.media_id as string) || "",
          name: (item.name as string) || undefined,
          url: (item.url as string) || undefined,
          updateTime:
            typeof item.update_time === "number" ? (item.update_time as number) : undefined,
        }))
      : [];
    return {
      ok: true,
      message: (body.message as string) || "",
      totalCount: (body.total_count as number) ?? items.length,
      items,
    };
  }

  /** 查询账号绑定的写作调性（写文前注入上下文；未绑定返回 tone=null）。 */
  async accountTone(account: string): Promise<AccountToneResult> {
    const body = (await this.request(
      `/api/mp/account-tone?account=${encodeURIComponent(account)}`,
      { method: "GET", headers: this.authHeaders() },
    )) as Record<string, unknown>;
    if (body.success !== true) {
      throw new WxpubApiError((body.message as string) || "查询账号调性失败", 0, body);
    }
    const tone = body.tone as Record<string, unknown> | null | undefined;
    return {
      ok: true,
      account: (body.account as string) ?? account,
      tone: tone
        ? {
            name: (tone.name as string) || "",
            persona: (tone.persona as string) || "",
            styleRules: (tone.style_rules as string) || "",
            lengthMin: typeof tone.length_min === "number" ? tone.length_min : undefined,
            lengthMax: typeof tone.length_max === "number" ? tone.length_max : undefined,
          }
        : null,
    };
  }

  /** AI 生成正文配图（LLM 提炼 prompt → 出图 → 上传素材）。耗时 10-60s，注意超时。 */
  async generateIllustration(
    account: string,
    text: string,
    options: { title?: string; presetId?: number } = {},
  ): Promise<IllustrationResult> {
    const payload: Record<string, unknown> = {
      account,
      text,
      timestamp: Math.floor(Date.now() / 1000),
    };
    if (options.title !== undefined) payload.title = options.title;
    if (options.presetId !== undefined) payload.preset_id = options.presetId;
    const body = (await this.request("/api/mp/ai-image", {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })) as Record<string, unknown>;
    // mp 通道业务失败也是 HTTP 200 + success:false + message（生图失败不阻断语义）
    if (body.success !== true) {
      throw new WxpubApiError((body.message as string) || "生成配图失败", 0, body);
    }
    return {
      ok: true,
      mediaId: (body.media_id as string) || undefined,
      url: (body.url as string) || undefined,
      markdown: (body.markdown as string) || undefined,
      prompt: (body.prompt as string) || undefined,
      message: (body.message as string) || "",
    };
  }

  /** 上传本地图片为永久素材，返回 media_id + mmbiz URL（正文插图用）。 */
  async uploadImage(
    account: string,
    fileName: string,
    fileBytes: Uint8Array,
  ): Promise<UploadResult> {
    const form = new FormData();
    form.append("account", account);
    form.append("nonce", randomUUID().replaceAll("-", ""));
    form.append("file", new Blob([fileBytes]), fileName);
    const body = (await this.request("/api/mp/materials/upload", {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    })) as Record<string, unknown>;
    const mediaId = typeof body.media_id === "string" ? body.media_id : undefined;
    const url = typeof body.url === "string" ? body.url : undefined;
    if (body.success !== true || !mediaId) {
      throw new WxpubApiError((body.message as string) || "上传素材失败", 0, body);
    }
    return {
      ok: true,
      message: (body.message as string) || "",
      mediaId,
      url,
    };
  }
}
