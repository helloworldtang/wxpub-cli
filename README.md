# wxpub

公众号发文 CLI —— 一条命令把 Markdown 文章投进指定公众号的草稿箱。

[wechat-publish-service](https://yyps.net) 的官方命令行客户端，走 API-Key 通道，为 coding agent（Claude Code 等）与程序化发文设计。

## 安装

```bash
npm install -g wxpub@0.1.0
```

要求 Node.js >= 20。

> ⚠️ 请从 npm registry 安装并锁定版本。不要引用仓库滚动分支/tarball（如 `github:…/wxpub#main`）——那会让每次 `npm install` 隐性升级到未审阅代码；升级必须是显式改版本号的决策动作。

## 快速开始

```bash
# 1. 配置服务地址与 API Key（保存到 ~/.wxpub/config.json）
wxpub login --base-url https://yyps.net --api-key sk_live_xxx

# 2. 发文（markdown 直传，渲染与主题判定在服务端完成）
wxpub publish --account danxin --file article.md

# 3. 检查登录态与服务健康
wxpub me
```

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

agent 典型工作流：`theme` 确认账号主题 → 写 markdown → `image` 传配图 → `publish` 投递 → 从 JSON 里取 `media_id` 复命。

## 开发

```bash
npm install
npm run lint        # ESLint 9 (flat config)
npm run typecheck   # tsc --noEmit
npm test            # vitest（wire 契约测试）
npm run build       # 产出 dist/
node dist/index.js --help
```

## 路线图

- v0.2（依赖服务端增量）：`wxpub tone` 拉账号调性（写文前注入 agent 上下文）；`wxpub illustrate` AI 生成文中插图
