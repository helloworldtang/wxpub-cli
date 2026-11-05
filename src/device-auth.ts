/**
 * 设备授权流（RFC 8628）登录：对接 auth 服务（AuthKeystone）。
 *
 * 链路：discovery（RFC 8414）发现端点 → POST 设备授权端点拿 device_code/user_code →
 * 打印确认 URL（用户浏览器登录并批准）→ 轮询 token 端点直到 approved → JWT 存入配置。
 * 全程零硬编码 URL（端点都来自 discovery），零密钥经手（浏览器侧完成登录）。
 */

/** auth 服务默认地址（issuer）。 */
export const DEFAULT_AUTH_ISSUER = "https://auth.ai-as.cc";
/** 设备流 grant 的 URN 形态（与 token 端点 dispatch 匹配）。 */
export const DEVICE_GRANT_URN = "urn:ietf:params:oauth:grant-type:device_code";
/** 设备流专用公开 client（auth 侧注册：public + device_code grant）。 */
export const DEVICE_CLIENT_ID = "wxpub-cli";
/** 请求的 scope：auth:permissions 让 token 带权限标识（服务端 introspect 实时回填）。 */
export const DEVICE_SCOPE = "openid profile auth:permissions";
/**
 * RFC 8693 audience：wechat-publish 只收 aud=自己 client_id 的 delegation 委托票，
 * 设备流带 audience 发起 → 批准后直接签出委托票（无需机密 client 的 token exchange）。
 */
export const DEVICE_AUDIENCE = "client_wechat";

export interface DeviceEndpoints {
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** 秒 */
  expiresIn: number;
  /** 轮询间隔（秒） */
  interval: number;
}

/** 设备流失败（RFC 8628 §3.5 错误码），terminal 错误抛出终止轮询。 */
export class DeviceFlowError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeviceFlowError";
    this.code = code;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

const sleep: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * RFC 8414 发现：拉 AS metadata，校验支持设备流，返回两端点。
 * 不支持时给出可行动的错误（而不是让后续请求莫名 400）。
 */
export async function discoverDeviceEndpoints(
  issuer: string,
  fetchImpl: FetchLike = fetch,
): Promise<DeviceEndpoints> {
  const base = issuer.replace(/\/+$/, "");
  const resp = await fetchImpl(`${base}/.well-known/oauth-authorization-server`);
  if (!resp.ok) {
    throw new DeviceFlowError("discovery_failed", `发现文档请求失败：HTTP ${resp.status}`);
  }
  const meta = (await resp.json()) as {
    device_authorization_endpoint?: string;
    token_endpoint?: string;
    grant_types_supported?: string[];
  };
  if (!meta.device_authorization_endpoint || !meta.token_endpoint) {
    throw new DeviceFlowError(
      "discovery_incomplete",
      "发现文档缺少 device_authorization_endpoint / token_endpoint",
    );
  }
  if (!(meta.grant_types_supported ?? []).includes(DEVICE_GRANT_URN)) {
    throw new DeviceFlowError(
      "unsupported_grant_type",
      `该授权服务器不支持设备流（${DEVICE_GRANT_URN}）`,
    );
  }
  return {
    deviceAuthorizationEndpoint: meta.device_authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
  };
}

/** 发起设备授权：拿 device_code + user_code + 确认 URL。audience 非空时批准后签委托票。 */
export async function requestDeviceAuthorization(
  endpoint: string,
  clientId: string = DEVICE_CLIENT_ID,
  fetchImpl: FetchLike = fetch,
  audience: string = DEVICE_AUDIENCE,
): Promise<DeviceAuthorization> {
  const body = new URLSearchParams({
    client_id: clientId,
    scope: DEVICE_SCOPE,
    audience,
  });
  const resp = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok || typeof data.device_code !== "string" || typeof data.user_code !== "string") {
    const desc =
      typeof data.error_description === "string" ? data.error_description : `HTTP ${resp.status}`;
    throw new DeviceFlowError(
      typeof data.error === "string" ? data.error : "device_authorize_failed",
      `设备授权发起失败：${desc}`,
    );
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: typeof data.verification_uri === "string" ? data.verification_uri : "",
    verificationUriComplete:
      typeof data.verification_uri_complete === "string"
        ? data.verification_uri_complete
        : typeof data.verification_uri === "string"
          ? data.verification_uri
          : "",
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 600,
    interval: typeof data.interval === "number" ? data.interval : 5,
  };
}

/**
 * 轮询 token 端点直到批准/失败/过期。
 * authorization_pending → 继续等；slow_down → 间隔 +5s；其余错误（access_denied /
 * expired_token / invalid_grant…）终止抛出；成功返回 token 响应。
 */
export async function pollDeviceToken(options: {
  tokenEndpoint: string;
  clientId: string;
  deviceCode: string;
  intervalSecs: number;
  fetchImpl?: FetchLike;
  /** 测试注入：无则真 sleep */
  sleepImpl?: SleepLike;
}): Promise<{ accessToken: string; refreshToken?: string }> {
  const doSleep = options.sleepImpl ?? sleep;
  let interval = options.intervalSecs;
  // 上限 15 分钟（服务端 600s 过期会先返回 expired_token，这是兜底防呆循环）
  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    const body = new URLSearchParams({
      grant_type: DEVICE_GRANT_URN,
      device_code: options.deviceCode,
      client_id: options.clientId,
    });
    const resp = await (options.fetchImpl ?? fetch)(options.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.ok && typeof data.access_token === "string") {
      return {
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      };
    }
    const code = typeof data.error === "string" ? data.error : `http_${resp.status}`;
    if (code === "authorization_pending") {
      if (Date.now() > deadline) {
        throw new DeviceFlowError("expired_token", "等待超时，设备码已过期");
      }
      await doSleep(interval * 1000);
      continue;
    }
    if (code === "slow_down") {
      interval += 5;
      await doSleep(interval * 1000);
      continue;
    }
    const desc =
      typeof data.error_description === "string" ? data.error_description : "设备授权失败";
    throw new DeviceFlowError(code, desc);
  }
}
