# open-moderation-lexicon

[![CI](https://github.com/open-moderation-lexicon/open-moderation-lexicon/actions/workflows/ci.yml/badge.svg)](https://github.com/open-moderation-lexicon/open-moderation-lexicon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org)

基于开放词库的多语言敏感词检测工具，优先支持中文和英文。同时提供 TypeScript SDK、可自托管的
REST API、CLI 命令行工具，以及可复现、可追溯的上游词库同步流程。

[English documentation](./README.md)

```ts
import { createModerator } from 'open-moderation-lexicon';

const moderator = await createModerator();
const result = moderator.check('这段文本提到了法轮功组织', { mask: true });

result.matched; // true
result.decision; // 'review'
result.riskLevel; // 'medium'
result.matches[0]; // { term: '法轮功', start: 7, end: 10, matchType: 'exact', ... }
result.maskedText; // '这段文本提到了***组织'
```

---

## 这个项目是什么，不是什么

这是一个**关键词检测器加一层可配置的策略引擎**。它能快速、准确地回答"这段文本里有没有出现词库中的词，
出现在什么位置"。

它**不是**语义模型。它不理解含义、意图、反讽和引用，也不判断任何内容是否合法、有害或可接受。
命中只是给你自己的审核流程的一个信号，不是结论。

因此 API 严格区分下面四件事，方便你在上面建立自己的规则：

| 字段        | 含义                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| `matched`   | 是否命中词汇。这是关于文本的客观事实。                                 |
| `matchType` | 命中所需的最弱规则：`exact`、`normalized` 或 `fuzzy`。                 |
| `riskLevel` | `none` / `low` / `medium` / `high`，取所有命中词中最高的严重级别。     |
| `decision`  | `allow` / `review` / `block`，是**你配置的策略**的输出，不是法律结论。 |

默认策略在"阻止"上非常保守：

- 没有命中 → `allow`
- 有命中 → `review`
- 命中 `high` 严重级别的词 → `block`

18 个上游分类中默认只有两个是 `high`（`violence-terrorism` 暴恐、`weapons-explosives` 涉枪涉爆），
所以除非你自己配置，`block` 很少出现。所有规则都可配置，见 [策略](#策略)。

### 明确不做的事

语义分析、谐音与语境分析、大模型审核、图片和音频审核、拼音模糊匹配**都没有实现**，也没有留下
占位代码或伪实现。可能的后续计划见 [Roadmap](#roadmap)。

---

## 安装

```bash
npm install open-moderation-lexicon
```

需要 Node.js >= 22.12（Active LTS），仅支持 ESM。词库随包发布，运行时不联网，可以在离线和内网
环境中使用。

---

## 快速开始

### SDK

```ts
import { createModerator, type ModerationResult } from 'open-moderation-lexicon';

const moderator = await createModerator({
  mode: 'normalized',
  categories: ['all'],
  allowlist: ['允许出现的词'],
  customTerms: [{ term: '业务禁词', category: 'custom', severity: 'high' }],
});

const result: ModerationResult = moderator.check('需要检测的内容');
```

`createModerator()` 只在初始化时读取产物、过滤并构建一次 Aho–Corasick 自动机（默认 17,689 词
约 80 毫秒）。请在服务启动时创建并复用，之后每次 `check()` 只需几十微秒。**不要为每个请求创建
一个实例。**

完整 API：

| 方法                        | 返回值                | 说明                               |
| --------------------------- | --------------------- | ---------------------------------- |
| `check(text, options?)`     | `ModerationResult`    | 全部结果：命中、决策、风险、掩码   |
| `contains(text, options?)`  | `boolean`             | 最快路径，命中第一个即停止         |
| `findFirst(text, options?)` | `Match \| undefined`  | 最左、最长的一个命中               |
| `findAll(text, options?)`   | `Match[]`             | 重叠处理后的全部命中               |
| `mask(text, options?)`      | `string`              | 返回掩码后的文本                   |
| `getMetadata()`             | `LexiconMetadata`     | 版本、上游 Commit、分类、词数      |
| `reload()`                  | `Promise<void>`       | 重新读取产物并重建自动机           |
| `warmup(mode)`              | `void`                | 提前编译某个模式，避免首次调用变慢 |
| `getMatcherStats()`         | `CompiledModeStats[]` | 各模式的节点数与内存占用           |

`CheckOptions`（每次调用都可覆盖，全部可选）：

```ts
moderator.check(text, {
  mode: 'normalized', // 'exact' | 'normalized' | 'fuzzy'
  categories: ['adult'], // 只在这些分类中匹配
  returnMatches: true, // 设为 false 时只返回统计数字
  maxMatches: 100, // 限制返回的命中数量
  overlap: 'leftmost-longest', // 或 'all'
  mask: true,
  maskChar: '*',
  allowlist: ['例外'], // 与实例级白名单合并
});
```

不依赖磁盘产物、用自己的词表同步创建：

```ts
import { createModeratorFromTerms } from 'open-moderation-lexicon';

const moderator = createModeratorFromTerms([
  { term: '业务禁词', category: 'custom', severity: 'high' },
  '也可以直接写字符串',
]);
```

### REST API

```bash
# 在仓库中
npm run dev

# 或安装后
npx open-moderation-lexicon-server
```

```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/v1/moderate \
  -H "content-type: application/json" \
  -d '{"text":"这段文本提到了法轮功组织","options":{"mask":true}}'
```

```json
{
  "success": true,
  "data": {
    "matched": true,
    "decision": "review",
    "riskLevel": "medium",
    "hitCount": 1,
    "uniqueTermCount": 1,
    "categories": ["politics"],
    "matches": [
      {
        "term": "法轮功",
        "matchedText": "法轮功",
        "category": "politics",
        "severity": "medium",
        "matchType": "exact",
        "start": 7,
        "end": 10
      }
    ],
    "maskedText": "这段文本提到了***组织",
    "lexicon": {
      "version": "2026.07.29",
      "upstreamCommit": "5a8da94c61c160e203a6b2fcfafbea642404d50c"
    }
  }
}
```

接口列表：

| 方法   | 路径                 | 用途                                          |
| ------ | -------------------- | --------------------------------------------- |
| `GET`  | `/health`            | 存活状态，以及词库是否加载完成                |
| `GET`  | `/v1/metadata`       | 词库版本、上游 Commit、分类列表、各项限制     |
| `POST` | `/v1/moderate`       | 检测单条文本                                  |
| `POST` | `/v1/moderate/batch` | 批量检测，默认最多 `BATCH_MAX_ITEMS`（100）条 |
| `GET`  | `/docs`              | Swagger UI（`ENABLE_DOCS=false` 可关闭）      |
| `GET`  | `/docs/json`         | OpenAPI 3.1 文档                              |

批量接口逐条返回结果，一条非法输入不会导致整个请求失败：

```json
{
  "success": true,
  "data": {
    "results": [
      { "id": "1", "success": true, "data": { "matched": false, "decision": "allow" } },
      {
        "id": "2",
        "success": false,
        "error": { "code": "TEXT_NOT_STRING", "message": "..." }
      }
    ],
    "summary": { "total": 2, "succeeded": 1, "failed": 1, "matched": 0 }
  }
}
```

错误格式统一，且不会包含服务器路径或堆栈：

```json
{
  "success": false,
  "error": {
    "code": "TEXT_TOO_LONG",
    "message": "Text exceeds the configured maximum length",
    "requestId": "0f1c9f2a-...",
    "details": { "maxTextLength": 20000, "actualLength": 31402 }
  }
}
```

<details>
<summary>全部错误码</summary>

| 错误码                   | HTTP | 触发原因                               |
| ------------------------ | ---- | -------------------------------------- |
| `TEXT_REQUIRED`          | 400  | 缺少 `text`                            |
| `TEXT_NOT_STRING`        | 400  | `text` 不是字符串                      |
| `TEXT_EMPTY`             | 400  | `text` 为空字符串                      |
| `TEXT_BLANK`             | 400  | `text` 只有空白字符                    |
| `TEXT_TOO_LONG`          | 413  | 超过 `MAX_TEXT_LENGTH`                 |
| `INVALID_JSON`           | 400  | 请求体不是合法 JSON                    |
| `UNSUPPORTED_MEDIA_TYPE` | 415  | `content-type` 不是 `application/json` |
| `PAYLOAD_TOO_LARGE`      | 413  | 请求体超过 `MAX_BODY_BYTES`            |
| `INVALID_REQUEST`        | 400  | JSON Schema 校验失败                   |
| `BATCH_EMPTY`            | 400  | `items` 为空                           |
| `BATCH_TOO_LARGE`        | 400  | 超过 `BATCH_MAX_ITEMS`                 |
| `DUPLICATE_BATCH_ID`     | 400  | 批量条目 `id` 重复                     |
| `UNKNOWN_CATEGORY`       | 400  | 分类不存在                             |
| `INVALID_MODE`           | 400  | 匹配模式不受支持                       |
| `INVALID_MASK_CHAR`      | 400  | `maskChar` 不是恰好一个码点            |
| `UNAUTHORIZED`           | 401  | 配置了 `API_TOKEN` 但 Token 不正确     |
| `RATE_LIMITED`           | 429  | 触发限流                               |
| `NOT_FOUND`              | 404  | 路径不存在                             |
| `REQUEST_TIMEOUT`        | 408  | 超过 `REQUEST_TIMEOUT_MS`              |
| `SERVICE_UNAVAILABLE`    | 503  | 词库仍在加载                           |
| `LEXICON_LOAD_FAILED`    | 503  | 词库加载失败，但服务不会崩溃           |
| `INTERNAL_ERROR`         | 500  | 其他未预期错误                         |

</details>

### CLI

```bash
npx open-moderation-lexicon check "需要检查的内容"
npx open-moderation-lexicon check --file article.txt
npx open-moderation-lexicon check --mode normalized "文本"
npx open-moderation-lexicon mask "文本"
npx open-moderation-lexicon metadata
cat article.txt | npx oml check --json
```

退出码：**0** 没有命中，**1** 至少命中一个词，**2** 调用或配置错误。因此可以直接用在流水线里：

```bash
if oml check --quiet "$MESSAGE"; then echo "clean"; else echo "needs review"; fi
```

可用参数：`--file`、`--mode`、`--categories`、`--overlap`、`--mask-char`、`--allowlist`、
`--include-review`、`--json`、`--quiet`、`--help`、`--version`。

### Docker

```bash
docker build -t open-moderation-lexicon .
docker run --rm -p 3000:3000 open-moderation-lexicon

# 或者
docker compose up
```

镜像基于 `node:22-alpine` 多阶段构建，以非 root 用户运行，不包含编译工具链，并内置指向
`/health` 的 `HEALTHCHECK`。

---

## 匹配模式

### `exact`

在原始文本上匹配。中文等没有词间分隔的文字按子串匹配；拉丁字母词要求完整单词边界，所以
`ass` 不会命中 `class`。

### `normalized`（默认）

对文本和词库同时做规范化后再匹配：

- Unicode NFKC（`ｆｕｌｌｗｉｄｔｈ` → `fullwidth`，`①` → `1`，`ﬁ` → `fi`）
- 英文字母转小写
- 删除零宽字符和变体选择符（`法\u200b轮功` → `法轮功`）
- 繁体转简体（`法輪功` → `法轮功`），使用 OpenCC 的单字映射表
- 统一空白字符（不换行空格、全角空格、制表符 → 普通空格）
- 组合记号合并到基字符（`e` + `◌́` → `é`）

每一步转换都保留到原文的**位置映射**，所以返回的偏移量始终指向用户真正输入的字符，即使
规范化改变了字符串长度也不会错位。

### `fuzzy`（需要显式开启）

在 `normalized` 的基础上追加：

- 删除词中插入的分隔符（`b-a-d-w-o-r-d`、`b a d w o r d`、`b.a.d.w.o.r.d`，中文如 `法 轮 功`）
- 折叠常见 leetspeak（`0`→`o`、`1`→`i`、`3`→`e`、`4`→`a`、`5`→`s`、`7`→`t`、`@`→`a`、`$`→`s`）
- 可选：折叠连续重复字符（`baaadword` → `badword`），**默认关闭**

fuzzy **默认关闭**，因为它会提高误杀率。只有通过 fuzzy 规则才命中的结果会返回
`matchType: 'fuzzy'`，你可以区别对待。短于 `fuzzy.minTermLength`（默认 3）的词不参与 fuzzy
匹配，因为折叠后的短词几乎会命中一切。

这些都是确定性的字符串启发式规则，没有模型也没有概率，结果不会被包装成概率值。

```ts
const moderator = await createModerator({
  mode: 'fuzzy',
  fuzzy: { collapseRepeats: true, minTermLength: 4 },
});
```

### `matchType` 的语义

`matchType` 表示**命中所需的最弱规则**，而不是你请求的模式。在 `fuzzy` 模式下检测一段原样
包含词汇的文本，返回的是 `matchType: 'exact'`。这样你可以给不同强度的证据不同权重：`exact`
最强，`fuzzy` 最弱。

---

## 位置索引

`start` 和 `end` 是原文的 **Unicode code point 偏移量**，左闭右开（`[start, end)`）。是码点
而不是 UTF-16 码元，所以一个 emoji 只算一个位置：

```ts
const moderator = await createModerator();
const result = moderator.check('🎉🎉法轮功');
result.matches[0]; // { start: 2, end: 5 }  ← 不是 4..7
```

用这些偏移量截取文本时，需要先转成码点数组，不要直接用 `String.prototype.slice`：

```ts
const codePoints = [...text];
const hit = codePoints.slice(match.start, match.end).join('');
```

`matchedText` 已经帮你截好了，通常不需要自己处理。

---

## 策略

`riskLevel` 取所有命中词中最高的严重级别。`decision` 由你自己配置的策略决定：

```ts
const moderator = await createModerator({
  policy: {
    blockSeverities: ['high'], // 触发 block 的严重级别
    blockCategories: ['weapons-explosives'], // 总是 block 的分类
    allowCategories: ['advertising'], // 降级为 allow 的分类
    blockMinHitCount: 1, // 达到多少个命中才 block
  },
});
```

服务端对应的环境变量：`POLICY_BLOCK_SEVERITIES`、`POLICY_BLOCK_CATEGORIES`、
`POLICY_ALLOW_CATEGORIES`。

---

## 词库

### 来源

| 项目        | 值                                                                          |
| ----------- | --------------------------------------------------------------------------- |
| 上游仓库    | [konsheng/Sensitive-lexicon](https://github.com/konsheng/Sensitive-lexicon) |
| 作者        | Konsheng                                                                    |
| 许可证      | MIT（原文保留在 `data/upstream/LICENSE`）                                   |
| Commit      | `5a8da94c61c160e203a6b2fcfafbea642404d50c`                                  |
| Commit 日期 | 2026-06-15                                                                  |
| 同步日期    | 2026-07-29                                                                  |
| 词库版本    | `2026.07.29`                                                                |

另外内置了 OpenCC 的 `TSCharacters.txt`（Apache-2.0）用于繁简转换。两者都带校验和记录在
[`UPSTREAM.lock.json`](./UPSTREAM.lock.json)，并在
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 中署名。

### 当前构建的统计数据

| 指标                       | 数值   |
| -------------------------- | ------ |
| 18 个文件的原始词行数      | 87,044 |
| 去重后词数                 | 51,336 |
| 去重删除的数量             | 35,695 |
| 默认加载的词数             | 17,689 |
| 单字词（已标记，默认排除） | 993    |
| 疑似异常词（已标记）       | 1,872  |

每次构建都会重新生成报告：`data/reports/build-report.md`、`data/reports/review-needed.json`、
`data/reports/sync-report.md`。

### 默认分类选择，以及为什么重要

上游既有精准的小词表（`暴恐词库`、`涉枪涉爆`），也有非常宽泛的大词表（约 4.2 万行的
`零时-Tencent`、`GFW补充词库`、`网易前端过滤敏感词库`）。宽泛词表里包含大量普通词汇：在它们
里面，`this`、`IS`、`联系` 都是"敏感词"。如果默认加载，`This is a class of assets` 都会被
标记，误杀率高到工具无法使用。

所以每个分类带一个 `defaultEnabled` 标记，配置在
[`data/overrides/category-config.json`](./data/overrides/category-config.json)：

- `categories: ['all']`（默认）只加载 `defaultEnabled` 的分类 —— **17,689 词**
- `categories: ['*']` 加载**全部** 51,336 词，误杀率显著上升
- 显式列表（如 `categories: ['adult', 'general-tencent']`）精确加载这些分类，忽略该标记

`GET /v1/metadata` 和 `oml metadata` 会列出所有分类及其标记和已加载词数，所以不存在隐藏数据：
没有被选中的分类会显示 `termCount: 0`。数据没有被删除，只是需要你主动选择。

当前默认关闭的分类：`censorship-gfw`、`general-netease`、`general-tencent`、`misc`、
`social-issues`、`advertising`。

### 自定义

三层机制，后两层不需要重新构建：

1. **分类配置** —— `data/overrides/category-config.json` 把上游文件映射到分类 id、显示名、
   严重级别和 `defaultEnabled`。修改后需要执行 `npm run lexicon:build`。
2. **白名单** —— `data/overrides/allowlist.txt`，每行一个词，`#` 开头为注释。白名单中的词
   永远不产生命中；白名单短语还会抑制被它完整覆盖的命中，因此可以只在 `保持联系` 中放行
   `联系`，而不是全局放行。
3. **自定义词** —— `data/overrides/custom-terms.json`，或代码里的 `customTerms`，或把自己的
   词表放到 `data/overrides/local-terms/*.txt`（构建时会一并读取）。

### 需要人工复核的词

单字词、超过 64 字符的词、纯数字或纯标点的词、类 HTML 片段、含控制字符的词都会保留在产物中
但打上标记，默认不加载，并写入 `data/reports/review-needed.json` 供人工检查。**不会静默删除
任何词。** 需要加载它们时设置 `includeNeedsReview: true`（或 `LEXICON_INCLUDE_NEEDS_REVIEW=true`）。

### 上游同步

```bash
npm run lexicon:sync            # 拉取上游最新 commit 到 data/upstream/
npm run lexicon:sync -- --check # 上游有更新时退出码为 10，供 CI 使用
npm run lexicon:sync -- --dry-run
npm run lexicon:sync -- --ref <sha>
npm run lexicon:sync -- --force # commit 没变也重新同步
npm run lexicon:build           # data/upstream/ -> data/generated/ 与报告
npm run lexicon:validate        # 校验校验和、结构，并做一次真实匹配
```

同步不会静默覆盖：它会打印新增、删除、变更的文件，各分类新增和删除的词，并写入
`data/reports/sync-report.md`。`category-config.json` 中的分类归属永远不会被自动修改，因此
上游新增文件会显式报告为"未映射的来源"，需要人工决定归入哪个分类。

一个 GitHub Actions 每周运行一次，发现上游更新时自动创建 Pull Request。它不会自动合并，也不会
自动发布，词条 diff 必须由人工审核。见
[`.github/workflows/upstream-sync.yml`](./.github/workflows/upstream-sync.yml)。

---

## 配置项

服务端环境变量，带注释的完整列表见 [`.env.example`](./.env.example)。

| 变量                           | 默认值            | 用途                                        |
| ------------------------------ | ----------------- | ------------------------------------------- |
| `HOST`、`PORT`                 | `0.0.0.0`、`3000` | 监听地址                                    |
| `LOG_LEVEL`                    | `info`            | 日志级别                                    |
| `MAX_TEXT_LENGTH`              | `20000`           | 单条文本长度上限                            |
| `MAX_BODY_BYTES`               | `1048576`         | 请求体大小上限                              |
| `BATCH_MAX_ITEMS`              | `100`             | 批量条数上限                                |
| `DEFAULT_MODE`                 | `normalized`      | 请求未指定时的匹配模式                      |
| `PRECOMPILE_MODES`             | `normalized`      | 启动时预编译的模式                          |
| `LEXICON_CATEGORIES`           | `all`             | `all`、`*` 或逗号分隔的分类列表             |
| `LEXICON_MIN_TERM_LENGTH`      | `2`               | 丢弃更短的词                                |
| `LEXICON_INCLUDE_NEEDS_REVIEW` | `false`           | 是否加载被标记的词                          |
| `POLICY_BLOCK_SEVERITIES`      | `high`            | 触发 block 的严重级别                       |
| `POLICY_BLOCK_CATEGORIES`      | （空）            | 总是 block 的分类                           |
| `POLICY_ALLOW_CATEGORIES`      | （空）            | 降级为 allow 的分类                         |
| `MASK_CHAR`                    | `*`               | 默认掩码字符                                |
| `CORS_ORIGIN`                  | （关闭）          | `*` 或逗号分隔的来源列表                    |
| `RATE_LIMIT_MAX`               | `120`             | 每个窗口每 IP 的请求数                      |
| `RATE_LIMIT_WINDOW`            | `1 minute`        | 限流窗口                                    |
| `API_TOKEN`                    | （无）            | 设置后 `/v1/*` 需要 `Authorization: Bearer` |
| `ENABLE_DOCS`                  | `true`            | 是否提供 Swagger UI                         |
| `LOG_TEXT`                     | `false`           | **设为 true 会记录用户提交的原文**          |
| `TRUST_PROXY`                  | `false`           | 限流时是否信任 `X-Forwarded-For`            |
| `REQUEST_TIMEOUT_MS`           | `30000`           | 请求超时                                    |

---

## 隐私说明

- **默认不记录用户提交的原文。** 日志只包含 requestId、耗时、文本长度、命中数量和命中分类，
  不包含原文，也不包含命中的具体词。`LOG_TEXT=true` 会改变这一点；它只用于本地调试，是否开启
  是你对用户数据做出的明确选择。
- 没有埋点、没有分析统计、运行时不发起任何外部网络请求，词库就在本地磁盘上。
- 不做任何持久化：没有请求存储、没有数据库、不缓存用户文本。
- 密钥只从环境变量读取。仓库中不含任何凭据，`API_TOKEN` 也没有默认值。
- 服务端不接受客户端传入的文件路径，也不存在任何可以修改词库的接口。

漏洞报告方式见 [SECURITY.md](./SECURITY.md)。

---

## 误杀与漏杀说明

关键词匹配是一种粗粒度手段，两个方向的错误都需要提前规划。

**误杀**在社区词库上不可避免。上游词库把高信号词、普通词汇、单字和人名混在一起。项目内置的
缓解手段包括：`defaultEnabled` 默认分类选择、最小词长 2、拉丁词的单词边界、人工复核标记流程
和白名单。即使如此，你仍然需要为自己的业务维护一份白名单。默认给出 `decision: 'review'` 而不是
`'block'`，正是因为这个原因。

**漏杀**同样不可避免。关键词无法覆盖改写、新造流行语、谐音、拼音、图片，以及任何依赖语境的
表达。`fuzzy` 模式只能应对机械式绕过（插空格、leetspeak），不能应对有创造性的绕过。

不要把它当作高风险系统的唯一关卡，请把它用于分流和初筛。

---

## 性能

使用 Aho–Corasick 算法，每个模式一个自动机，只在启动或 `reload()` 时构建，绝不在请求中重建。
没有巨型正则，也不会为每个请求复制词库。编译后的自动机使用扁平的 typed array（CSR 布局）而不是
`Map` 组成的对象图，这是 5 万词只占约 7 MiB 的原因。

以下数据由 `npm run benchmark` 在 Apple M4 Pro、Node v22.13.0、darwin-arm64 上实测得出。
都是那次运行的真实数字，请在自己的硬件上重新测量。

**自动机构建**（5 次构建取中位数，normalized 模式）：

| 词数   | 构建耗时 | Trie 节点数 | 自动机大小 |
| ------ | -------- | ----------- | ---------- |
| 1,000  | 1.8 ms   | 6,998       | 0.19 MiB   |
| 10,000 | 14.4 ms  | 61,582      | 1.64 MiB   |
| 50,000 | 87.0 ms  | 270,179     | 7.21 MiB   |

**扫描**（`findAll`，最长匹配优先，中文语料中掺入词库词）：

| 词数   | 1 KiB   | 10 KiB  | 100 KiB | 100 KiB 吞吐 |
| ------ | ------- | ------- | ------- | ------------ |
| 1,000  | 0.06 ms | 0.28 ms | 2.03 ms | 48 MiB/s     |
| 10,000 | 0.03 ms | 0.23 ms | 2.29 ms | 43 MiB/s     |
| 50,000 | 0.04 ms | 0.25 ms | 2.53 ms | 39 MiB/s     |

吞吐基本不随词数变化，这正是使用该算法的目的。

**端到端**：加载默认 17,689 词的 `createModerator()` 多次运行在 80–100 毫秒之间；对 420 字中文文本执行带掩码的
`check()`，中位数 0.029 毫秒（p95 0.036 毫秒）。

完整输出（含 p95 与运行环境）见 `data/reports/benchmark.md`。

---

## 本地开发

```bash
git clone https://github.com/open-moderation-lexicon/open-moderation-lexicon.git
cd open-moderation-lexicon
npm ci

npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run test:perf         # 性能回归测试，不在 CI 中运行
npm run build
npm run lexicon:validate
npm run benchmark
npm run dev               # 带热重载的服务，http://localhost:3000
```

目录结构：

```
src/core/        aho-corasick、normalizer、position-map、matcher、policy、masker、types
src/lexicon/     builder、loader、metadata、paths
src/api/         Fastify 服务、路由、JSON Schema、错误、配置
src/cli/         命令行工具
scripts/         sync-upstream、build-lexicon、validate-lexicon、generate-openapi、benchmark
data/upstream/   上游原始文件（便于 diff）
data/generated/  随包发布的构建产物
data/overrides/  分类配置、白名单、自定义词
data/reports/    构建、同步、复核与基准报告
tests/           单元、集成、性能测试
```

参与贡献请看 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 发布 npm 包

```bash
npm run ci                    # lint + 格式检查 + 类型检查 + 测试 + 构建 + 词库校验
npm pack --dry-run            # 检查将要发布的文件
npm version minor
npm publish                   # prepack 会重新构建 dist/ 并重新生成 openapi.json
git push --follow-tags
```

`package.json` 的 `files` 字段把发布内容限制为 `dist/`、`data/generated/`、
`data/overrides/`、`openapi.json`、`UPSTREAM.lock.json` 和文档。`data/upstream/`（约 1.1 MB
原始文本）留在 git 里但不进 npm 包。发布只能手动进行，CI 不会发布，所以词库变化不可能未经人工
决定就到达用户。

---

## Roadmap

以下都还没有实现，列在这里表示意向，不是承诺：

- [ ] 拼音与谐音匹配，需显式开启
- [ ] 分类严重级别从配置文件覆盖，而不是改代码
- [ ] 增量自动机，让 `reload()` 不必完整重建
- [ ] 面向超大文本的流式检测
- [ ] 可选的 Redis 限流，支持多实例部署
- [ ] 在本仓库维护一份高精度的精选词表
- [ ] CI 中发布跨 Node 版本的基准数据

明确排除：语义分析、大模型审核、图片和音频审核。这些是不同的问题，应该由不同的工具解决。

---

## 许可证

我们自己的代码使用 [MIT](./LICENSE)。词库数据为 MIT（Konsheng），OpenCC 映射表为
Apache-2.0（BYVoid），两者都在
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 中署名并保留许可证原文。

使用本软件并不意味着你的内容审核就是合法、完整或正确的。它只是一个关键词检测器，审核政策的
责任仍然在你自己。
