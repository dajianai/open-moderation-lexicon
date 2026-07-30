# Summary

<!-- What changes, and why. One or two sentences is usually enough. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Lexicon or category configuration change
- [ ] Documentation
- [ ] Refactor, build or CI

## Verification

<!-- `npm run ci` runs all of these. Tick what you actually ran. -->

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run lexicon:validate`
- [ ] `npm run test:perf` (required if `src/core/` changed)

## Checklist

- [ ] Tests cover the change; a matching fix adds a numbered scenario to
      `tests/unit/scenarios.test.ts`
- [ ] Public API changes are reflected in both `README.md` and `README.zh-CN.md`
- [ ] `CHANGELOG.md` has an entry under Unreleased
- [ ] No new runtime dependency (or it was agreed in an issue first)
- [ ] Offsets I introduced are Unicode code point offsets
- [ ] Any performance number I quote comes from `npm run benchmark`, not an estimate

## If this changes the lexicon

- [ ] `data/upstream/` was not edited by hand
- [ ] `data/generated/` and `data/reports/` were regenerated with `npm run lexicon:build`
- [ ] Term count changes are explained below
- [ ] A category moved to `high` severity or to `defaultEnabled: true` is justified below,
      with evidence that it does not flag ordinary prose

<!--
Term count before / after:
Categories affected:
-->

## If this affects matching behaviour

<!--
Describe what now matches that did not before, or vice versa. Callers rely on this
being predictable, and a change here can silently alter what a downstream service
blocks.
-->
