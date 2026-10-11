"""Precompute every demo answer into static JSON. Read-only over paper3.2 and paper5.2.

No LLM call, no network, no tuning. Statuses and winners come from the banked
paper3.2/data/census/query_conditioned_by_leaderboard.jsonl. The pilot's own functions are
re-run only to recover which records form each comparison set (values, facets, pointers), and
every derived status, winner, threshold and count is asserted equal to the banked row. Any
disagreement stops the build.

Run with paper3.2's environment (the pilot imports pandas):
    ../paper3.2/.venv/bin/python build/precompute.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
P32 = ROOT.parent / "paper3.2"
P52 = ROOT.parent / "paper5.2"
OUT = ROOT / "site" / "data"

sys.dont_write_bytecode = True
sys.path[:0] = [str(P32 / "scripts"), str(P32 / "src")]
_cwd = os.getcwd()
os.chdir(P32)
import query_conditioned_pilot as q  # noqa: E402
from certificates.query_templates import must_agree  # noqa: E402
from noise import model as noise_model  # noqa: E402
os.chdir(_cwd)

F_BOARDS = P32 / "data/cleaned_leaderboards/cleaned_leaderboards.jsonl"
F_QC = P32 / "data/census/query_conditioned_by_leaderboard.jsonl"
F_QC_AGG = P32 / "data/census/query_conditioned_demo.json"
F_TEMPLATES = P32 / "schemas/query_templates.json"
F_CERTS = P32 / "data/release/comparability_certificates.jsonl"
F_CERT_SCHEMA = P32 / "schemas/comparability_certificate.schema.json"
F_CERT_SUMMARY = P32 / "data/census/certificates_summary.json"
F_TYPED_DEV = P52 / "data/benchmark_typed/dev.jsonl"

TOP_K = 10            # paper3.2 scripts/build_certificates.py
N_SHARDS_HEX = 2      # 256 shards
FULL = ("split", "metric_surface", "unit")

REPO_URL = "https://github.com/harishsiravuri/ml-result-comparability"
DEMO_REPO_URL = "https://github.com/harishsiravuri/ml-result-comparability-demo"
DOI_VERSION = "10.5281/zenodo.21715276"
DOI_CONCEPT = "10.5281/zenodo.21715275"

# Worked examples. Only boards whose displayed records passed Harish's hand audit (2026-10-09/11).
# Fields: board, template, title, note, caveat, and optional: banner (overrides the winner-change
# text), chip (False = reachable only as a follow-up view), followup (index of the next view).
CURATED = [
    dict(board="hash:fb3db959fa006931|metric:average-map", template="Q_official",
         title="ActivityNet-1.3 Average mAP",
         note="The best raw number, 34.88 (BSN++), is a validation result. Under the official test protocol the "
              "answer is BSN at 32.84.",
         caveat="Completeness was checked within the cited papers only: the BSN++ paper reports no ActivityNet-1.3 "
                "test average mAP. This is not a claim about the best result anywhere in the literature.",
         followup=1),
    dict(board="hash:fb3db959fa006931|metric:average-map", template="Q_threshold",
         title="ActivityNet-1.3: does the lead survive?", chip=False,
         note="Second view of the same board. BSN's lead over the next test entry (32.26) holds on the test split "
              "but not under validation, where BSN reports 30.03.",
         caveat="Completeness was checked within the cited papers only."),
    dict(board="pwc-dataset:mot17|hash:4dde914d469e1478", template="Q_official", title="MOT17 IDF1",
         banner="Top entry changes: validation score replaced by test score.",
         note="BYTE and ByteTrack are the same tracker. The naive leader is its validation run; the qualified "
              "answer is its MOT17 test-set entry.",
         caveat="The validation and test runs also use different training data, so the 2-point gap is not only "
                "the effect of changing the evaluation set."),
    dict(board="pwc-dataset:gopro|metric:psnr", template="Q_official", title="GoPro PSNR",
         note="The naive leader has no split recorded, so no certificate can cover it.",
         caveat="The qualified record's source is internally inconsistent: its supplement calls the same 1,111 GoPro "
                "pairs a validation set in prose and test samples in a table. The test label is therefore uncertain."),
    dict(board="pwc-dataset:csl-daily|metric:wer", template="Q_trend", title="CSL-Daily WER by preprint year",
         note="In 2023 the test-split and validation-split leaders differ, so the per-year answer is conditional.",
         caveat="Years are the first-submission year of the arXiv preprint that reports each number, not the year a "
                "method or result first appeared. The 2023 values were checked against arXiv 2305.03614v3; later "
                "versions rename the method and change results. In 2025, SLA-Adapter and SLA-LoRA tie at 25.8. "
                "This view groups records by preprint year; it is not a historical performance frontier."),
    dict(board="hash:2b958adf44f0cb1f|metric:bleu", template="Q_official", title="WMT'14 English-French BLEU",
         note="No split was identified in the extracted records, so the official question cannot be answered.",
         caveat="All four entries come from one paper (arXiv 1901.07291). The paper gives no explicit split label "
                "beside these numbers; its evaluation setup is inherited from a cited protocol. The abstention means "
                "no split was identified in the extracted records, not that the split cannot be recovered. The metric "
                "is BLEU in the source even where the record leaves it unrecorded."),
]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def shard_of(lid: str) -> str:
    return hashlib.sha1(lid.encode()).hexdigest()[:N_SHARDS_HEX]


def fail(msg: str):
    sys.exit(f"BUILD STOPPED: {msg}")


def better(a, b, direction):
    return a > b if direction == "higher" else a < b


def argmax_rec(recs, direction):
    """Same tie-break as the pilot's winner(): first record at the extreme value."""
    best = None
    for r in recs:
        if best is None or better(r["value"], best["value"], direction):
            best = r
    return best


