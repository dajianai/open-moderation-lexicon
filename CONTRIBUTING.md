# Contributing

Thanks for considering a contribution. This project has a narrow scope on purpose, so the
most useful thing you can do before writing code is to check that your idea fits it.

## Scope

In scope: keyword matching correctness and performance, normalization edge cases, lexicon
curation and tooling, the API and CLI surface, documentation, tests.

Out of scope: semantic analysis, LLM-based moderation, image or audio moderation. Pull
requests adding those will be closed with a pointer to the Roadmap discussion, not because
they are bad ideas but because they are a different project.

## Setup

```bash
npm ci
npm test
```

Node.js >= 22.12 is required. There is no build step for development; `tsx` runs TypeScript
directly.

## Before opening a pull request

```bash
npm run ci
```

That runs lint, format check, typecheck, the full test suite, the build and the lexicon
validation — the same commands CI runs. Please also run `npm run test:perf` if you touched
anything under `src/core/`.

## Conventions

- **TypeScript strict, ESM, no `any`.** `unknown` plus a narrowing check instead.
- **Comments explain why, not what.** If a comment restates the code, delete it. Do document
  non-obvious invariants: the position-mapping rules in `src/core/position-map.ts` are the
  canonical example of a comment that earns its place.
- **Offsets are Unicode code points.** Every public offset, everywhere. If you introduce a
  UTF-16 offset internally, name it so, and convert at the boundary.
- **No new runtime dependencies** without discussing it in an issue first. The SDK's value
  includes being small and auditable.
- **Tests for behaviour, not implementation.** Use `tests/fixtures/terms.ts` for behavioural
  tests so they stay stable when upstream data changes. Assert against the real lexicon only
  for provenance and false-positive guard rails.
- Prettier decides formatting. Don't argue with it, run `npm run format`.

## Testing

| Directory            | What belongs there                                            |
| -------------------- | ------------------------------------------------------------- |
| `tests/unit/`        | One module at a time, fixture data only                       |
| `tests/integration/` | The API via `app.inject()`, the CLI via `run()`, real lexicon |
| `tests/performance/` | Timing guard rails, excluded from CI (`npm run test:perf`)    |

The 30 scenarios from the original specification live in `tests/unit/scenarios.test.ts`,
numbered in comments. If you fix a matching bug, add a numbered scenario there.

## Changing the lexicon

Do not edit `data/upstream/` by hand. It is a verbatim mirror, and the checksums in
`UPSTREAM.lock.json` are validated by `npm run lexicon:validate`.

To change how terms are categorized or how severe they are, edit
`data/overrides/category-config.json` and run:

```bash
npm run lexicon:build
npm run lexicon:validate
npm test
```

Commit the regenerated `data/generated/` and `data/reports/` along with the config change, so
reviewers can see the effect on term counts.

To add your own terms, put them in `data/overrides/local-terms/*.txt` rather than in the
upstream mirror.

### Raising or lowering a severity

`high` severity means the default policy returns `block`. That is a strong claim, so moving a
category to `high` needs a justification in the pull request description: which terms, why
they are unambiguous, and what the false-positive risk is.

Moving a broad category to `defaultEnabled: true` needs evidence that it does not flag
ordinary prose. `tests/integration/real-lexicon.test.ts` has prose samples for exactly this;
extend them.

## Commit messages

Plain, imperative, one line where possible. `fix: word boundary in fuzzy mode after dropped
separators` is ideal. Conventional Commit prefixes are welcome but not enforced.

## Reporting a false positive

Open an issue with the term, the text it wrongly matched, and the output of
`oml check --json "<text>"`. Include which category the term came from — the JSON output has
it. False positive reports are genuinely useful; they are how the default selection improves.

Please do **not** paste real user content into an issue.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](./SECURITY.md).

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
