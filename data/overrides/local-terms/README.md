# Locally maintained term files

Drop plain-text files here, one term per line, to extend the generated lexicon with
terms this project owns instead of importing from upstream.

- File name (without extension) becomes the category id when it is not listed in
  `../category-config.json`.
- Comment lines starting with `#` and empty lines are ignored.
- Terms added here are part of the build output, so run `npm run lexicon:build`
  afterwards. Entries get `upstreamCommit: null` so their provenance stays distinct
  from upstream data.
- For terms that should apply without a rebuild, use `../custom-terms.json` instead.
