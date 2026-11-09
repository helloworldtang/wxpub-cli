# wxpub-cli

公众号发文 CLI —— 一条命令把 Markdown 文章投进指定公众号的草稿箱。

[wechat-publish-service](https://yyps.net) 的官方命令行客户端，走 API-Key 通道，为 coding agent（Claude Code 等）与程序化发文设计。

## 安装

```bash
npm install -g wxpub-cli
```

装好后两个命令等价可用：`wxpub`（短，日常用）和 `wxpub-cli`（与包名一致）。文档以 `wxpub` 示例。

再跑一次 `wxpub install`，把 **wxpub skill** 装进 Claude Code（`~/.claude/skills/wxpub/`）——之后在任何会话里说"把这篇文章发到丹心"，agent 就会自动走 `tone 拉调性 → 写作 → illustrate 配图 → publish 投递` 全链路，无需教它命令。

> 旧包 `wxpub@0.1.0` 已更名，请改用 `wxpub-cli`（命令 `wxpub` 保持不变）。

要求 Node.js >= 20。

> ⚠️ 请从 npm registry 安装并锁定版本。不要引用仓库滚动分支/tarball（如 `github:…/wxpub-cli#main`）——那会让每次 `npm install` 隐性升级到未审阅代码；升级必须是显式改版本号的决策动作。

## 快速开始

```bash
# 1. 登录（推荐：设备流交互登录——给个 URL 浏览器确认即得短时效委托票，无需手动贴 Key）
wxpub login
#   → 打开 https://auth.ai-as.cc/admin/#/device?user_code=XXXX-XXXX 批准即可
#   委托票有时效（约 15 分钟），过期重跑 wxpub login

# 2. 发文（markdown 直传，渲染与主题判定在服务端完成）
wxpub publish --account danxin --file article.md

# 3. 检查登录态与服务健康
wxpub me

# 凭据生命周期：换凭据 / 登出（login → me → update → logout 闭环）
wxpub update --api-key sk_live_new   # 替换凭据（校验通过才落盘；缺省交互粘贴）
wxpub logout                         # 清除本地凭据（保留服务地址）
```

设备流走 auth（AuthKeystone）标准协议：RFC 8414 发现 → RFC 8628 设备授权 → 批准后签 RFC 8693 委托票（`aud=client_wechat`，服务端按委托票验票）。全程零密钥经手、端点零硬编码。原理、时效与各场景 UX（首次/过期重登/未登录浏览器/无人值守等）详见 [设备流登录场景全记录](docs/device-login.md)。

旧通道仍可用：`wxpub login --base-url https://yyps.net --api-key sk_live_xxx`（API Key 由服务端签发，长期有效）。

API Key 由服务端签发（管理后台或 `scripts/generate_api_key.py`）。

也可以不落配置，用环境变量：`WXPUB_BASE_URL` / `WXPUB_API_KEY`。

## 命令

### `publish` — 投递文章到草稿箱

```bash
wxpub publish -a <account> -f article.md [options]
```

| 选项                    | 说明                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `-a, --account <key>`   | 公众号账号 key（必填）                                                       |
| `-f, --file <path>`     | Markdown 文件（必填）                                                        |
| `-t, --title <title>`   | 标题；缺省取正文首个 `# 一级标题`                                            |
| `--digest <text>`       | 分享摘要（≤54 字）                                                           |
| `--author <name>`       | 笔名；缺省用服务端账号配置                                                   |
| `--cover <mode>`        | 封面：`ai`=AI 出图（默认）/ `auto`=服务端兜底 / `provided`=固定封面 / `none` |
| `--cover-prompt <text>` | `cover=ai` 时的画面提示词；缺省由服务端 LLM 读全文提炼                       |
| `--thumb <mediaId>`     | `cover=provided` 时的封面素材 media_id                                       |
| `--force`               | 跳过幂等去重，强制创建新草稿                                                 |

行为契约：

- **Markdown 直传**（`content_format=markdown`），排版渲染在服务端，与后台直发一致
- **不携带 theme** —— 账号在服务端配置的默认主题自动生效（`wxpub theme` 可查询）
- 请求带 `timestamp + nonce` 防重放
- 同内容重复投递会被服务端幂等去重（返回 `duplicate: true`），不会新建草稿
- 只落草稿箱，**不群发**；群发请在公众号后台人工确认

### `tone` — 拉账号写作调性（写文前注入）

```bash
wxpub tone -a danxin
# 输出主笔人设（persona）+ 结构规则（style_rules）+ 建议字数区间
# AI/agent 写文前先跑这个，把调性注入上下文，保证成稿跟号调性一致
```

### `illustrate` — AI 生成正文配图

```bash
wxpub illustrate -a danxin -f article.md [-t 标题] [--preset <模板id>]
# LLM 读全文提炼画面 prompt → 出图 → 上传永久素材
# 输出可直接粘贴进 markdown 的 ![](mmbiz url) 片段；约 10-60 秒
```

### `theme` — 查询账号默认主题

```bash
wxpub theme -a danxin
```

### `materials` — 查询永久素材列表

```bash
wxpub materials -a danxin [--type image] [--offset 0] [--count 10]
```

### `image` — 上传图片为正文插图

```bash
wxpub image -a danxin -f chart.png
# 输出 media_id + mmbiz URL，直接以 ![](url) 内嵌 Markdown 正文
```

## 给 coding agent 用

全局 `--json` 开关输出机器可读结果：

```bash
wxpub --json publish -a danxin -f article.md
# {"ok":true,"media_id":"MzIxN...","duplicate":false}

wxpub --json theme -a danxin
# {"account":"danxin","theme_key":"green","theme_name":"品牌绿"}
```

agent 典型工作流：`tone` 拉调性 → 按调性写 markdown → `illustrate` 生成插图 → `publish` 投递 → 从 JSON 里取 `media_id` 复命。

## 开发

```bash
npm install
npm run lint        # ESLint 9 (flat config)
npm run typecheck   # tsc --noEmit
npm test            # vitest（wire 契约测试）
npm run eval        # agent evals（真 agent 回归 SKILL.md 行为，~$0.2/次）
npm run build       # 产出 dist/
node dist/index.js --help
```

### agent evals

`evals/` 用 `claude -p` 无头模式做 **skill 行为回归**：把 SKILL.md + 场景指令喂给干净 agent，对它的"将执行的命令 + 说明"按规则评分（ordered 顺序 / must_match / must_not_match）。改 SKILL.md 或 CLI 行为后跑 `npm run eval`，红灯 = 说明书没教好。首跑即抓到真问题：场景歧义（转发现成稿要不要拉调性）促成了铁律 1 的措辞收紧。

## 路线图

- ✅ v0.3：`wxpub install` 分发 Agent Skill（遵循 [Agent Skills 开放规范](https://agentskills.io/specification)），Claude Code 自动发现发文工作流；`npm run eval` agent evals 持续回归 skill 行为（vercel 式）
- ✅ v0.2：`wxpub tone` 拉账号调性（写文前注入 agent 上下文）；`wxpub illustrate` AI 生成文中插图（依赖服务端 `/api/mp/account-tone` 与 `/api/mp/ai-image`）
