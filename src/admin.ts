/**
 * 管理台用户级通道客户端（/api/publish/admin/*，JWT 委托票）。
 *
 * 与 mp 通道（client.ts，X-API-Key / sk_ Key 可用）并列：admin 路由只认
 * Bearer JWT——sk_ Key 在 jwtHeaders() 前置拦截并指路 wxpub login，零网络。
 * 响应统一 `{ data: T }` 包装（unwrapData 容错裸顶层）；ai-summary 是老接口
 * 顶层业务 JSON，单独处理。wire 字段保持 snake_case 透传——--json 的消费方是
 * agent，回显服务端契约比 wire→域→wire 双重映射少一半错位。
 */

import { WxpubApiError, WxpubClient } from "./client.js";
import { resolveConfig } from "./config.js";

/** LLM 长任务超时（大纲/扩写/审稿/标题/摘要/预览渲染），对齐网页端 180s。 */
const LLM_TIMEOUT_MS = 180_000;

// ==========================================
// wire 类型（snake_case 透传，字段以服务端契约为准）
// ==========================================

export interface AccountInfo {
  id: number;
  account_key: string;
  account_name: string;
  appid_masked?: string;
  is_active: boolean;
  default_theme_id?: number | null;
  default_theme_key?: string | null;
  default_theme_name?: string | null;
  default_author?: string | null;
  account_type?: string;
  tone_preset_id?: number | null;
  cover_preset_id?: number | null;
  cover_ratio?: string;
  created_at?: string;
}