# --------------------------------------------------------------------------- records
def board_records(lb):
    """Records in the pilot's entries_of order, with a stable rid."""
    out = []
    for ci, c in enumerate(lb["clusters"]):
        p = c["protocol"]
        for e in c["ranking"]:
            out.append({
                "rid": len(out), "method": e["method"], "value": float(e["value"]),
                "arxiv_id": e["arxiv_id"], "abs_url": e.get("arxiv_abs_url"),
                "source_location": e.get("source_location"),
                "proto": {"split": p["split"], "metric_surface": p["metric_surface"], "unit": p["unit"]},
                "cluster": ci, "year": q.year_of(e["arxiv_id"]),
            })
    for e in lb.get("comparability_unknown_entries", []):
        aid = e.get("paper_id")
        out.append({
            "rid": len(out), "method": e["method"], "value": float(e["value"]),
            "arxiv_id": aid, "abs_url": f"https://arxiv.org/abs/{aid}" if aid else None,
            "source_location": None,
            "proto": {"split": None, "metric_surface": None, "unit": None},
            "cluster": None, "year": q.year_of(aid) if aid else None,
            "unknown_reason": e.get("reason"),
        })
    return out


def pilot_view(recs):
    """The dict shape the pilot functions expect (method, value, arxiv_id, proto) plus rid."""
    return [{"rid": r["rid"], "method": r["method"], "value": r["value"],
             "arxiv_id": r["arxiv_id"], "proto": r["proto"]} for r in recs]


def set_key(r, facets):
    return {f: r["proto"][f] for f in facets}


# --------------------------------------------------------------------------- templates
def answer_any(pv, d, banked):
    w = argmax_rec(pv, d)
    if w["method"] != banked["Q_any"]["winner"]:
        fail(f"Q_any winner mismatch {w['method']} vs {banked['Q_any']['winner']}")
    if banked["Q_any"]["status"] != "robust":
        fail("Q_any not robust")
    return {"status": "robust", "winner_rid": w["rid"], "n_records": len(pv)}


