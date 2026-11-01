# Leaderboard Check

Is the top number a fair comparison? A static web demo. For any saved leaderboard you see two answers side by side. **The leaderboard says** is the best raw number on the board. The **fair comparison** is the best number among result records that share the split, metric name and unit the question needs. Below them, **How this answer was made** replays the same five stages for every leaderboard from saved records, and a machine-readable **comparability determination** backs the answer. A browse page lists all 4,438 leaderboards.

Live site: <https://harishsiravuri.github.io/ml-result-comparability-demo/>

Every displayed record carries a pointer to its source paper. Records that were checked by hand carry a badge. In the expanded sections, every record has a **Report a label error** link that opens a pre-filled issue here.

## Run locally

```bash
cd site && python3 -m http.server 8027
```
Then open <http://127.0.0.1:8027>. The site is plain HTML, CSS and JavaScript, with no build step, no external dependency and no backend.

## Layout

- `site/` is the deployable site. `site/data/` holds the precomputed JSON plus verbatim copies of the frozen release files.
- `build/precompute.py` derives every answer from the frozen inputs and checks it against the banked results.
- `build/make_audit.py` turns the hand-audit sheets into `site/data/audit/`.
- `build/make_verification.py` writes `curated_verification.md`, the manual checklist for the worked examples.
- `build/verify_query_conditioned.py` is a standalone reproducibility check of the banked query results.
- `DATA.md` describes the data provenance, licence and checks. `KNOWN_ISSUES.md` lists issues in the underlying data.

## Data and licence

The code is MIT-licensed (`LICENSE`). The data are CC-BY-SA 4.0 and frozen. Evidence is given as pointers only. See `DATA.md`. The underlying dataset is
[ml-result-comparability](https://github.com/harishsiravuri/ml-result-comparability)
([10.5281/zenodo.21715276](https://doi.org/10.5281/zenodo.21715276)).

Authors: Harish Varma Siravuri and Hamed Alhoori, Northern Illinois University.
