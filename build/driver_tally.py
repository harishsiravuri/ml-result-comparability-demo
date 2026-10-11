"""Read-only tally (Stop 3 point 1): what separates the naive and qualified answers on the
120 winner-change boards, and what separates the official sets on the 57 conditional Q_official
boards. Describes banked results; recomputes nothing. Reads site/data only."""
import glob, json, re
from collections import Counter

B = {}
for f in glob.glob(str(__import__("pathlib").Path(__file__).resolve().parents[1] / "site/data/boards/*.json")):
    B.update(json.load(open(f)))

def canon(s):  # case, punctuation, whitespace and a trailing "(%)" annotation only
    s = re.sub(r"\(\s*%\s*\)", "", s.lower())
    return re.sub(r"[^a-z0-9@]+", "", s)

ABBREV = {"acc": "accuracy", "top1acc": "top1accuracy", "f1score": "f1", "fscore": "f1",
          "fmeasure": "f1", "dsc": "dice", "meaniou": "miou"}
def canon2(s):
    c = canon(s)
    return ABBREV.get(c, c)

def label_kind(a, b):
    if canon(a) == canon(b): return "metric label: case/punctuation/(%) only"
    if canon2(a) == canon2(b): return "metric label: listed abbreviation (acc/accuracy, f1/f-score, dsc/dice, mean iou/miou)"
    return "metric label: other difference"

def facet_diff(p, q):
    ms = p["metric_surface"] != q["metric_surface"]; un = p["unit"] != q["unit"]
    if ms and un: return "metric label and unit"
    if un: return "unit only"
    return label_kind(p["metric_surface"], q["metric_surface"])

flip, cond = Counter(), Counter()
for b in B.values():
    if not b.get("scored"): continue
    A, R = b["answers"], b["records"]
    if A["flip"]:
        n, q = R[A["Q_any"]["winner_rid"]], R[A["Q_official"]["winner_rid"]]
        if n["proto"]["split"] is None or n["proto"]["metric_surface"] is None or n["proto"]["unit"] is None:
            flip["naive leader has an unobserved facet (excluded as comparability-unknown)"] += 1
        elif n["proto"]["split"] != "test":
            flip[f"split: naive leader on '{n['proto']['split']}'"] += 1
        else:
            flip["naive leader on test, separated by " + facet_diff(n["proto"], q["proto"])] += 1
    if A["Q_official"]["status"] == "conditional":
        keys = [s["key"] for s in A["Q_official"]["sets"]]
        kinds = {facet_diff(dict(split="test", **keys[0]), dict(split="test", **k)) for k in keys[1:]}
        cond[" + ".join(sorted(kinds))] += 1

print("WINNER-CHANGE BOARDS (n=%d)" % sum(flip.values()))
for k, v in flip.most_common(): print(f"  {v:4d}  {k}")
print("CONDITIONAL Q_official BOARDS (n=%d): how the official sets differ from the largest set" % sum(cond.values()))
for k, v in cond.most_common(): print(f"  {v:4d}  {k}")
