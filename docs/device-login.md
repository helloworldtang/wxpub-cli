# wxpub 设备流登录（场景全记录）

> 2026-11-05 从一句话需求到真机验收的全链路沉淀：需求 → 方案 → 落地 → 各场景 UX。
> 涉及三端：本 CLI（wxpub-cli）、认证服务 auth（AuthKeystone）、发文服务 wechat-publish-service（yyps.net）。

## 1. 需求

**原始诉求**：CLI 临时使用时，用"给个 URL、浏览器里点一下"的方式完成身份获取——像 `npm publish` 触发的那种登录体验，轻量、丝滑、不粘密钥。

拆成硬性要求：

1. **CLI 侧零密钥经手**——不在终端输密码、不贴长期 token、公开客户端不发 secret
2. **端点零硬编码**——认证服务地址、各端点全部自动发现，换 issuer 不改代码
3. **身份是"人"不是"key"**——审计能归因到具体用户（谁、经哪个 client、调了哪个服务）
4. **短时效**——临时使用语义，用完即弃，泄露窗口小；不接受永久凭证常态化

## 2. 方案

### 2.1 架构：四个标准协议的组合，零私有发明

```text
wxpub-cli                    auth (AuthKeystone)                用户浏览器
   │                              │                                │
   │ ① RFC 8414 发现              │                                │
   │ GET /.well-known/oauth-authorization-server                  │
   │ ◀── device_authorization_endpoint + grant URN ───────────────│
   │                              │                                │
   │ ② RFC 8628 设备授权发起       │                                │
   │ POST /oauth/device/authorize │                                │
   │   client_id=wxpub-cli        │                                │
   │   scope=openid profile auth:permissions                      │
   │   audience=client_wechat ★   │                                │
   │ ◀── device_code + user_code ─│                                │
   │                              │                                │
   │ 打印/自动打开确认 URL ─────────────────────────────────────▶ │
   │                              │ ③ 登录（密码/扫码/短信）+ 批准   │
   │                              │    批准页展示：请求方/授权目标/   │
   │                              │    scope 明细（防批准钓鱼）      │
   │                              │    status=pending→approved      │
   │                              │    user_id=<批准者> ★ 身份注入  │
   │ ④ 轮询 token 端点（每 5s）     │                                │
   │ POST /oauth/token            │                                │
   │   grant_type=…device_code    │                                │
   │ ◀── authorization_pending … 直至 approved ──                  │
   │ ◀── access_token（RFC 8693 委托票，900s）                      │
   │                              │                                │
   │ ⑤ 业务请求：Authorization: Bearer <委托票> ──▶ wechat-publish │
   │                              │    验签（aud=client_wechat +    │
   │                              │    token_type=delegation）+     │
   │                              │    introspect 实时权限           │
```

### 2.2 关键设计决策

**为什么委托票（audience），而不是普通设备流 token？**

- wechat-publish 的 mp 通道 **只收 `token_type=delegation` 且 `aud=client_wechat`** 的委托票——这是有意的防线：防跨业务 token 冒用（一张 exomind 的票打不进 yyps）+ OBO 归因（人 → client → 服务全链）
- 普通设备流 token 的 `aud=发起 client`（wxpub-cli），直连必 401 `InvalidAudience`（真机实测踩过）
- 标准获取路径 token exchange **仅限机密 client**，公开 CLI 走不了；给 CLI 发 secret 违背公开客户端原则
- **拍板**：auth 设备流支持 `audience` 参数（RFC 8693 client_id 形态）——浏览器批准即用户级 consent（语义等价 token exchange 的 delegation_grants），批准后**直签委托票**。白名单约束：wxpub-cli 的 `allowed_resources=["client_wechat"]`，只能要这一个 audience

**身份原理（设备流核心）**：两个 code 都不含任何身份信息——`user_code`（XXXX-XXXX，20⁸≈256 亿组合）是给人看的取餐号，`device_code`（256 位随机，服务端只存 sha256）是 CLI 的兑换凭证。身份是浏览器信道写入的（批准时 `user_id=批准者`），CLI 兑换时三关全过才签票：持有真码（哈希命中）+ client 匹配 + 有人批准过。签后即删行，一次性消费。

