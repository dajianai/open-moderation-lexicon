# Lexicon build report

- Built at: 2026-09-14T09:02:24.404Z
- Lexicon version: 2026.09.14
- Upstream commit: d967c30b053fa40b06c5a0dddf0be493f2dfae46
- Upstream synced at: 2026-09-14T09:02:24.107Z

## Totals

| Metric | Value |
| --- | --- |
| Raw term lines | 87044 |
| Empty or comment lines | 14 |
| Terms before de-duplication | 87044 |
| Terms after de-duplication | 51336 |
| Duplicates removed | 35695 |
| Duplicates across source files | 23458 |
| Terms re-assigned to a higher-severity category | 14952 |
| Normalized-form collisions | 1674 |
| Single-character terms | 993 |
| Suspicious terms (flagged) | 1872 |
| Terms kept but flagged for review | 1368 |

## Per category

| Category | Display name | Severity | Terms |
| --- | --- | --- | --- |
| `adult` | 色情类型 | medium | 304 |
| `adult-extended` | 色情词库 | medium | 249 |
| `advertising` | 广告类型 | low | 89 |
| `censorship-gfw` | GFW 补充词库 | low | 5844 |
| `corruption` | 贪腐词库 | low | 171 |
| `covid-19` | COVID-19 词库 | low | 70 |
| `general-netease` | 网易前端过滤敏感词库 | low | 7350 |
| `general-tencent` | 零时-Tencent | low | 19925 |
| `illegal-url` | 非法网址 | medium | 14594 |
| `misc` | 其他词库 | low | 149 |
| `politics` | 政治类型 | medium | 296 |
| `politics-dissent` | 反动词库 | medium | 548 |
| `politics-ideology` | 新思想启蒙 | low | 16 |
| `politics-organized` | 政治类型（Organized） | medium | 0 |
| `social-issues` | 民生词库 | low | 287 |
| `supplementary` | 补充词库 | low | 832 |
| `violence-terrorism` | 暴恐词库 | high | 178 |
| `weapons-explosives` | 涉枪涉爆 | high | 434 |

## Per source file

Kept terms counts the terms a file contributed *first*. Terms an earlier file already
contributed are counted there, unless they were re-assigned by severity.

| Source | Category | Raw lines | Skipped lines | Kept terms |
| --- | --- | --- | --- | --- |
| `Organized/政治类型.txt` | `politics-organized` | 0 | 2 | 0 |
| `Vocabulary/COVID-19词库.txt` | `covid-19` | 76 | 0 | 72 |
| `Vocabulary/GFW补充词库.txt` | `censorship-gfw` | 6414 | 1 | 6170 |
| `Vocabulary/其他词库.txt` | `misc` | 157 | 2 | 152 |
| `Vocabulary/反动词库.txt` | `politics-dissent` | 557 | 0 | 476 |
| `Vocabulary/广告类型.txt` | `advertising` | 123 | 1 | 93 |
| `Vocabulary/政治类型.txt` | `politics` | 326 | 1 | 249 |
| `Vocabulary/新思想启蒙.txt` | `politics-ideology` | 16 | 1 | 16 |
| `Vocabulary/暴恐词库.txt` | `violence-terrorism` | 178 | 0 | 139 |
| `Vocabulary/民生词库.txt` | `social-issues` | 571 | 0 | 291 |
| `Vocabulary/涉枪涉爆.txt` | `weapons-explosives` | 437 | 1 | 429 |
| `Vocabulary/网易前端过滤敏感词库.txt` | `general-netease` | 7746 | 1 | 7365 |
| `Vocabulary/色情类型.txt` | `adult` | 304 | 1 | 182 |
| `Vocabulary/色情词库.txt` | `adult-extended` | 929 | 0 | 180 |
| `Vocabulary/补充词库.txt` | `supplementary` | 1064 | 1 | 832 |
| `Vocabulary/贪腐词库.txt` | `corruption` | 244 | 0 | 171 |
| `Vocabulary/零时-Tencent.txt` | `general-tencent` | 53308 | 0 | 34519 |
| `Vocabulary/非法网址.txt` | `illegal-url` | 14594 | 2 | 0 |

## Flagged term issues

| Issue | Count |
| --- | --- |
| single-character | 993 |
| digits-only | 879 |
| punctuation-only | 13 |
| contains-whitespace | 1 |