export interface DraftSummary {
  id: number;
  account_id: number | null;
  title: string;
  status: string;
  content_chars: number;
  has_outline: boolean;
  published_history_id: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface WritingDraft {
  id: number;
  owner_sub?: string;
  account_id: number | null;
  title: string;
  digest?: string | null;
  author?: string | null;
  theme?: string | null;
  content: string;
  outline_json: string | null;
  tone_preset_id: number | null;
  title_candidates_json?: string | null;
  lint_report_json?: string | null;
  status: string;
  published_history_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface OutlineSection {
  id: string;
  heading: string;
  angle: string;
  key_points: string[];
  word_target: number;
  status: "pending" | "expanded" | "edited";
  subsection: OutlineSection[];
}

export interface OutlineRoot {
  sections: OutlineSection[];
}

export interface ExpandResult {
  section_id: string;
  heading: string;
  /** 回填后的整篇正文（服务端已落库） */
  content: string;
  section_md: string;
  replaced: boolean;
}

export interface GateIssue {
  severity: string;
  rule: string;
  message: string;
}

export interface QuestionAnswer {
  question: string;
  score: number;
  comment: string;
}

export interface GateReport {
  checked_at: string;
  tone: {
    score: number;
    issues: GateIssue[];
    cliche_hits: [string, number][];
    prose_chars: number;
  };
  review?: { answers: QuestionAnswer[] };
}

export interface TitleCandidate {
  title: string;
  score: number;
  risk: string | null;
  risk_reason: string | null;
}

export interface HistoryItem {
  id: number;
  account_id: number;
  article_title: string;
  status: string;
  media_id?: string | null;
  article_url?: string | null;
  error_message?: string | null;
  theme_name?: string | null;
  created_at: string;
  source_system?: string | null;
  cover_strategy?: string | null;
  ai_cover_status?: string | null;
  cover_swap_status?: string | null;
  cover_manual?: boolean;
  [key: string]: unknown;
}

export interface HistoryPage {
  items: HistoryItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface HistoryStats {
  total_publishes: number;
  success_count: number;
  failed_count: number;
  /** 百分数形态（真机实测 414/418 → 99.0，非 0-1 小数） */
  success_rate: number;
  today_count: number;
  week_count: number;
  month_count: number;
}

export interface QuotaStatus {
  resource: string;
  limit: number;
  used: number;
  /** -1 = 不限 */
  remaining: number;
}

export interface ToneInfo {
  id: number;
  name: string;
  description?: string | null;
  persona: string;
  style_rules: string;
  length_min?: number | null;
  length_max?: number | null;
  scope: "system" | "user";
  owner_sub?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CoverJobResult {
  job_id: number;
  message: string;
}

// ==========================================
// 客户端
// ==========================================

type JsonRecord = Record<string, unknown>;

/** 管理台通道客户端：全部方法要求 JWT 委托票（设备流 wxpub login 所得）。 */
export class WxpubAdminClient extends WxpubClient {
  /** admin 路由只认 Bearer JWT：sk_ Key 前置拦截，零网络，指路重登。 */
  private jwtHeaders(): Record<string, string> {
    if (this.apiKey.startsWith("sk_")) {
      throw new Error(
        "此命令需要用户登录凭据（JWT 委托票），API Key 通道不支持。请先执行：wxpub login",
      );
    }
    return this.authHeaders();
  }

  private async adminRequest(
    path: string,
    init: RequestInit,
    timeoutMs?: number,
  ): Promise<unknown> {
    const headers = this.jwtHeaders();
    return this.request(
      path,
      { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } },
      timeoutMs,
    );
  }

  private async getJson(path: string, timeoutMs?: number): Promise<unknown> {
    return this.adminRequest(path, { method: "GET" }, timeoutMs);
  }

  private async postJson(
    path: string,
    body: JsonRecord | undefined,
    timeoutMs?: number,
  ): Promise<unknown> {
    return this.adminRequest(
      path,
      {
        method: "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      timeoutMs,
    );
  }

  /** 容错解包 {data:T}；个别端点裸顶层时原样返回。 */
  private unwrapData<T>(body: unknown): T {
    if (body && typeof body === "object" && "data" in (body as JsonRecord)) {
      return (body as { data: T }).data;
    }
    return body as T;
  }

  private static buildQuery(params: Record<string, string | number | undefined>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "";
    const search = new URLSearchParams(entries.map(([k, v]) => [k, String(v)] as [string, string]));
    return `?${search.toString()}`;
  }

  /** 账号列表（account:read；仅自己归属账号）。 */
  async listAccounts(): Promise<AccountInfo[]> {
    const body = await this.getJson("/api/publish/admin/accounts");
    const data = this.unwrapData<{ items: AccountInfo[] }>(body);
    return Array.isArray(data?.items) ? data.items : [];
  }

  /** 草稿列表（ai:writing；owner 隔离）。 */
  async listDrafts(options: { status?: string; limit?: number } = {}): Promise<DraftSummary[]> {
    const body = await this.getJson(
      `/api/publish/admin/writing/drafts${WxpubAdminClient.buildQuery({
        status: options.status,
        limit: options.limit,
      })}`,
    );
    const data = this.unwrapData<DraftSummary[]>(body);
    return Array.isArray(data) ? data : [];
  }

  /** 新建草稿。undefined 字段不进 body（= 服务端默认）。 */
  async createDraft(input: {
    title: string;
    accountId?: number;
    tonePresetId?: number;
    content?: string;
    digest?: string;
    author?: string;
  }): Promise<WritingDraft> {
    const body = await this.postJson("/api/publish/admin/writing/drafts", {
      title: input.title,
      account_id: input.accountId,
      tone_preset_id: input.tonePresetId,
      content: input.content,
      digest: input.digest,
      author: input.author,
    });
    return this.unwrapData<WritingDraft>(body);
  }

  async getDraft(id: number): Promise<WritingDraft> {
    const body = await this.getJson(`/api/publish/admin/writing/drafts/${id}`);
    return this.unwrapData<WritingDraft>(body);
  }

  /** 字段级保存（PUT 合并）。tonePresetId 传 null = 显式解绑，缺省 = 保留。 */
  async updateDraft(
    id: number,
    patch: {
      title?: string;
      accountId?: number;
      tonePresetId?: number | null;
      content?: string;
      digest?: string;
      author?: string;
      theme?: string;
      status?: string;
    },
  ): Promise<WritingDraft> {
    const body = await this.adminRequest(`/api/publish/admin/writing/drafts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: patch.title,
        account_id: patch.accountId,
        tone_preset_id: patch.tonePresetId,
        content: patch.content,
        digest: patch.digest,
        author: patch.author,
        theme: patch.theme,
        status: patch.status,
      }),
    });
    return this.unwrapData<WritingDraft>(body);
  }

  async deleteDraft(id: number): Promise<void> {
    await this.adminRequest(`/api/publish/admin/writing/drafts/${id}`, { method: "DELETE" });
  }

  /** AI 生成大纲（LLM；结果落库 outline_json）。 */
  async generateOutline(
    id: number,
    input: { idea: string; tonePresetId?: number },
  ): Promise<OutlineRoot> {
    const body = await this.postJson(
      `/api/publish/admin/writing/drafts/${id}/outline`,
      { idea: input.idea, tone_preset_id: input.tonePresetId },
      LLM_TIMEOUT_MS,
    );
    return this.unwrapData<OutlineRoot>(body);
  }

  /** 单节扩写（section_id 在路径；body 只含 key_points_override/reroll）。 */
  async expandSection(
    id: number,
    input: { sectionId: string; reroll?: boolean; keyPointsOverride?: string[] },
  ): Promise<ExpandResult> {
    const body = await this.postJson(
      `/api/publish/admin/writing/drafts/${id}/sections/${encodeURIComponent(
        input.sectionId,
      )}/expand`,
      { key_points_override: input.keyPointsOverride, reroll: input.reroll },
      LLM_TIMEOUT_MS,
    );
    return this.unwrapData<ExpandResult>(body);
  }

  /** 规则门禁（免费本地，不耗配额）。 */
  async lintDraft(id: number): Promise<GateReport> {
    const body = await this.postJson(
      `/api/publish/admin/writing/drafts/${id}/lint-rules`,
      undefined,
    );
    return this.unwrapData<GateReport>(body);
  }

  /** 审稿四问（LLM）。 */
  async reviewDraft(id: number): Promise<GateReport> {
    const body = await this.postJson(
      `/api/publish/admin/writing/drafts/${id}/review`,
      undefined,
      LLM_TIMEOUT_MS,
    );
    return this.unwrapData<GateReport>(body);
  }

  /** 标题候选（LLM + 账号 few-shot；按分降序）。 */
  async generateTitles(id: number): Promise<TitleCandidate[]> {
    const body = await this.postJson(
      `/api/publish/admin/writing/drafts/${id}/titles`,
      undefined,
      LLM_TIMEOUT_MS,
    );
    const data = this.unwrapData<TitleCandidate[]>(body);
    return Array.isArray(data) ? data : [];
  }

  /** 发布历史列表（publish:read；普通用户仅自己账号）。 */
  async listHistory(
    options: { page?: number; pageSize?: number; accountId?: number; status?: string } = {},
  ): Promise<HistoryPage> {
    const body = await this.getJson(
      `/api/publish/admin/history${WxpubAdminClient.buildQuery({
        page: options.page,
        page_size: options.pageSize,
        account_id: options.accountId,
        status: options.status,
      })}`,
    );
    return this.unwrapData<HistoryPage>(body);
  }

  async getHistory(id: number): Promise<HistoryItem> {
    const body = await this.getJson(`/api/publish/admin/history/${id}`);
    return this.unwrapData<HistoryItem>(body);
  }

  /** 发布统计（publish:read）。注意路径在 admin 根下，不在 /history 下。 */
  async historyStats(accountId?: number): Promise<HistoryStats> {
    const body = await this.getJson(
      `/api/publish/admin/stats${WxpubAdminClient.buildQuery({ account_id: accountId })}`,
    );
    return this.unwrapData<HistoryStats>(body);
  }

  async deleteHistory(id: number): Promise<void> {
    await this.adminRequest(`/api/publish/admin/history/${id}`, { method: "DELETE" });
  }

  /** 重新生成 AI 封面（异步 job；轮询 history list 的 cover_swap_status）。 */
  async regenCover(id: number, options: { presetId?: number } = {}): Promise<CoverJobResult> {
    const body = await this.postJson(
      `/api/publish/admin/history/${id}/regenerate-cover`,
      { preset_id: options.presetId },
      LLM_TIMEOUT_MS,
    );
    return this.unwrapData<CoverJobResult>(body);
  }

  /** 标记「已手工更新封面」。 */
  async manualCover(id: number): Promise<{ message: string }> {
    const body = await this.postJson(
      `/api/publish/admin/history/${id}/mark-manual-cover`,
      undefined,
    );
    return this.unwrapData<{ message: string }>(body);
  }

  /** 我的今日配额余量（登录即可）。 */
  async myQuota(): Promise<QuotaStatus[]> {
    const body = await this.getJson("/api/publish/admin/quota/me");
    const data = this.unwrapData<QuotaStatus[]>(body);
    return Array.isArray(data) ? data : [];
  }

  /** 调性列表（system + 自己 user 级；供 tone_preset_id 发现）。 */
  async listTones(): Promise<ToneInfo[]> {
    const body = await this.getJson("/api/publish/admin/writing/tones");
    const data = this.unwrapData<ToneInfo[]>(body);
    return Array.isArray(data) ? data : [];
  }

  /** AI 生成摘要（ai:summary；老接口顶层 JSON，无 data 包装）。 */
  async summarize(input: {
    title: string;
    content: string;
    maxLength?: number;
    account?: string;
  }): Promise<string> {
    const body = (await this.postJson(
      "/api/publish/admin/ai-summary",
      {
        title: input.title,
        content: input.content,
        max_length: input.maxLength,
        account: input.account,
      },
      LLM_TIMEOUT_MS,
    )) as JsonRecord;
    if (body?.success !== true) {
      throw new WxpubApiError((body?.message as string) || "生成摘要失败", 0, body);
    }
    return (body.summary as string) || "";
  }

  /** 按主题 key 渲染预览 HTML（登录通道）。 */
  async previewTheme(input: { themeKey: string; content: string }): Promise<string> {
    const body = await this.postJson(
      "/api/publish/admin/preview/theme/key",
      { theme_key: input.themeKey, content: input.content, content_format: "markdown" },
      LLM_TIMEOUT_MS,
    );
    const data = this.unwrapData<{ html: string }>(body);
    return data?.html ?? "";
  }
}

/** 命令层一行建客户端：读配置 + 构造。 */
export function createAdminClient(): WxpubAdminClient {
  return new WxpubAdminClient(resolveConfig());
}