### 2.3 时效与凭据形态

| 项                         | 值                                                                                                   | 说明                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 设备码等待批准窗口         | 600s（10 分钟）                                                                                      | 覆盖"浏览器登录+批准"全过程，超时 `expired_token`                                                                                     |
| **委托票（CLI 有效身份）** | **900s（15 分钟）**                                                                                  | `DELEGATION_TOKEN_TTL_SECS`（auth 侧 env 可调，与 token exchange 委托码共用）；**无 refresh token**，到期整票作废、重新 `wxpub login` |
| 委托票 claims              | `sub`=批准用户 / `aud`=client_wechat / `token_type`=delegation / `act.sub`=wxpub-cli / `org_id` 恒带 | 服务端 JWKS 验签 + introspect 实时回填权限                                                                                            |

### 2.4 安全性质

- **无新增攻击面**：公开 client_id 非秘密；端点经 discovery 本就公开；拿票前提=真实账号登录+浏览器批准+audience 白名单；包内零密钥
- **优于旧通道的点**：旧 `sk_live_*` API Key 永不过期，泄露窗口是永久的；15 分钟票 + 每次重批，长期凭证暴露面下降
- **已知残余风险与对策**：①设备流固有的"批准钓鱼"（诱导用户批陌生码）→ 批准页展示请求方/目标/scope 明细（已上线）+ 审计 `DEVICE_AUTHORIZED` 带 IP/UA；②auth 的 audience 白名单"空白名单=不限"默认语义 → 已强制化：设备流带 resource/audience 时空白名单即拒（`device_flow_resource_guard`），新 client 开设备流必须同时配 `allowed_resources`

## 3. 落地情况（截至 2026-11-05）

| 层            | 内容                                                                                                                                                                      | 状态                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| auth          | discovery 广播 `device_authorization_endpoint` + device_code/token-exchange grant URN；wire 断言测试钉住                                                                  | ✅ 已上线（`699ef18`）    |
| auth          | 设备流 `audience` 参数 → 直签 RFC 8693 委托票（`issue_delegation_for_user_id`；device_codes 加 audience 列）；DEVICE_FLOW.md 契约同步                                     | ✅ 已上线（`5e7c78d`）    |
| auth          | 批准页未登录断点修复：去登录带 `return_to` 回跳、user_code 保留                                                                                                           | ✅ 已上线（`676f9e4`）    |
| auth          | 批准页信息卡：`GET /api/device/info`（client 名/scope 分组/audience/状态），批准前可见"被批准的东西"                                                                      | ✅ 已上线（`bbd9514`）    |
| auth 线上配置 | `wxpub-cli` client：public + device_code grant + `allowed_resources=["client_wechat"]`                                                                                    | ✅ 已配置                 |
| CLI           | `src/device-auth.ts`：发现/发起/轮询（pending/slow_down/access_denied/expired_token 全处理），fetch/sleep 依赖注入可测；无参 `wxpub login` 交互流；`--api-key` 旧通道兼容 | ✅ v0.2.0 已发 npm        |
| CLI           | 智能登录：凭据仍有效时跳过浏览器（JWT 本地解 exp / sk_ 走 keys/validate）、`--force` 强制重授权                                                                           | ✅ 已实现（见 §4 场景 D） |
| auth          | #28 白名单强制化（带 resource/audience 的设备授权空白名单即拒）+ 批准带 audience 时 upsert delegation_grants 持久记录（管理台"我的授权"可见，线上实证落行）               | ✅ 已上线（`dfa8d28`）    |

**真机验收证据**（2026-11-05）：`wxpub login` 浏览器批准 → 委托票 claims 断言（aud/delegation/act/org_id=1）→ `wxpub theme -a danxin` 200。

## 4. 各场景 UX

### 场景 A：首次使用（无任何凭据）——主路径

