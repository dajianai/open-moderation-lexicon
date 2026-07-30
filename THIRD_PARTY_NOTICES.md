# Third-party notices

This repository redistributes data and code created by other authors. Their copyright
notices and licenses are reproduced below. Nothing here has been removed, rewritten or
re-attributed: the upstream authors remain the authors of their work.

Machine-readable provenance for the vendored data lives in
[`UPSTREAM.lock.json`](./UPSTREAM.lock.json).

---

## 1. konsheng/Sensitive-lexicon — the sensitive-word lexicon

- **Project**: Sensitive-lexicon
- **Author**: Konsheng
- **Repository**: https://github.com/konsheng/Sensitive-lexicon
- **License**: MIT
- **Synced commit**: `5a8da94c61c160e203a6b2fcfafbea642404d50c`
- **Upstream commit date**: 2026-06-15T17:19:48Z
- **Synced at**: 2026-07-29
- **Vendored into**: `data/upstream/Organized/`, `data/upstream/Vocabulary/`
- **Derived artifacts**: `data/generated/lexicon.json`, `data/generated/metadata.json`

The word lists in `data/upstream/` are an unmodified copy of the upstream files at the
commit above. `data/generated/` is a build product derived from them: lines are trimmed,
BOMs are stripped, duplicates are removed and a category plus a severity is attached.
The terms themselves are not edited. The upstream `LICENSE` file is preserved verbatim at
`data/upstream/LICENSE`, and the upstream README at `data/upstream/README.upstream.md`.

Upstream license text:

```
MIT License

Copyright (c) 2024~2099 Konsheng

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. BYVoid/OpenCC — traditional to simplified character mapping

- **Project**: OpenCC (Open Chinese Convert)
- **Author**: Carbo Kuo (BYVoid) and OpenCC contributors
- **Repository**: https://github.com/BYVoid/OpenCC
- **License**: Apache License 2.0
- **Vendored file**: `data/vendor/opencc/TSCharacters.txt`
- **Vendored commit**: `56d028aa324c407a51b74da7891450e408432569`
- **Derived artifact**: `src/core/data/traditional-simplified.ts`

Only the single-character traditional-to-simplified table is used. It is compiled into a
TypeScript data module by `scripts/generate-tscharacters.mjs` so that normalization works
offline, with no runtime download and no native dependency. Where OpenCC maps one
traditional character to several simplified candidates, the first candidate is kept; this
is a lossy simplification of OpenCC's behaviour and is not endorsed by its authors.

Apache-2.0 requires that we state the following: this product includes software developed
by the OpenCC project, and the vendored file has been transformed (reformatted into a
TypeScript module, with multi-character candidates reduced to the first one). The full
license text is available at https://www.apache.org/licenses/LICENSE-2.0.

```
Copyright 2010-2020 BYVoid <byvoid@byvoid.com>

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## 3. Runtime dependencies

The published npm package depends on Fastify and three of its plugins, all MIT licensed.
They are installed from the npm registry rather than vendored, so their license texts ship
with them in `node_modules`.

| Package               | License | Used for                    |
| --------------------- | ------- | --------------------------- |
| `fastify`             | MIT     | REST API server             |
| `@fastify/cors`       | MIT     | Configurable CORS           |
| `@fastify/rate-limit` | MIT     | Basic rate limiting         |
| `@fastify/swagger`    | MIT     | OpenAPI document generation |
| `@fastify/swagger-ui` | MIT     | Swagger UI at `/docs`       |

Nothing under `src/core/`, `src/lexicon/`, `src/cli/` or `src/index.ts` imports Fastify, so
the SDK and the CLI run on Node.js alone. Fastify is a regular dependency (rather than an
optional peer) purely so that `npm install open-moderation-lexicon` gives you a working
server without a second install step.

---

## 4. Our own code

Everything under `src/`, `scripts/`, `tests/` and `data/overrides/` is original work by
the open-moderation-lexicon contributors and is MIT licensed. See [LICENSE](./LICENSE).