def answer_official(pv, d, banked):
    b = banked["Q_official"]
    facets = must_agree("Q_official")
    off = [r for r in pv if r["proto"].get("split") == "test"]
    sets = q.comparison_sets(off, facets)
    status, wname = q.status_of(sets, d)
    if status != b["status"] or wname != b["winner"] or len(sets) != b["n_sets"] \
            or len(off) != b["n_official_records"]:
        fail(f"Q_official mismatch on {banked['leaderboard_id']}")
    usable = sorted([s for s in sets if len(s) >= 2], key=lambda s: -len(s))
    out_sets = [{"key": set_key(s[0], facets), "rids": [r["rid"] for r in s],
                 "winner_rid": argmax_rec(s, d)["rid"]} for s in usable]
    n_split_missing = sum(1 for r in pv if r["proto"].get("split") is None)
    n_other_split = sum(1 for r in pv if r["proto"].get("split") not in (None, "test"))
    n_isolated = sum(1 for s in sets if len(s) < 2)
    winner_rid = None
    if status == "robust":
        winner_rid = out_sets[0]["winner_rid"]
        if any(s["winner_rid"] != winner_rid for s in out_sets):
            # same method name may appear as different records; the banked rule is by name
            names = {next(r for r in pv if r["rid"] == s["winner_rid"])["method"] for s in out_sets}
            if names != {wname}:
                fail("robust Q_official sets disagree")
    if status == "insufficient":
        reason = (f"No valid comparison set holds two records. {len(off)} record(s) carry an observed "
                  f"test split; {n_split_missing} have no split identified in the extracted record; "
                  f"{n_other_split} are on another split.")
    elif status == "conditional":
        reason = (f"{len(out_sets)} official comparison sets name different winners, so the answer "
                  f"depends on which metric surface and unit you condition on.")
    else:
        reason = None
    return {"status": status, "winner_rid": winner_rid, "sets": out_sets,
            "excluded": {"split_not_reported": n_split_missing, "other_split": n_other_split,
                         "isolated_test_records": n_isolated},
            "n_official_records": len(off), "reason": reason}


def answer_trend(pv, d, banked):
    b = banked["Q_trend"]
    facets = must_agree("Q_trend")
    sets = q.comparison_sets(pv, facets)
    per_year = defaultdict(list)
    for s in sets:
        by_year = defaultdict(list)
        for r in s:
            y = q.year_of(r["arxiv_id"]) if r["arxiv_id"] else None
            if y:
                by_year[y].append(r)
        for y, rs in by_year.items():
            if len(rs) >= 2:
                w = argmax_rec(rs, d)
                per_year[y].append({"key": set_key(rs[0], facets), "rids": [r["rid"] for r in rs],
                                    "winner_rid": w["rid"], "winner": w["method"]})
    if not per_year:
        status = "insufficient"
    elif all(len({x["winner"] for x in v}) == 1 for v in per_year.values()):
        status = "robust"
    else:
        status = "conditional"
    if status != b["status"] or len(per_year) != b["n_years_answerable"]:
        fail(f"Q_trend mismatch on {banked['leaderboard_id']}")
    years = []
    for y in sorted(per_year):
        v = per_year[y]
        years.append({"year": y, "agree": len({x["winner"] for x in v}) == 1,
                      "sets": [{k: x[k] for k in ("key", "rids", "winner_rid")} for x in v]})
    reason = None
    if status == "insufficient":
        reason = "No publication year has two records that share split, metric surface and unit."
    elif status == "conditional":
        n = sum(1 for y in years if not y["agree"])
        reason = f"In {n} year(s) the comparison sets name different winners."
    return {"status": status, "years": years, "reason": reason}


