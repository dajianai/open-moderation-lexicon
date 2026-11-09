# Lexicon build report

- Built at: 2026-11-09T11:42:01.354Z
- Lexicon version: 2026.11.09
- Upstream commit: 68a595fb24d31bd9f882c081b4252443a69ac57b
- Upstream synced at: 2026-11-09T11:42:00.974Z

## Totals

| Metric | Value |
| --- | --- |
| Raw term lines | 100406 |
| Empty or comment lines | 17 |
| Terms before de-duplication | 100406 |
| Terms after de-duplication | 64260 |
| Duplicates removed | 36133 |
| Duplicates across source files | 23896 |
| Terms re-assigned to a higher-severity category | 14962 |
| Normalized-form collisions | 5720 |
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
| `corruption` | 贪腐词库 | low | 170 |
| `covid-19` | COVID-19 词库 | low | 70 |
| `general-netease` | 网易前端过滤敏感词库 | low | 7092 |
| `general-tencent` | 零时-Tencent | low | 19879 |
| `illegal-url` | 非法网址 | medium | 14594 |
| `misc` | 其他词库 | low | 149 |
| `politics` | 政治类型 | medium | 296 |
| `politics-dissent` | 反动词库 | medium | 548 |
| `politics-ideology` | 新思想启蒙 | low | 16 |
| `politics-organized` | 政治类型（Organized） | medium | 0 |
| `social-issues` | 民生词库 | low | 286 |
| `supplementary` | 补充词库 | low | 829 |
| `violence-terrorism` | 暴恐词库 | high | 178 |
| `weapons-explosives` | 涉枪涉爆 | high | 434 |
| `微信输入法内置词库26117` | 微信输入法内置词库26.11.7 | low | 13233 |

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
| `Vocabulary/微信输入法/微信输入法内置词库26.11.7.txt` | `微信输入法内置词库26117` | 13362 | 3 | 13243 |
| `Vocabulary/政治类型.txt` | `politics` | 326 | 1 | 243 |
| `Vocabulary/新思想启蒙.txt` | `politics-ideology` | 16 | 1 | 16 |
| `Vocabulary/暴恐词库.txt` | `violence-terrorism` | 178 | 0 | 138 |
| `Vocabulary/民生词库.txt` | `social-issues` | 571 | 0 | 290 |
| `Vocabulary/涉枪涉爆.txt` | `weapons-explosives` | 437 | 1 | 429 |
| `Vocabulary/网易前端过滤敏感词库.txt` | `general-netease` | 7746 | 1 | 7107 |
| `Vocabulary/色情类型.txt` | `adult` | 304 | 1 | 181 |
| `Vocabulary/色情词库.txt` | `adult-extended` | 929 | 0 | 178 |
| `Vocabulary/补充词库.txt` | `supplementary` | 1064 | 1 | 829 |
| `Vocabulary/贪腐词库.txt` | `corruption` | 244 | 0 | 170 |
| `Vocabulary/零时-Tencent.txt` | `general-tencent` | 53308 | 0 | 34473 |
| `Vocabulary/非法网址.txt` | `illegal-url` | 14594 | 2 | 0 |

## Flagged term issues

| Issue | Count |
| --- | --- |
| single-character | 993 |
| digits-only | 879 |
| punctuation-only | 13 |
| contains-whitespace | 1 |

