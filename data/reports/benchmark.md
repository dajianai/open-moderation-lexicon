# Benchmark

- Generated: 2026-07-29T08:49:08.746Z
- Node: v22.13.0
- Platform: darwin-arm64
- CPU: Apple M4 Pro (12 threads)
- Lexicon: 2026.07.29, 50837 terms available

## Automaton construction (normalized mode)

| Terms | Build time | Patterns | Trie nodes | Automaton size |
| --- | --- | --- | --- | --- |
| 1000 | 2.045 ms | 1000 | 6998 | 0.19 MiB |
| 10000 | 15.399 ms | 9938 | 61582 | 1.64 MiB |
| 50000 | 113.578 ms | 48431 | 270179 | 7.21 MiB |

## Scanning (findAll, leftmost-longest)

| Terms | Text size | Median | p95 | Throughput | Matches |
| --- | --- | --- | --- | --- | --- |
| 1000 | 1 KiB | 0.061 ms | 0.187 ms | 16.947 MiB/s | 2 |
| 1000 | 10 KiB | 0.284 ms | 0.824 ms | 34.68 MiB/s | 19 |
| 1000 | 100 KiB | 1.924 ms | 2.649 ms | 50.794 MiB/s | 189 |
| 10000 | 1 KiB | 0.025 ms | 0.245 ms | 41.671 MiB/s | 2 |
| 10000 | 10 KiB | 0.22 ms | 0.225 ms | 44.479 MiB/s | 19 |
| 10000 | 100 KiB | 2.344 ms | 3.26 ms | 41.688 MiB/s | 189 |
| 50000 | 1 KiB | 0.028 ms | 0.048 ms | 36.993 MiB/s | 10 |
| 50000 | 10 KiB | 0.247 ms | 1 ms | 39.723 MiB/s | 95 |
| 50000 | 100 KiB | 2.621 ms | 15.511 ms | 37.29 MiB/s | 946 |

## End to end SDK call

`createModerator()` (read artifact, filter, build automaton): 99.117 ms.

check() with masking on a 420 character Chinese text, default selection of 17689 terms: median 0.028 ms, p95 0.03 ms.

Numbers depend on hardware and on how many terms the text actually contains.
Re-run `npm run benchmark` to measure your own environment.

