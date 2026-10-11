# Data behind the demo

Everything the site shows is precomputed from frozen files. The data are never recomputed, tuned or updated. The site makes no server, model or API call. It reads the static JSON files listed below.

## Licence and evidence policy

All data in this repository are released under **CC-BY-SA 4.0**. Evidence is given as **pointers only**: an arXiv id, the arXiv abstract URL, and a source location, which is a section label or the position of a table or figure in the parsed full text. No excerpt text from any paper is redistributed. Consult the cited arXiv paper for the text.

`extracted table #N (parser order)` is the 0-based position of a table in the parsed full text. It may differ from the paper's own "Table N" label. Pointers are table-level, not cell-level.

## Sources

The underlying dataset and the comparability-cleaned leaderboards are those of the *ml-result-comparability* release:
<https://github.com/harishsiravuri/ml-result-comparability>, Zenodo DOI [10.5281/zenodo.21715276](https://doi.org/10.5281/zenodo.21715276) (version v1.0.0; concept DOI for all versions [10.5281/zenodo.21715275](https://doi.org/10.5281/zenodo.21715275)). The release is built from the Papers with Code archive frozen on 2025-07-28.

The comparability certificates, the four query templates and the query-conditioned results are published here for the first time. They are copied byte for byte into `site/data/release/`, and `SHA256SUMS` lists their checksums.

| File in `site/data/release/` | Content |
|---|---|
| `comparability_certificates.jsonl` | 9,471 certificates: 3,058 census pairs and 6,413 leaderboard pairs (the top 10 entries of each board with two or more protocol clusters). 0 fail the schema. |
| `comparability_certificate.schema.json` | JSON Schema (draft 2020-12) for a certificate |
| `query_templates.json` | The four query templates (`Q_any`, `Q_official`, `Q_trend`, `Q_threshold`) and the status semantics, schema version 1.0.0 |
| `query_conditioned_by_leaderboard.jsonl` | Status (robust, conditional, insufficient) and winner for each template on the 3,061 boards with a known metric direction and at least two records |
| `query_conditioned_demo.json` | Aggregate counts for the query-conditioned results |
| `certificates_summary.json` | Certificate counts by source, status and typed outcome |

The comparative-QA records shown under "Typed comparative questions" are 215 development records with a typed answer. They are taken from the answer block (type, answer, conditions, record pointers, rationale) of a typed comparative-QA set built deterministically over the same cleaned leaderboards.

## Hand audit

`site/data/audit/hand_audit.json` and `hand_audit.csv` hold 56 rows. Harish Varma Siravuri checked each displayed record against its source paper, in two rounds (2026-10-09 and 2026-10-11). The rows cover 55 distinct records; one record was checked in two examples.

| Verdict | Rows | Meaning |
|---|---|---|
| ok | 40 | value and split label match the source |
| missing | 1 | value and split match, but the paper also reports a better same-method test value that is not a record |
| wrong_split | 11 | the source gives a different split |
| wrong_value | 3 | the value belongs to a different benchmark or table column |
| unsure | 1 | the source is ambiguous about the split |

This is a purposive sample drawn from boards with a winner change or an abstention. It is not a corpus error rate. The site shows a badge on every audited record, and a "Report a label error" link on every record that opens a pre-filled issue in this repository. No frozen record was edited as a result of the audit.

## Derived files the site reads

`build/precompute.py` writes these files. It reads the inputs above and writes only to `site/data/`.

| File | Content |
|---|---|
| `meta.json` | Totals for the stats strip, licence, links, and the sha256 of every input file |
| `templates.json` | `query_templates.json` plus the text of the frozen noise-band rule |
| `index.json` | One row per board (4,438), used for autocomplete |
| `examples.json` | The worked examples. Only examples whose displayed answer records passed a hand check against the source papers are listed, with a caveat where the check found one. |
| `boards/<xx>.json` | 256 shards. Each holds the full payload of its boards: records, protocol clusters, answers per template, and the leaderboard-pair certificates verbatim. |

## How answers are derived, and what is checked

The status and winner of each template come from the banked `query_conditioned_by_leaderboard.jsonl`. The build re-runs the original pilot functions only to recover which records form each comparison set, so the site can show values, facets and pointers. It then asserts that every derived quantity equals the banked one: status, winner, number of sets, per-year count, champion, threshold τ, and number of groups clearing τ. It stops on any difference. All 3,061 boards pass.

The build also asserts the following:
- the totals: 4,438 boards, 34,247 entries, 16,215 ranked entries and 9,471 certificates;
- every leaderboard-pair certificate lines up with its two records on method, value, arXiv id, location and protocol;
- every certificate validates against the schema;
- no displayed certificate is one of the 59 self-inconsistent ones (all 59 are census pairs, which the board view does not display).

A **ranked entry** is one whose split, metric surface and unit are all observed. It sits in a same-protocol cluster and is ranked within it. The other 18,032 entries are comparability-unknown: they are flagged and shown, but never ranked.

The noise-band rule is shown as text. It was applied to the 3,058 census pairs only. Leaderboard-pair certificates carry `beyond_noise = null`, and the site says "not evaluated for this pair".

## Rebuilding

```bash
../paper3.2/.venv/bin/python build/precompute.py
python3 build/make_audit.py
python3 build/make_verification.py
```
The inputs are read from the sibling `paper3.2/` and `paper5.2/` folders of the research workspace. They are not part of this repository.