```text
$ wxpub login
连接授权服务器：https://auth.ai-as.cc

请在浏览器完成登录并批准：
  https://auth.ai-as.cc/admin/#/device?user_code=ZFWM-QSLQ
  用户码：ZFWM-QSLQ（600 秒内有效）

等待授权…（批准后自动继续；拒绝或超时会退出）
✓ 授权成功，登录态已保存
已保存到 /Users/you/.wxpub/config.json
现在可以发文了：wxpub publish --account <账号> --file article.md
```

浏览器侧：打开链接 →（已登录则直接）看到信息卡【请求方 wxpub-cli / 授权目标 client_wechat / 权限 openid·profile·auth:permissions】→ 点「授权设备」→ CLI 数秒内自动继续。

### 场景 B：本机浏览器未登录过 auth

打开确认页 → 显示「请先登录再确认设备授权」→【去登录】（**带 return_to，user_code 不丢**）→ 密码/微信扫码/短信登录 → **自动整页回跳确认页**（用户码仍预填）→ 批准。全程 CLI 只是一直轮询，无感等待。

### 场景 C：委托票过期（日常最高频）

```text
$ wxpub publish -a danxin -f article.md
✗ 服务端返回 401：Bearer 委托票验签失败: JWT expired        # 15 分钟到点

$ wxpub login                                                # 重跑一次
…（同场景 A，再批一次浏览器）…

$ wxpub publish -a danxin -f article.md                      # 换新票，继续
✓ 已投递草稿箱 media_id=MzIxN…
```

### 场景 D：已有有效凭据再执行 `wxpub login`（智能登录，已实现）

**行为（流派二"智能登录"，v0.2.x 之前是无条件重授权，已改）**：先查现有凭据，仍有效直接返回、不弹浏览器；无效/过期/无凭据才走设备流。`--api-key` 显式给了就不检查（意图明确就是要换凭据）。

```text
$ wxpub login                          # 凭据仍有效时：
凭据仍有效（委托票，剩 7 分钟），未重新授权。
强制重登用：wxpub login --force

$ wxpub login                          # 持有有效 sk_ key 时：
API Key 长期有效（wechat-publish），无需登录。
强制走设备流用：wxpub login --force

$ wxpub login --force                  # 显式重授权：跳过检查，走设备流（换账号/agent 脚本用）
```

检查逻辑：JWT 本地解 `exp`（剩 >1 分钟视为有效，零网络请求）；`sk_live_*` 调 auth `/api/keys/validate`（无效/网络失败均降级走设备流）。凭据优先级与环境变量语义一致（`WXPUB_API_KEY` > 配置文件），skip 提示会标注凭据来自环境变量的情形。

### 场景 E：换身份 / 换账号

同一 CLI 换人用 = 换浏览器里登录的账号批准即可（票的 `sub` 跟批准者走）。批量脚本切身份：`wxpub login --force`（待实现）或先删 `~/.wxpub/config.json`。

### 场景 F：无人值守（CI / 定时任务 / agent 自动发文）

设备流需要人批浏览器，不适合无人值守——走旧通道：

```bash
wxpub login --base-url https://yyps.net --api-key sk_live_xxx   # 一次性配置
# 或零落盘：export WXPUB_API_KEY=sk_live_xxx
```

注意优先级：**环境变量 > 配置文件**——若 shell 里 export 过 `WXPUB_API_KEY`，`wxpub login` 写入的新票不会生效，实际仍用环境变量（用 `wxpub me` 看 key 前缀核实哪个在生效：`sk_live_` vs `eyJ…`）。

### 场景 G：用户在浏览器点了「拒绝」/ 拖过 10 分钟

```text
✗ 你在浏览器里拒绝了本次授权          # exit 1，配置不动
✗ 设备码已过期，请重跑 wxpub login    # exit 1，配置不动
```

拒绝与批准同样落审计（`DEVICE_DENIED` / `DEVICE_AUTHORIZED`，含 IP/UA/归属地）。

## 5. 相关文档

- auth 契约：`auth 仓 docs/src/DEVICE_FLOW.md`（含 audience 委托票模式、发现小节）
- 服务端验票：wechat-publish-service `src/auth/`（JWKS 验签 + introspect）
- 本 CLI 实现：`src/device-auth.ts`（协议层）、`src/commands/login.ts`（交互层）
