"""Turn Harish's two completed hand-audit sheets into site/data/audit/hand_audit.{json,csv}.

Each audited record is tied to its board and record id (rid) on the site, so the interface can
show a "checked by hand" badge. Reads curation/round*_completed_*/verification_sheet.csv and
site/data/boards; writes only site/data/audit/. Stops if any audited record cannot be matched.
"""

import csv
import glob
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"
OUT = DATA / "audit"
ROUNDS = [(1, "2026-10-09", ROOT / "curation/round1_completed_20261009/verification_sheet.csv"),
          (2, "2026-10-11", ROOT / "curation/round2_completed_20261011/verification_sheet.csv")]
_shards = {}


def board(lid):
    sh = hashlib.sha1(lid.encode()).hexdigest()[:2]
    if sh not in _shards:
        _shards[sh] = json.load(open(DATA / "boards" / f"{sh}.json"))
    return _shards[sh][lid]


def board_id(link):
    return unquote(parse_qs(link.split("#", 1)[1])["b"][0])


def main():
    rows, questions = [], []
    for rnd, date, path in ROUNDS:
        for r in csv.DictReader(open(path)):
            lid = board_id(r["demo_link"])
            b = board(lid)
            item = r.get("example") or r.get("item")
            if not r["method"]:          # a completeness question with no record
                questions.append({"round": rnd, "date": date, "item": item, "board": lid,
                                  "dataset": b["dataset"], "metric": b["metric"],
                                  "question": r["task"], "verdict": r["VERDICT"], "notes": r["NOTES"]})
                continue
            aid = r["arxiv_url"].rsplit("/", 1)[-1]
            hits = [x for x in b["records"] if x["method"] == r["method"]
                    and abs(x["value"] - float(r["value"])) < 1e-9 and x.get("arxiv_id") == aid]
            if len(hits) != 1:
                sys.exit(f"cannot match audited record uniquely: round {rnd} item {item} {r['method']} {r['value']} -> {len(hits)}")
            x = hits[0]
            rows.append({
                "round": rnd, "date": date, "item": item, "board": lid, "rid": x["rid"],
                "dataset": b["dataset"], "metric": b["metric"], "method": x["method"], "value": x["value"],
                "arxiv_id": aid, "source_location": x.get("source_location"),
                "stored_split": x["proto"]["split"], "stored_metric_surface": x["proto"]["metric_surface"],
                "stored_unit": x["proto"]["unit"],
                "verdict": r["VERDICT"], "split_per_source": r["CORRECT_SPLIT_IF_WRONG"] or None,
                "notes": r["NOTES"],
            })
    # one record can be audited in more than one example; keep every row, flag duplicates
    seen = {}
    for row in rows:
        seen.setdefault((row["board"], row["rid"]), []).append(row["verdict"])
    conflicts = {k: v for k, v in seen.items() if len(set(v)) > 1}
    if conflicts:
        sys.exit(f"conflicting verdicts for the same record: {conflicts}")

    OUT.mkdir(parents=True, exist_ok=True)
    summary = {
        "description": ("Hand audit of displayed records against the source papers, by Harish Varma Siravuri. "
                        "A purposive sample drawn from winner-change and abstention boards, not a corpus error rate."),
        "n_rows": len(rows), "n_distinct_records": len(seen),
        "verdicts": {v: sum(1 for r in rows if r["verdict"] == v) for v in sorted({r["verdict"] for r in rows})},
        "licence": "CC-BY-SA 4.0",
    }
    json.dump({"summary": summary, "records": rows, "completeness_questions": questions},
              open(OUT / "hand_audit.json", "w"), indent=1, ensure_ascii=False)
    with open(OUT / "hand_audit.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