def answer_threshold(pv, d, banked):
    b = banked["Q_threshold"]
    status, champ, detail = q.q_threshold_status(pv, d)
    if status != b["status"] or champ != b.get("champion") \
            or detail.get("threshold_tau") != b.get("threshold_tau") \
            or detail.get("n_test_groups") != b.get("n_test_groups") \
            or detail.get("n_groups_clearing_threshold") != b.get("n_groups_clearing_threshold"):
        fail(f"Q_threshold mismatch on {banked['leaderboard_id']}")
    out = {"status": status, "reason": detail.get("reason"), "tau": detail.get("threshold_tau"),
           "champion_rid": None, "tau_rid": None, "reference_set": None, "groups": []}
    if champ is None:
        return out
    # reconstruct the reference set exactly as q_threshold_status does
    official = defaultdict(list)
    for r in pv:
        if r["proto"].get("split") == "test":
            ms, un = r["proto"].get("metric_surface"), r["proto"].get("unit")
            if ms is not None and un is not None:
                official[(ms, un)].append(r)
    refs = [(sig, g) for sig, g in official.items() if len({x["method"] for x in g}) >= 2]
    sig0, ref = sorted(refs, key=lambda kv: (-len(kv[1]), kv[0]))[0]
    c = argmax_rec(ref, d)
    comps = [r for r in ref if r["method"] != champ]
    t = argmax_rec(comps, d)
    if c["method"] != champ or t["value"] != detail.get("threshold_tau"):
        fail("Q_threshold reconstruction mismatch")
    out.update(champion_rid=c["rid"], tau_rid=t["rid"],
               reference_set={"key": {"split": "test", "metric_surface": sig0[0], "unit": sig0[1]},
                              "rids": [r["rid"] for r in ref]})
    for sig, g in q.full_protocol_groups(pv).items():
        if champ in {x["method"] for x in g} and len({x["method"] for x in g}) >= 2:
            cb = argmax_rec([x for x in g if x["method"] == champ], d)
            out["groups"].append({"key": dict(zip(FULL, sig)), "rids": [r["rid"] for r in g],
                                  "champion_rid": cb["rid"],
                                  "clears": better(cb["value"], t["value"], d)})
    if status in ("robust", "conditional") and \
            sum(g["clears"] for g in out["groups"]) != detail["n_groups_clearing_threshold"]:
        fail("Q_threshold group count mismatch")
    return out


# --------------------------------------------------------------------------- certificates
def attach_certificates(lb, recs, certs_for_board):
    """Map each leaderboard-pair certificate to (rid_left, rid_right) by replaying the
    deterministic enumeration in build_certificates.py, and check every field lines up."""
    if lb["n_comparable_clusters"] < 2:
        if certs_for_board:
            fail(f"certificates on single-cluster board {lb['leaderboard_id']}")
        return {}, set()
    clustered = [r for r in recs if r["cluster"] is not None]
    rev = lb["metric_direction"] == "higher"
    ordered = sorted(clustered, key=lambda r: r["value"], reverse=rev)   # stable, like the script
    top = ordered[:TOP_K]
    pairs = [(a, b) for i, a in enumerate(top) for b in top[i + 1:]]
    if len(pairs) != len(certs_for_board):
        fail(f"certificate count mismatch on {lb['leaderboard_id']}: {len(pairs)} vs {len(certs_for_board)}")
    out = {}
    for (a, b), c in zip(pairs, certs_for_board):
        ok = (c["cell"]["method"] == f"{a['method']} vs {b['method']}"
              and c["left"]["arxiv_id"] == a["arxiv_id"] and c["right"]["arxiv_id"] == b["arxiv_id"]
              and c["left"]["value"] == a["value"] and c["right"]["value"] == b["value"]
              and c["left"]["source_location"] == a["source_location"]
              and c["right"]["source_location"] == b["source_location"]
              and c["left"]["protocol"] == a["proto"] and c["right"]["protocol"] == b["proto"])
        if not ok:
            fail(f"certificate alignment failed on {lb['leaderboard_id']}")
        if not c["self_consistent"]:
            fail(f"self-inconsistent certificate would be displayed: {c['certificate_id']}")
        out[f"{a['rid']}-{b['rid']}"] = c
    return out, {r["rid"] for r in top}


