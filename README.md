# open-moderation-lexicon

[![CI](https://github.com/open-moderation-lexicon/open-moderation-lexicon/actions/workflows/ci.yml/badge.svg)](https://github.com/open-moderation-lexicon/open-moderation-lexicon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org)

Multilingual keyword-based moderation built on an open sensitive-word lexicon. Chinese and
English first. Ships as a TypeScript SDK, a self-hostable REST API and a CLI, with a
reproducible upstream sync pipeline.

[简体中文文档](./README.zh-CN.md)

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

## What this is, and what it is not

This is a **keyword detector with a configurable policy layer**. It answers "does this text
contain terms from a list, and where?" quickly and precisely.

It is **not** a semantic model. It does not understand meaning, intent, sarcasm, quotation
or context, and it makes no claim about whether any content is legal, harmful or acceptable.
A match is a signal for your own review process, not a verdict.

Concretely, the API keeps these four things separate so you can build your own rules:

| Field       | Meaning                                                                                |
| ----------- | -------------------------------------------------------------------------------------- |
| `matched`   | Whether any term was found. A fact about the text.                                     |
| `matchType` | The weakest rule needed for the hit: `exact`, `normalized` or `fuzzy`.                 |
| `riskLevel` | `none` / `low` / `medium` / `high`, derived from the severity of the terms that hit.   |
| `decision`  | `allow` / `review` / `block`, the output of **your** configured policy. Not a verdict. |

The default policy is deliberately cautious about blocking:

- nothing matched → `allow`
- something matched → `review`
- a `high` severity term matched → `block`

Only two of the eighteen upstream categories are `high` by default (`violence-terrorism`,
`weapons-explosives`), so `block` is rare unless you configure more. Everything is
configurable; see [Policy](#policy).

### Explicitly out of scope

Semantic analysis, homophone and context analysis, LLM-based moderation, image and audio
moderation, and pinyin fuzzy matching are **not implemented**, not stubbed and not
half-finished. See the [Roadmap](#roadmap) for what may come later.

---

## Install

```bash
npm install open-moderation-lexicon
```

Node.js >= 22.12 (Active LTS). ESM only. The lexicon ships inside the package, so nothing
is downloaded at runtime and the package works offline and in air-gapped environments.

---

## Quick start

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

`createModerator()` reads the artifact, filters it and builds the Aho–Corasick automaton
**once** (~80 ms for the default 17,689 terms). Create it at startup and reuse it; every
`check()` then runs in tens of microseconds. Never create one per request.

Full API:

| Method                      | Returns               | Notes                                          |
| --------------------------- | --------------------- | ---------------------------------------------- |
| `check(text, options?)`     | `ModerationResult`    | Everything: matches, decision, risk, mask      |
| `contains(text, options?)`  | `boolean`             | Fastest path, stops at the first hit           |
| `findFirst(text, options?)` | `Match \| undefined`  | Leftmost, longest hit                          |
| `findAll(text, options?)`   | `Match[]`             | Every hit after overlap reduction              |
| `mask(text, options?)`      | `string`              | Text with hits replaced                        |
| `getMetadata()`             | `LexiconMetadata`     | Version, upstream commit, categories, counts   |
| `reload()`                  | `Promise<void>`       | Re-read the artifact and rebuild the automaton |
| `warmup(mode)`              | `void`                | Compile a mode ahead of its first use          |
| `getMatcherStats()`         | `CompiledModeStats[]` | Node counts and memory per compiled mode       |

`CheckOptions` (all optional, per call):

```ts
moderator.check(text, {
  mode: 'normalized', // 'exact' | 'normalized' | 'fuzzy'
  categories: ['adult'], // filter to these categories
  returnMatches: true, // set false to get counts only
  maxMatches: 100, // cap the returned array
  overlap: 'leftmost-longest', // or 'all'
  mask: true,
  maskChar: '*',
  allowlist: ['例外'], // merged with the moderator-level allowlist
});
```

Synchronous construction from your own list, with no artifact on disk:

```ts
import { createModeratorFromTerms } from 'open-moderation-lexicon';

const moderator = createModeratorFromTerms([
  { term: '业务禁词', category: 'custom', severity: 'high' },
  '简写形式也可以',
]);
```

### REST API

```bash
# from a checkout
npm run dev

# or from an install
npx open-moderation-lexicon-server   # equivalently: node node_modules/open-moderation-lexicon/dist/api/serve.js
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

Endpoints:

| Method | Path                 | Purpose                                              |
| ------ | -------------------- | ---------------------------------------------------- |
| `GET`  | `/health`            | Liveness plus whether the lexicon finished loading   |
| `GET`  | `/v1/metadata`       | Lexicon version, upstream commit, categories, limits |
| `POST` | `/v1/moderate`       | Moderate one text                                    |
| `POST` | `/v1/moderate/batch` | Moderate up to `BATCH_MAX_ITEMS` texts (default 100) |
| `GET`  | `/docs`              | Swagger UI (disable with `ENABLE_DOCS=false`)        |
| `GET`  | `/docs/json`         | OpenAPI 3.1 document                                 |

Batch requests report per-item outcomes, so one invalid item never fails the whole request:

```bash
curl -X POST http://localhost:3000/v1/moderate/batch \
  -H "content-type: application/json" \
  -d '{"items":[{"id":"1","text":"干净内容"},{"id":"2","text":42}]}'
```

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

Errors always use the same envelope, and never contain a stack trace or a server path:

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
<summary>All error codes</summary>

| Code                     | HTTP | Cause                                         |
| ------------------------ | ---- | --------------------------------------------- |
| `TEXT_REQUIRED`          | 400  | `text` missing                                |
| `TEXT_NOT_STRING`        | 400  | `text` is not a string                        |
| `TEXT_EMPTY`             | 400  | `text` is `""`                                |
| `TEXT_BLANK`             | 400  | `text` is only whitespace                     |
| `TEXT_TOO_LONG`          | 413  | Longer than `MAX_TEXT_LENGTH`                 |
| `INVALID_JSON`           | 400  | Body is not parseable JSON                    |
| `UNSUPPORTED_MEDIA_TYPE` | 415  | `content-type` is not `application/json`      |
| `PAYLOAD_TOO_LARGE`      | 413  | Body exceeds `MAX_BODY_BYTES`                 |
| `INVALID_REQUEST`        | 400  | Schema validation failed                      |
| `BATCH_EMPTY`            | 400  | `items` is empty                              |
| `BATCH_TOO_LARGE`        | 400  | More than `BATCH_MAX_ITEMS` items             |
| `DUPLICATE_BATCH_ID`     | 400  | Two items share an `id`                       |
| `UNKNOWN_CATEGORY`       | 400  | Category id not present in the lexicon        |
| `INVALID_MODE`           | 400  | Mode other than exact/normalized/fuzzy        |
| `INVALID_MASK_CHAR`      | 400  | `maskChar` is not exactly one code point      |
| `UNAUTHORIZED`           | 401  | `API_TOKEN` set and the bearer token is wrong |
| `RATE_LIMITED`           | 429  | Rate limit exceeded                           |
| `NOT_FOUND`              | 404  | Unknown route                                 |
| `REQUEST_TIMEOUT`        | 408  | Request exceeded `REQUEST_TIMEOUT_MS`         |
| `SERVICE_UNAVAILABLE`    | 503  | Lexicon still loading                         |
| `LEXICON_LOAD_FAILED`    | 503  | Lexicon failed to load; the server stays up   |
| `INTERNAL_ERROR`         | 500  | Anything unexpected                           |

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

Exit codes: **0** nothing matched, **1** at least one match, **2** usage or configuration
error. That makes it usable in a pipeline:

```bash
if oml check --quiet "$MESSAGE"; then echo "clean"; else echo "needs review"; fi
```

Options: `--file`, `--mode`, `--categories`, `--overlap`, `--mask-char`, `--allowlist`,
`--include-review`, `--json`, `--quiet`, `--help`, `--version`.

### Docker

```bash
docker build -t open-moderation-lexicon .
docker run --rm -p 3000:3000 open-moderation-lexicon

# or
docker compose up
```

The image is a multi-stage build on `node:22-alpine`, runs as a non-root user, contains no
build toolchain and has a `HEALTHCHECK` wired to `/health`.

---

## Matching modes

### `exact`

Matches the raw text. Chinese and other scripts without word separators match as
substrings; Latin-script terms require a word boundary, so `ass` does not match `class`.

### `normalized` (default)

Normalizes both the text and the lexicon before matching:

- Unicode NFKC (`ｆｕｌｌｗｉｄｔｈ` → `fullwidth`, `①` → `1`, `ﬁ` → `fi`)
- lowercase for Latin letters
- zero-width characters and variation selectors removed (`法\u200b轮功` → `法轮功`)
- traditional → simplified Chinese (`法輪功` → `法轮功`), via OpenCC's single-character table
- whitespace unified (non-breaking space, ideographic space, tabs → a single space)
- combining marks composed onto their base character (`e` + `◌́` → `é`)

Every transformation keeps a **position map** back to the original text, so reported offsets
always point at the real characters the user typed, including when normalization changed the
length of the string.

### `fuzzy` (opt-in)

Everything `normalized` does, plus:

- separators dropped inside terms (`b-a-d-w-o-r-d`, `b a d w o r d`, `b.a.d.w.o.r.d`)
- common leetspeak folded (`0`→`o`, `1`→`i`, `3`→`e`, `4`→`a`, `5`→`s`, `7`→`t`, `@`→`a`, `$`→`s`)
- optionally, runs of a repeated character collapsed (`baaadword` → `badword`); off by default

Fuzzy matching is **off by default** because it increases false positives. Hits found only
through fuzzy rules are reported as `matchType: 'fuzzy'`, so you can treat them differently.
Terms shorter than `fuzzy.minTermLength` (default 3) are excluded from fuzzy matching
entirely, because short folded terms match almost anything.

These are deterministic string heuristics. There is no model and no probability, and the
results are never presented as one.

```ts
const moderator = await createModerator({
  mode: 'fuzzy',
  fuzzy: { collapseRepeats: true, minTermLength: 4 },
});
```

### `matchType` semantics

`matchType` reports the **weakest rule that was sufficient**, not the mode you asked for.
Running in `fuzzy` mode on text that contains a term verbatim yields `matchType: 'exact'`.
This lets you weight hits: `exact` is the strongest evidence, `fuzzy` the weakest.

---

## Positions

`start` and `end` are **Unicode code point offsets** into the original text, half-open
(`[start, end)`). Code points, not UTF-16 code units, so astral characters count as one:

```ts
const moderator = await createModerator();
const result = moderator.check('🎉🎉法轮功');
result.matches[0]; // { start: 2, end: 5 }  ← not 4..7
```

To slice with them, go through an array of code points rather than `String.prototype.slice`:

```ts
const codePoints = [...text];
const hit = codePoints.slice(match.start, match.end).join('');
```

`matchedText` is already sliced for you, so you rarely need to do this yourself.

---

## Policy

`riskLevel` is the highest severity among the hits. `decision` is computed from a policy you
control:

```ts
const moderator = await createModerator({
  policy: {
    blockSeverities: ['high'], // severities that force `block`
    blockCategories: ['weapons-explosives'], // categories that always block
    allowCategories: ['advertising'], // categories downgraded to `allow`
    blockMinHitCount: 1, // blocking hits needed before `block`
  },
});
```

Server equivalents: `POLICY_BLOCK_SEVERITIES`, `POLICY_BLOCK_CATEGORIES`,
`POLICY_ALLOW_CATEGORIES`.

---

## Lexicon

### Source

| Field           | Value                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| Upstream        | [konsheng/Sensitive-lexicon](https://github.com/konsheng/Sensitive-lexicon) |
| Author          | Konsheng                                                                    |
| License         | MIT (preserved at `data/upstream/LICENSE`)                                  |
| Commit          | `5a8da94c61c160e203a6b2fcfafbea642404d50c`                                  |
| Commit date     | 2026-06-15                                                                  |
| Synced          | 2026-07-29                                                                  |
| Lexicon version | `2026.07.29`                                                                |

Also vendored: OpenCC's `TSCharacters.txt` (Apache-2.0) for the traditional → simplified
table. Both are recorded with checksums in [`UPSTREAM.lock.json`](./UPSTREAM.lock.json) and
credited in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

### Numbers from the current build

| Metric                                     | Value  |
| ------------------------------------------ | ------ |
| Raw term lines across 18 files             | 87,044 |
| Terms after de-duplication                 | 51,336 |
| Duplicates removed                         | 35,695 |
| Terms loaded by default                    | 17,689 |
| Single-character terms (flagged, excluded) | 993    |
| Suspicious terms (flagged)                 | 1,872  |

Reports are regenerated on every build: `data/reports/build-report.md`,
`data/reports/review-needed.json`, `data/reports/sync-report.md`.

### Default category selection, and why it matters

The upstream project includes both narrow lists (`暴恐词库`, `涉枪涉爆`) and very broad ones
(`零时-Tencent` at ~42k lines, `GFW补充词库`, `网易前端过滤敏感词库`). The broad lists contain
ordinary words. In them, `this`, `IS` and `联系` are all "sensitive terms". Loading them by
default would make the library flag `This is a class of assets` — a false positive rate that
makes the tool useless.

So categories carry a `defaultEnabled` flag, set in
[`data/overrides/category-config.json`](./data/overrides/category-config.json):

- `categories: ['all']` (the default) loads only `defaultEnabled` categories — **17,689 terms**
- `categories: ['*']` loads **everything**, 51,336 terms, with a much higher false-positive rate
- an explicit list (`categories: ['adult', 'general-tencent']`) loads exactly those, regardless
  of the flag

`GET /v1/metadata` and `oml metadata` list every category with its flag and its loaded term
count, so nothing is hidden: categories excluded from your selection appear with
`termCount: 0`. Nothing is deleted; you opt in.

Currently disabled by default: `censorship-gfw`, `general-netease`, `general-tencent`,
`misc`, `social-issues`, `advertising`.

### Customizing

Three layers, no rebuild required for the last two:

1. **Category config** — `data/overrides/category-config.json` maps upstream files to
   category ids, display names, severities and `defaultEnabled`. Changing it requires
   `npm run lexicon:build`.
2. **Allowlist** — `data/overrides/allowlist.txt`, one term per line, `#` for comments. A
   term on the allowlist never produces a hit; a phrase on the allowlist suppresses hits it
   fully covers, so `联系` can be allowed inside `保持联系` without allowing it everywhere.
3. **Custom terms** — `data/overrides/custom-terms.json`, or `customTerms` in code, or your
   own files in `data/overrides/local-terms/*.txt` (those are picked up by the build).

### Terms flagged for review

Single-character terms, terms longer than 64 characters, terms that are only digits or
punctuation, HTML-like fragments and terms containing control characters are kept in the
artifact but flagged, and excluded from loading by default. They are listed in
`data/reports/review-needed.json` for a human to look at. Nothing is silently deleted.
Set `includeNeedsReview: true` (or `LEXICON_INCLUDE_NEEDS_REVIEW=true`) to load them anyway.

### Upstream sync

```bash
npm run lexicon:sync            # fetch the latest upstream commit into data/upstream/
npm run lexicon:sync -- --check # exit code 10 if upstream moved; used by CI
npm run lexicon:sync -- --dry-run
npm run lexicon:sync -- --ref <sha>
npm run lexicon:build           # data/upstream/ -> data/generated/ + reports
npm run lexicon:validate        # verify checksums, structure and a live match
```

The sync never overwrites silently: it prints added, removed and changed files, added and
removed terms per category, and writes `data/reports/sync-report.md`. Category assignments
in `category-config.json` are never touched automatically, so a new upstream file shows up
as an explicit "unmapped source" that a human has to categorize.

A GitHub Action runs weekly, and opens a pull request when upstream moves. It never merges
and never publishes; a human reviews the term diff. See
[`.github/workflows/upstream-sync.yml`](./.github/workflows/upstream-sync.yml).

---

## Configuration

Server environment variables. See [`.env.example`](./.env.example) for the annotated list.

| Variable                       | Default           | Purpose                                            |
| ------------------------------ | ----------------- | -------------------------------------------------- |
| `HOST`, `PORT`                 | `0.0.0.0`, `3000` | Listen address                                     |
| `LOG_LEVEL`                    | `info`            | Pino level                                         |
| `MAX_TEXT_LENGTH`              | `20000`           | Per-text limit                                     |
| `MAX_BODY_BYTES`               | `1048576`         | Request body limit                                 |
| `BATCH_MAX_ITEMS`              | `100`             | Batch size limit                                   |
| `DEFAULT_MODE`                 | `normalized`      | Mode when the request omits one                    |
| `PRECOMPILE_MODES`             | `normalized`      | Modes compiled at startup                          |
| `LEXICON_CATEGORIES`           | `all`             | `all`, `*`, or a comma separated list              |
| `LEXICON_MIN_TERM_LENGTH`      | `2`               | Drop shorter terms                                 |
| `LEXICON_INCLUDE_NEEDS_REVIEW` | `false`           | Load flagged terms                                 |
| `POLICY_BLOCK_SEVERITIES`      | `high`            | Severities that block                              |
| `POLICY_BLOCK_CATEGORIES`      | (empty)           | Categories that always block                       |
| `POLICY_ALLOW_CATEGORIES`      | (empty)           | Categories that never escalate                     |
| `MASK_CHAR`                    | `*`               | Default mask character                             |
| `CORS_ORIGIN`                  | (disabled)        | `*`, or a comma separated origin list              |
| `RATE_LIMIT_MAX`               | `120`             | Requests per window per IP                         |
| `RATE_LIMIT_WINDOW`            | `1 minute`        | Window                                             |
| `API_TOKEN`                    | (none)            | When set, `/v1/*` requires `Authorization: Bearer` |
| `ENABLE_DOCS`                  | `true`            | Serve Swagger UI                                   |
| `LOG_TEXT`                     | `false`           | **Logs user content when true**                    |
| `TRUST_PROXY`                  | `false`           | Trust `X-Forwarded-For` for rate limiting          |
| `REQUEST_TIMEOUT_MS`           | `30000`           | Request timeout                                    |

---

## Privacy

- **Submitted text is never logged by default.** Logs contain a request id, the duration,
  the text length, the hit count and the matched categories — not the text and not the
  matched terms. `LOG_TEXT=true` changes that; it exists for local debugging and is a
  deliberate choice you make about your users' data.
- No telemetry, no analytics, no outbound network calls at runtime. The lexicon is on disk.
- Nothing is persisted: no request store, no database, no cache of submitted text.
- Secrets are read from environment variables only. The repository contains no credentials,
  and `API_TOKEN` has no default.
- The server never accepts a file path from a client, and there is no endpoint that can
  modify the lexicon.

See [SECURITY.md](./SECURITY.md) for reporting vulnerabilities.

---

## False positives and false negatives

Keyword matching is blunt. Please plan for both directions.

**False positives** are unavoidable with community word lists. Upstream lists mix
high-signal terms with ordinary words, single characters and personal names. Mitigations
built in: the `defaultEnabled` selection, a minimum term length of 2, word boundaries for
Latin terms, the review-flagging pipeline and the allowlist. Even so, expect to curate an
allowlist for your own domain. `decision: 'review'` rather than `'block'` is the default for
exactly this reason.

**False negatives** are equally unavoidable. Keyword lists do not catch paraphrase, new
slang, homophones (谐音), pinyin, images or anything requiring context. `fuzzy` mode catches
mechanical evasion (spacing, leetspeak), not creative evasion.

Do not use this as the only gate on a system where being wrong is costly. Use it to triage.

---

## Performance

Aho–Corasick, one automaton per mode, built at startup or on `reload()` and never per
request. No giant regex, no per-request copy of the lexicon. The compiled automaton lives in
flat typed arrays (CSR layout) rather than a graph of `Map` objects, which is what keeps
50k terms at ~7 MiB.

Measured with `npm run benchmark` on an Apple M4 Pro, Node v22.13.0, darwin-arm64. These are
real numbers from that run; re-run the command for your own hardware.

**Automaton construction** (median of 5 builds, normalized mode):

| Terms  | Build time | Trie nodes | Automaton size |
| ------ | ---------- | ---------- | -------------- |
| 1,000  | 1.8 ms     | 6,998      | 0.19 MiB       |
| 10,000 | 14.4 ms    | 61,582     | 1.64 MiB       |
| 50,000 | 87.0 ms    | 270,179    | 7.21 MiB       |

**Scanning** (`findAll`, leftmost-longest, Chinese prose with terms sprinkled in):

| Terms  | 1 KiB   | 10 KiB  | 100 KiB | Throughput at 100 KiB |
| ------ | ------- | ------- | ------- | --------------------- |
| 1,000  | 0.06 ms | 0.28 ms | 2.03 ms | 48 MiB/s              |
| 10,000 | 0.03 ms | 0.23 ms | 2.29 ms | 43 MiB/s              |
| 50,000 | 0.04 ms | 0.25 ms | 2.53 ms | 39 MiB/s              |

Throughput is essentially flat in the number of terms, which is the point of the algorithm.

**End to end**: `createModerator()` with the default 17,689 terms takes 80–100 ms across
runs. A `check()` with masking on a 420-character Chinese text has a median of 0.029 ms
(p95 0.036 ms).

Full output, including p95s and the environment: `data/reports/benchmark.md`.

---

## Development

```bash
git clone https://github.com/open-moderation-lexicon/open-moderation-lexicon.git
cd open-moderation-lexicon
npm ci

npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run test:perf         # performance guard rails, excluded from CI
npm run build
npm run lexicon:validate
npm run benchmark
npm run dev               # server with reload on http://localhost:3000
```

Layout:

```
src/core/        aho-corasick, normalizer, position-map, matcher, policy, masker, types
src/lexicon/     builder, loader, metadata, paths
src/api/         Fastify server, routes, JSON schemas, errors, config
src/cli/         CLI
scripts/         sync-upstream, build-lexicon, validate-lexicon, generate-openapi, benchmark
data/upstream/   verbatim upstream files (diffable)
data/generated/  build artifact shipped in the package
data/overrides/  category config, allowlist, custom terms
data/reports/    build, sync, review and benchmark reports
tests/           unit, integration, performance
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Publishing

```bash
npm run ci                    # lint + typecheck + test + build + validate
npm pack --dry-run            # inspect the tarball contents
npm version minor
npm publish                   # prepack rebuilds dist/ and regenerates openapi.json
git push --follow-tags
```

`files` in `package.json` limits the tarball to `dist/`, `data/generated/`,
`data/overrides/`, `openapi.json`, `UPSTREAM.lock.json` and the docs. `data/upstream/`
(1.1 MB of raw text) stays in git but out of the package. Publishing is manual and never
done by CI, so a lexicon change cannot reach users without a human deciding to release it.

---

## Roadmap

Not implemented today. Listed here as intent, not as a promise:

- [ ] Pinyin and homophone matching, behind an explicit opt-in flag
- [ ] Per-category severity overrides from a config file rather than code
- [ ] An incremental automaton so `reload()` avoids a full rebuild
- [ ] Streaming moderation for text larger than memory
- [ ] Optional Redis-backed rate limiting for multi-instance deployments
- [ ] A curated, high-precision default list maintained in this repository
- [ ] Published benchmarks across Node versions in CI

Deliberately excluded: semantic analysis, LLM-based moderation, image and audio moderation.
Those are different problems and belong in different tools.

---

## License

[MIT](./LICENSE) for our code. The lexicon data is MIT (Konsheng) and the OpenCC table is
Apache-2.0 (BYVoid); both are credited and license-preserved in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

Using this software does not make your content moderation lawful, complete or correct. It is
a keyword detector. You remain responsible for your own policies.
