"""Stop 1 check: the banked query-conditioned rows are reproducible from the cleaned leaderboards.

Read-only. Imports paper3.2's own pilot code and compares its output to the banked
data/census/query_conditioned_by_leaderboard.jsonl row by row. Writes nothing.
Run with paper3.2's environment:
    ../paper3.2/.venv/bin/python build/verify_query_conditioned.py
"""
import json
import os
import sys
from pathlib import Path

P32 = Path(__file__).resolve().parents[2] / "paper3.2"
sys.dont_write_bytecode = True
sys.path[:0] = [str(P32 / "scripts"), str(P32 / "src")]
os.chdir(P32)
import query_conditioned_pilot as q  # noqa: E402

lbs = [json.loads(l) for l in open("data/cleaned_leaderboards/cleaned_leaderboards.jsonl")]
_, rows = q.score(lbs)
banked = {}
for l in open("data/census/query_conditioned_by_leaderboard.jsonl"):
    r = json.loads(l)
    banked[r["leaderboard_id"]] = r
mism = [r["leaderboard_id"] for r in rows
        if json.dumps(r, sort_keys=True) != json.dumps(banked.get(r["leaderboard_id"]), sort_keys=True)]
print(f"regenerated {len(rows)} rows; banked {len(banked)}; mismatches {len(mism)}")
sys.exit(1 if mism or len(rows) != len(banked) else 0)