# --------------------------------------------------------------------------- main
def main():
    for f in (F_BOARDS, F_QC, F_QC_AGG, F_TEMPLATES, F_CERTS, F_CERT_SCHEMA, F_CERT_SUMMARY, F_TYPED_DEV):
        if not f.exists():
            fail(f"missing input {f}")

    boards = [json.loads(l) for l in open(F_BOARDS)]
    banked = {}
    for l in open(F_QC):
        r = json.loads(l)
        banked[r["leaderboard_id"]] = r
    lb_certs = defaultdict(list)
    n_certs = 0
    schema_ids = Counter()
    for l in open(F_CERTS):
        c = json.loads(l)
        n_certs += 1
        schema_ids[c["certificate_id"]] += 1
        if c["source"] == "leaderboard_pair":
            lb_certs[c["certificate_id"].split("::")[0]].append(c)
    typed = defaultdict(list)
    for l in open(F_TYPED_DEV):
        r = json.loads(l)
        if r.get("split") != "dev":
            fail("non-dev typed record in dev file")
        typed[r["leaderboard_id"]].append({
            "qid": r["qid"], "kind": r["kind"], "question": r["question"],
            "method_a": r.get("method_a"), "method_b": r.get("method_b"),
            "answer_type": r["gold"]["answer_type"], "answer": r["gold"]["answer"],
            "conditions": r["gold"]["conditions"], "provenance": r["gold"]["provenance"],
            "rationale": r["gold"]["rationale"], "abstention_warranted": r["abstention_warranted"],
        })

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "boards").mkdir(exist_ok=True)
    for old in (OUT / "boards").glob("*.json"):
        old.unlink()

    index, shards = [], defaultdict(dict)
    n_entries = n_ranked = n_unknown = 0
    n_flip = n_flip_cert = 0
    status_counts = defaultdict(Counter)
    certs_attached = 0
    by_name = {}
    for lb in boards:
        lid, d = lb["leaderboard_id"], lb["metric_direction"]
        recs = board_records(lb)
        n_entries += lb["n_entries"]
        n_ranked += sum(1 for r in recs if r["cluster"] is not None)
        n_unknown += sum(1 for r in recs if r["cluster"] is None)
        if len(recs) != lb["n_entries"]:
            fail(f"entry count mismatch on {lid}")
        cert_map, top_rids = attach_certificates(lb, recs, lb_certs.get(lid, []))
        certs_attached += len(cert_map)

        principal = 0 if lb["clusters"] else None
        payload = {
            "id": lid, "dataset": lb["dataset"], "metric": lb["metric"], "direction": d,
            "grade": lb["identity_grade"], "n_entries": lb["n_entries"],
            "records": [{k: v for k, v in r.items() if v is not None or k in ("proto", "cluster")} for r in recs],
            "clusters": [{"cluster": i, "protocol": c["protocol"],
                          "rids": [r["rid"] for r in recs if r["cluster"] == i]}
                         for i, c in enumerate(lb["clusters"])],
            "principal_cluster": principal,
            "unknown_rids": [r["rid"] for r in recs if r["cluster"] is None],
            "certificates": cert_map,
            "certificate_scope_rids": sorted(top_rids),
            "multi_cluster": lb["n_comparable_clusters"] >= 2,
            "typed_questions": typed.get(lid, []),
        }
        row = {"id": lid, "dataset": lb["dataset"], "metric": lb["metric"], "direction": d,
               "grade": lb["identity_grade"], "n": lb["n_entries"],
               "nc": lb["n_comparable_clusters"], "shard": shard_of(lid)}
        b = banked.get(lid)
        if b is not None:
            pv = pilot_view(recs)
            answers = {
                "Q_any": answer_any(pv, d, b),
                "Q_official": answer_official(pv, d, b),
                "Q_trend": answer_trend(pv, d, b),
                "Q_threshold": answer_threshold(pv, d, b),
            }
            answers["flip"] = b["winner_flips_any_vs_official"]
            payload["answers"] = answers
            payload["scored"] = True
            row["scored"] = True
            row["st"] = {t: answers[t]["status"][0] for t in ("Q_official", "Q_trend", "Q_threshold")}
            row["flip"] = answers["flip"]
            for t in ("Q_any", "Q_official", "Q_trend", "Q_threshold"):
                status_counts[t][answers[t]["status"]] += 1
            if answers["flip"]:
                n_flip += 1
                a, o = answers["Q_any"]["winner_rid"], answers["Q_official"]["winner_rid"]
                if f"{min(a, o)}-{max(a, o)}" in cert_map or f"{a}-{o}" in cert_map or f"{o}-{a}" in cert_map:
                    n_flip_cert += 1
        else:
            reason = ("unknown metric direction" if d not in ("higher", "lower")
                      else "fewer than two records")
            payload["scored"] = False
            payload["unscored_reason"] = reason
            row["scored"] = False
            row["why"] = reason
        shards[row["shard"]][lid] = payload
        index.append(row)
        by_name.setdefault((lb["dataset"], lb["metric"]), []).append(lid)
        by_name[lid] = [lid]

    # ----- invariants against banked aggregates
    agg = json.load(open(F_QC_AGG))
    if len(index) != 4438 or n_entries != 34247 or n_ranked != 16215 or n_certs != 9471:
        fail(f"count mismatch: boards {len(index)} entries {n_entries} ranked {n_ranked} certs {n_certs}")
    if sum(1 for r in index if r.get("scored")) != 3061 or len(banked) != 3061:
        fail("scored board count mismatch")
    if certs_attached != sum(len(v) for v in lb_certs.values()) or certs_attached != 6413:
        fail(f"not every leaderboard-pair certificate attached ({certs_attached})")

    # schema validation (expects 0 failures, as banked)
    import jsonschema
    validator = jsonschema.Draft202012Validator(json.load(open(F_CERT_SCHEMA)))
    n_invalid = sum(0 if validator.is_valid(json.loads(l)) else 1 for l in open(F_CERTS))
    dup_ids = {k: v for k, v in schema_ids.items() if v > 1}

    # ----- curated examples
    examples = []
    for i, ex in enumerate(CURATED, 1):
        key, tmpl = ex["board"], ex["template"]
        hits = by_name.get(key) or by_name.get(tuple(key.split("|", 1)), [])
        if len(hits) != 1:
            fail(f"curated board not found or ambiguous: {key} -> {hits}")
        lid = hits[0]
        bp = shards[shard_of(lid)][lid]
        if not bp.get("scored"):
            fail(f"curated board not scored: {key}")
        examples.append({"n": i, "board": lid, "template": tmpl, "title": ex["title"], "note": ex["note"],
                         "caveat": ex.get("caveat", ""), "banner": ex.get("banner"),
                         "chip": ex.get("chip", True),
                         "followup": (ex["followup"] + 1) if "followup" in ex else None,
                         "status": bp["answers"][tmpl]["status"], "flip": bp["answers"]["flip"]})

    for content in shards.values():
        for bp in content.values():
            bp["shared_certificate_ids"] = {
                c["certificate_id"]: schema_ids[c["certificate_id"]]
                for c in bp["certificates"].values() if schema_ids[c["certificate_id"]] > 1}
    for sh, content in shards.items():
        with open(OUT / "boards" / f"{sh}.json", "w") as f:
            json.dump(content, f, separators=(",", ":"), ensure_ascii=False)
    with open(OUT / "index.json", "w") as f:
        json.dump(index, f, separators=(",", ":"), ensure_ascii=False)
    with open(OUT / "examples.json", "w") as f:
        json.dump(examples, f, indent=1, ensure_ascii=False)

    templates = json.load(open(F_TEMPLATES))
    templates["noise_rule"] = {
        "text": ("Beyond noise if and only if |v1 - v2| > k * sqrt(sigma1^2 + sigma2^2), with k = "
                 f"{noise_model.K:g}. Each sigma is the reported dispersion when present, otherwise a "
                 f"calibrated default: {noise_model.SIGMA_DEFAULT_BOUNDED_PTS:g} points on a 0-100 scale "
                 f"for bounded metrics, {noise_model.SIGMA_DEFAULT_REL:g} x |v| for unbounded metrics; "
                 "metrics of unknown range must pass both views."),
        "source": "paper3.2 src/noise/model.py (preregistered, AMENDMENT A, 2026-06-18)",
        "applied_to": "the 3,058 census-pair certificates only; leaderboard-pair certificates carry beyond_noise = null",
    }
    with open(OUT / "templates.json", "w") as f:
        json.dump(templates, f, indent=1, ensure_ascii=False)

    cert_summary = json.load(open(F_CERT_SUMMARY))
    meta = {
        "title": "Protocol-qualified leaderboard explorer",
        "stats": {
            "boards": len(index), "entries": n_entries, "ranked_entries": n_ranked,
            "comparability_unknown_entries": n_unknown, "certificates": n_certs,
            "certificates_census_pair": cert_summary["by_source"]["census_pair"],
            "certificates_leaderboard_pair": cert_summary["by_source"]["leaderboard_pair"],
            "schema_failures": n_invalid, "query_conditioned_boards": len(banked),
            "winner_changes": n_flip, "winner_changes_with_certificate": n_flip_cert,
            "status_counts": {t: dict(c) for t, c in status_counts.items()},
            "duplicate_certificate_ids": len(dup_ids),
            "certificates_sharing_an_id": sum(dup_ids.values()),
        },
        "ranked_definition": ("an entry whose split, metric surface and unit are all observed, so it "
                              "sits in a same-protocol cluster and is ranked within it"),
        "certificate_scope": cert_summary["scope_note"],
        "license": "CC-BY-SA 4.0",
        "evidence_policy": "pointers only (arXiv id, abs URL, source location); no excerpt text",
        "repo_url": REPO_URL, "demo_repo_url": DEMO_REPO_URL, "doi_version": DOI_VERSION, "doi_concept": DOI_CONCEPT,
        "snapshot": "Papers with Code archive frozen 2025-07-28",
        "inputs": {str(p.relative_to(ROOT.parent)): sha256(p) for p in
                   (F_BOARDS, F_QC, F_QC_AGG, F_TEMPLATES, F_CERTS, F_CERT_SCHEMA, F_CERT_SUMMARY, F_TYPED_DEV)},
    }
    with open(OUT / "meta.json", "w") as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)

    # verbatim copies of the frozen release files, byte-identical (sha256 checked)
    import shutil
    rel = OUT / "release"
    rel.mkdir(exist_ok=True)
    for src in (F_CERTS, F_CERT_SCHEMA, F_TEMPLATES, F_QC, F_QC_AGG, F_CERT_SUMMARY):
        dst = rel / src.name
        shutil.copyfile(src, dst)
        if sha256(dst) != sha256(src):
            fail(f"copy of {src.name} is not byte-identical")
    with open(rel / "SHA256SUMS", "w") as f:
        for src in (F_CERTS, F_CERT_SCHEMA, F_TEMPLATES, F_QC, F_QC_AGG, F_CERT_SUMMARY):
            f.write(f"{sha256(src)}  {src.name}\n")

    if n_invalid != 0:
        fail(f"{n_invalid} certificates fail the schema")
    print(json.dumps(meta["stats"], indent=1))
    print("examples:")
    for e in examples:
        print(f"  {e['n']:>2} {e['template']:<12} {e['status']:<12} flip={e['flip']!s:<5} {e['title']}")


if __name__ == "__main__":
    main()
