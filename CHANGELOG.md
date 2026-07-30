# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Lexicon data changes are versioned separately from the code: the lexicon carries a date-based
version (`2026.07.29`) and its own upstream commit, both reported by `GET /v1/metadata`. A
lexicon refresh is released as a minor version, because term counts changing can change what
your application sees.

## [Unreleased]

## [0.1.0] - 2026-07-29

First release.

### Added

- **Core matcher.** Aho–Corasick automaton over Unicode code points, compiled into flat typed
  arrays (CSR layout). One automaton per match mode, built at startup or on `reload()` and
  never per request.
- **Three match modes.** `exact` (raw text, word boundaries for Latin terms), `normalized`
  (default: NFKC, case folding, zero-width removal, full-width to half-width, traditional to
  simplified, whitespace unification) and `fuzzy` (opt-in: separator insertion, leetspeak,
  optional repeated-character collapsing).
- **Position mapping.** Every offset is a Unicode code point offset into the original text and
  survives normalization, including astral characters, zero-width characters, full-width forms
  and combining marks.
- **TypeScript SDK.** `createModerator()`, `createModeratorFromTerms()`, `check()`,
  `contains()`, `findFirst()`, `findAll()`, `mask()`, `getMetadata()`, `reload()`, `warmup()`,
  `getMatcherStats()`, with complete types.
- **Policy layer.** `riskLevel` from term severity; `decision` (`allow`/`review`/`block`) from
  a configurable policy that only blocks on `high` severity by default.
- **REST API.** Fastify 5 with JSON Schema validation on requests and responses: `GET /health`,
  `GET /v1/metadata`, `POST /v1/moderate`, `POST /v1/moderate/batch`. Configurable CORS, rate
  limiting, optional bearer token, request timeouts, body size limits.
- **OpenAPI 3.1** document generated from the live schemas (`openapi.json`), served with
  Swagger UI at `/docs`.
- **CLI.** `check`, `mask` and `metadata` with `--file`, `--mode`, `--categories`, `--overlap`,
  `--mask-char`, `--allowlist`, `--json`, `--quiet`, and exit codes 0 (clean) / 1 (matched) /
  2 (error).
- **Lexicon pipeline.** `lexicon:sync` (reproducible upstream fetch with a diff report),
  `lexicon:build` (cleaning, de-duplication, categorization, language detection, review
  flagging) and `lexicon:validate` (checksums, structure, a live match). Reports written to
  `data/reports/`.
- **Upstream provenance.** `UPSTREAM.lock.json` pins the upstream commit and a SHA-256 per
  file; `THIRD_PARTY_NOTICES.md` credits konsheng/Sensitive-lexicon (MIT) and BYVoid/OpenCC
  (Apache-2.0).
- **`defaultEnabled` category selection.** Broad upstream lists that contain ordinary words are
  excluded from the default selection, cutting the loaded lexicon from 51,336 to 17,689 terms
  and removing false positives such as `this`, `IS` and `联系`. `categories: ['*']` opts back in.
- **Overrides.** `data/overrides/category-config.json`, `allowlist.txt`, `custom-terms.json`
  and `local-terms/*.txt`, the last three applied at load time without a rebuild.
- **Docker.** Multi-stage `node:22-alpine` image running as a non-root user, plus
  `docker-compose.yml`.
- **Benchmarks.** `npm run benchmark` measures construction and scan throughput at 1k/10k/50k
  terms against 1/10/100 KiB texts and writes `data/reports/benchmark.md`. The README publishes
  only measured numbers.
- **Tests.** 165 tests: the 30 specified scenarios, unit tests for every core module, API
  integration tests via `app.inject()`, CLI tests, real-lexicon provenance and false-positive
  guard rails, plus separate performance guard rails (`npm run test:perf`).
- **CI.** Lint, format check, typecheck, tests and build on Node 22 and 24; a weekly upstream
  sync workflow that opens a pull request and never merges or publishes automatically.

### Known limitations

- Keyword matching only. No semantic analysis, homophone or pinyin matching, and no image or
  audio support.
- The upstream lexicon mixes precise terms with ordinary words; curating an allowlist for your
  own domain is expected.
- Traditional to simplified conversion uses OpenCC's single-character table, so phrase-level
  differences in vocabulary are not converted.
- The rate limiter is per process, so multi-instance deployments should enforce limits at the
  proxy.
- `reload()` rebuilds the automaton from scratch; there is no incremental update.

[Unreleased]: https://github.com/open-moderation-lexicon/open-moderation-lexicon/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/open-moderation-lexicon/open-moderation-lexicon/releases/tag/v0.1.0
