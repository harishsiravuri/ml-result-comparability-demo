/* Leaderboard Check — the ruler, printed with a dagger.
   Static, no backend: every answer is precomputed by build/precompute.py from frozen data and only read here.
   Drawing system: one vertical rule per leaderboard; each record one mark at its true value;
   test split hangs right, any other split left, unknown hollow and centred; better is up. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ constants
  const TEMPLATES = ["Q_official", "Q_trend", "Q_threshold"];
  const ASK_LABEL = { Q_official: "Best on test split", Q_trend: "Best per year", Q_threshold: "Does the lead hold?" };
  const QUESTION_TEXT = {
    Q_any: "Which method reports the top value, whatever the setup?",
    Q_official: "Which method has the best value on the official test split?",
    Q_trend: "How does the best value change by year of the reporting paper?",
    Q_threshold: "Does the best test record stay ahead of its nearest competitor in every setup where both appear?",
  };
  const FACET_PLAIN = { split: "split", metric_surface: "metric name", unit: "unit" };
  const SPLIT_WORD = { val: "validation split", test: "test split", train: "training split" };
  const SPLIT_SHORT = { val: "validation", test: "test", train: "training" };
  const plainTerms = (s) =>
    String(s == null ? "" : s)
      .replace(/ \(default per the honesty rule\)/g, "")
      .replace(/metric[_ -]surface/g, "metric name")
      .replace(/\bsurface=/g, "metric=")
      .replace(/protocol cluster\(s\)/g, "valid comparison set(s)")
      .replace(/unknown protocol/g, "unknown setup")
      .replace(/official comparison sets/g, "valid comparison sets")
      .replace(/\bprotocol\b/g, "evaluation setup")
      .replace(/\bfacet/g, "field");
  const TASK_GLOSS = {
    "hash:fb3db959fa006931|metric:average-map":
      "A benchmark for finding actions in videos. Average mAP is an accuracy score.",
    "pwc-dataset:mot17|hash:4dde914d469e1478": "A benchmark for tracking people across video frames.",
    "pwc-dataset:gopro|metric:psnr": "A benchmark for removing motion blur from images.",
    "pwc-dataset:csl-daily|metric:wer": "A benchmark for recognising Chinese Sign Language in videos.",
    "hash:2b958adf44f0cb1f|metric:bleu": "A benchmark for translating English into French.",
  };
  const EX_REASON = {
    1: "validation beat test",
    2: "lead holds on test only",
    3: "same tracker, two runs",
    4: "top has no split",
    5: "depends on the year",
    6: "no record states its split",
  };
  const EX_SHORT = { "hash:2b958adf44f0cb1f|metric:bleu": "WMT'14 En–Fr" };

  const S = {
    meta: null,
    templates: null,
    index: [],
    examples: [],
    shards: {},
    board: null,
    tmpl: "Q_official",
    picks: [],
    slot: 0,
    stage: -1,
    open: {},
    present: false,
    beat: 3,
    reduced: false,
  };

  // ------------------------------------------------------------------ helpers
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const fmtN = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : esc(n));
  const val = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(6)));
  const dec = (v) => {
    const s = val(v);
    return s.indexOf(".") < 0 ? 0 : s.length - s.indexOf(".") - 1;
  };
  const nRec = (k) => k + (k === 1 ? " record" : " records"); // "1 record", "13 records"
  const getJSON = (u) =>
    fetch(u).then((r) => {
      if (!r.ok) throw new Error(u + " " + r.status);
      return r.json();
    });
  // board shards: one in-flight request per shard; a failed request is forgotten so it can be retried
  function getShard(sh) {
    if (S.shards[sh]) return Promise.resolve(S.shards[sh]);
    S.shardP = S.shardP || {};
    if (!S.shardP[sh])
      S.shardP[sh] = getJSON("data/boards/" + sh + ".json")
        .then((j) => (S.shards[sh] = j))
        .finally(() => {
          delete S.shardP[sh];
        });
    return S.shardP[sh];
  }
  async function shardOf(id) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(id));
      return Array.from(new Uint8Array(buf))
        .slice(0, 1)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    const row = S.byId && S.byId.get(id);
    return row ? row.shard : null;
  }
  function pointer(l) {
    if (!l) return "location not recorded";
    const [k, ...r] = l.split(":");
    const v = r.join(":");
    return k === "table"
      ? "parsed table " + v
      : k === "figure"
        ? "Figure " + v
        : k === "section"
          ? "§ " + v
          : k === "abstract"
            ? "abstract"
            : l;
  }
  function paperLink(r) {
    if (!r.arxiv_id) return "<span class='muted'>no arXiv id</span>";
    const url = r.abs_url || "https://arxiv.org/abs/" + r.arxiv_id;
    return "<a href='" + esc(url) + "' target='_blank' rel='noopener'>arXiv:" + esc(r.arxiv_id) + "</a>";
  }
  const rec = (rid) => S.board.records[rid];
  const isBetter = (a, b, d) => (d === "higher" ? a > b : a < b);
  const ranked = (rids) =>
    rids
      .map(rec)
      .slice()
      .sort((a, b) => (a.value === b.value ? a.rid - b.rid : isBetter(a.value, b.value, S.board.direction) ? -1 : 1));
  const splitWord = (p) => (!p || p.split == null ? "split not recorded" : SPLIT_WORD[p.split] || p.split + " split");
  const sideOf = (r) => (!r.proto || r.proto.split == null ? 0 : r.proto.split === "test" ? 1 : -1);
  const hueOf = (r) => {
    const s = sideOf(r);
    return s === 0 ? "var(--ink)" : s > 0 ? "var(--test)" : "var(--other)";
  };
  const textHue = (r) => {
    const s = sideOf(r);
    return s === 0 ? "var(--ink)" : s > 0 ? "var(--test-text)" : "var(--other-text)";
  };
  const setupLine = (p) =>
    [
      p && p.split != null ? SPLIT_SHORT[p.split] || p.split : null,
      p && p.metric_surface ? "“" + metricName(p.metric_surface) + "”" : null,
      p && p.unit,
    ]
      .filter(Boolean)
      .map(esc)
      .join(" · ");
  const dirWord = () => (S.board.direction === "lower" ? "lower is better" : "higher is better");
  const tiedWith = (rids, w) => {
    const v = rec(w).value;
    return rids.filter((i) => i !== w && rec(i).value === v).map((i) => rec(i).method);
  };
  const auditOf = (r) => (S.audit ? S.audit.get(S.board.id + "#" + r.rid) : null);
  const VERDICT = {
    ok: ["ok", "✓ checked by hand"],
    missing: [
      "unsure",
      "! hand check: incomplete. The paper reports a better same-method test value that is not in the data, which disputes this answer",
    ],
    wrong_split: ["bad", "✗ hand check: the source gives a different split"],
    wrong_value: ["bad", "✗ hand check: this value belongs to a different benchmark or column"],
    unsure: ["unsure", "? hand check: the source is ambiguous about the split"],
  };
  function auditBadge(r) {
    const a = auditOf(r);
    if (!a) return "";
    const [c, t] = VERDICT[a.verdict] || ["unsure", "hand-checked"];
    return (
      "<span class='audit-" +
      c +
      "' title='" +
      esc((a.notes || "") + " [checked " + a.date + "]") +
      "'>" +
      esc(t + (a.verdict === "wrong_split" && a.split_per_source ? " (source: " + a.split_per_source + ")" : "")) +
      "</span>"
    );
  }
  function reportURL(r) {
    const p = r.proto || {};
    const view =
      location.origin + location.pathname + "#q=" + encodeURIComponent(S.tmpl) + "&b=" + encodeURIComponent(S.board.id);
    const title = "Label error: " + S.board.dataset + " / " + S.board.metric + ": " + r.method + " " + val(r.value);
    const body = [
      "**Board:** `" + S.board.id + "` (" + S.board.dataset + " / " + S.board.metric + ")",
      "**Record:** " + r.method + ", value " + val(r.value) + " (record id " + r.rid + ")",
      "**Paper:** https://arxiv.org/abs/" + (r.arxiv_id || "?"),
      "**Pointer:** `" + (r.source_location || "none recorded") + "`",
      "**Stored evaluation setup:** split = " +
        (p.split == null ? "not recorded" : p.split) +
        "; metric name = " +
        (p.metric_surface == null ? "not recorded" : p.metric_surface) +
        "; unit = " +
        (p.unit == null ? "not recorded" : p.unit),
      "**Demo view:** " + view,
      "",
      "**What the source says** (split, value, table/section and page):",
      "",
    ].join("\n");
    return (
      S.meta.demo_repo_url +
      "/issues/new?labels=label-error&title=" +
      encodeURIComponent(title) +
      "&body=" +
      encodeURIComponent(body)
    );
  }
  const reportLink = (r, label) =>
    "<a class='m err' href='" +
    esc(reportURL(r)) +
    "' target='_blank' rel='noopener' title='Submit an erratum for this record (opens a pre-filled GitHub issue)'>" +
    esc(label || "erratum ↗") +
    "</a>";

  function wrapWords(s, width, maxLines) {
    const words = s.split(" "),
      lines = [""];
    words.forEach((w) => {
      const cur = lines[lines.length - 1];
      if (!cur.length) lines[lines.length - 1] = w;
      else if ((cur + " " + w).length <= width) lines[lines.length - 1] = cur + " " + w;
      else lines.push(w);
    });
    if (lines.length > maxLines) {
      const keep = lines.slice(0, maxLines);
      keep[maxLines - 1] = keep[maxLines - 1].replace(/\s*\S*$/, "") + "…";
      if (keep[maxLines - 1] === "…") keep[maxLines - 1] = lines[maxLines - 1].slice(0, width - 1) + "…";
      return keep;
    }
    return lines.map((l) => (l.length > width ? l.slice(0, width - 1) + "…" : l));
  }
  function niceTicks(lo, hi, n) {
    const span = hi - lo;
    if (!(span > 0)) return [];
    const step0 = span / n,
      mag = Math.pow(10, Math.floor(Math.log10(step0))),
      err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  const fmtTick = (v) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : String(+v.toFixed(2)));
  const METRIC_NAME = {
    bleu: "BLEU",
    wer: "WER",
    map: "mAP",
    miou: "mIoU",
    psnr: "PSNR",
    ssim: "SSIM",
    f1: "F1",
    auc: "AUC",
    idf1: "IDF1",
    mota: "MOTA",
    hota: "HOTA",
    rouge: "ROUGE",
    "rouge-l": "ROUGE-L",
    "rouge-1": "ROUGE-1",
    "rouge-2": "ROUGE-2",
    em: "EM",
    cer: "CER",
    fid: "FID",
    mae: "MAE",
    mse: "MSE",
    rmse: "RMSE",
    ndcg: "NDCG",
    mrr: "MRR",
    "average map": "average mAP",
    "top-1 accuracy": "top-1 accuracy",
  };
  const metricName = (s) => {
    const k = String(s || "")
      .trim()
      .toLowerCase();
    return METRIC_NAME[k] || s;
  };
  const cleanM = (m) =>
    String(m || "")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/\s*∗?\s*\((?:[^()]*et al\.?,?\s*\d{4}[a-z]?)\)/g, "")
      .replace(/\s+[A-Z][a-z]+ et al\.?\s*\(\d{4}[a-z]?\)/g, "")
      .replace(/\s*\((?:ours|our)[^()]*\)/gi, "")
      .replace(/(\s+[∗*R\u{1D445}]+){1,}\s*\*?$/gu, "")
      .replace(/\s*[∗*]+\s*$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  const SELF_NAMED = /^(ours\b|our\b|our$|proposed|the proposed|this work|fine-?tuning$|baseline$|method$|model$)/i;
  const methodName = (r) => {
    const m = cleanM(r.method);
    return (SELF_NAMED.test(m) || /^upper bound|^lower bound/i.test(m)) && r.arxiv_id
      ? "method of arXiv:" + r.arxiv_id
      : m;
  };
  // ------------------------------------------------------------------ svg primitives
  const NS = "http://www.w3.org/2000/svg";
  function el(t, a, p) {
    const e = document.createElementNS(NS, t);
    for (const k in a) e.setAttribute(k, a[k]);
    if (p) p.appendChild(e);
    return e;
  }
  function tx(p, x, y, s, a) {
    const t = el("text", { x, y }, p);
    for (const k in a || {}) t.setAttribute(k, a[k]);
    t.textContent = s;
    return t;
  }
  function scale(vals, y0, y1, dir) {
    let lo = Math.min(...vals),
      hi = Math.max(...vals);
    const span = hi - lo || Math.abs(hi) * 0.1 || 1;
    lo -= span * 0.06;
    hi += span * 0.06;
    return {
      lo,
      hi,
      y: (v) => {
        const t = (v - lo) / (hi - lo);
        return dir === "higher" ? y1 - t * (y1 - y0) : y0 + t * (y1 - y0);
      },
    };
  }
  function density(n) {
    return n <= 40
      ? { r: 6, cols: 6, tick: false }
      : n <= 120
        ? { r: 3.5, cols: 8, tick: false }
        : { r: 2.2, cols: 10, tick: true };
  }
  /* lay out marks on a rule: greedy beeswarm per side, capped columns; returns positions */
  function layout(list, x, sc, r, cols, gap, force) {
    const placed = [],
      out = [],
      d2 = (2 * r + 1.5) * (2 * r + 1.5);
    const off = Math.max(r + gap, 2 * r + 3);
    list
      .slice()
      .sort((a, b) => a.value - b.value || a.rid - b.rid)
      .forEach((q) => {
        const s = force != null ? force : sideOf(q),
          y = sc.y(q.value);
        if (s === 0 && force == null) {
          out.push({ r: q, x, y, s });
          return;
        }
        const cand = (k) =>
          s === 0 ? x + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (2 * r + 2) : x + s * off + s * k * (2 * r + 2);
        let k = 0,
          cx = cand(0);
        while (k < cols * 2 && placed.some((p) => (p.x - cx) * (p.x - cx) + (p.y - y) * (p.y - y) < d2)) {
          k++;
          cx = cand(k);
        }
        placed.push({ x: cx, y });
        out.push({ r: q, x: cx, y, s });
      });
    return out;
  }
  function drawMark(g, p, r, opts) {
    opts = opts || {};
    let e;
    if (opts.tick && !opts.circle) {
      e = el(
        "line",
        {
          x1: p.x - 6,
          x2: p.x + 6,
          y1: p.y,
          y2: p.y,
          stroke: hueOf(p.r),
          "stroke-width": 1.5,
          opacity: 0.55,
          class: "mk tick",
        },
        g,
      );
    } else {
      e = el("circle", { cx: p.x, cy: p.y, r: r, class: "mk" }, g);
      if (p.s === 0) {
        e.setAttribute("fill", "var(--page)");
        e.setAttribute("stroke", "var(--ink)");
        e.setAttribute("stroke-width", 1.5);
      } else e.setAttribute("fill", hueOf(p.r));
    }
    e.setAttribute("data-rid", p.r.rid);
    if (opts.faint) e.setAttribute("opacity", 0.35);
    if (opts.held) e.classList.add("held");
    if (opts.cls) e.classList.add(opts.cls);
    if (opts.win) {
      e.setAttribute("stroke", "var(--ink)");
      e.setAttribute("stroke-width", 2);
      e.classList.add("win");
    }
    return e;
  }
  function rule(g, x, y0, y1, dash) {
    return el("line", { x1: x, x2: x, y1: y0, y2: y1, class: "rule-line", "stroke-dasharray": dash || "none" }, g);
  }
  /* S.quick: a redraw of the same records (another question on the same leaderboard). Marks stay where they are,
     only the words cross-fade, so the chart never blanks and replays its intro. */
  const QUICK_SKIP = new Set(["hang", "draw", "evict", "stamp"]);
  const anim = (e, cls, delay) => {
    if (S.reduced) return e;
    if (S.quick) {
      if (!QUICK_SKIP.has(cls)) e.classList.add("qfade");
      return e;
    }
    e.classList.add(cls);
    if (delay) e.style.animationDelay = delay + "ms";
    return e;
  };

  // ------------------------------------------------------------------ hero
  function heroModel() {
    const b = S.board,
      A = b.answers,
      t = S.tmpl,
      m = { mode: t };
    if (!b.scored) {
      m.mode = "unscored";
      return m;
    }
    m.top = rec(A.Q_any.winner_rid);
    const kept = new Set();
    if (t === "Q_official") A.Q_official.sets.forEach((s) => s.rids.forEach((i) => kept.add(i)));
    if (t === "Q_trend") A.Q_trend.years.forEach((y) => y.sets.forEach((s) => s.rids.forEach((i) => kept.add(i))));
    if (t === "Q_threshold") A.Q_threshold.groups.forEach((g) => g.rids.forEach((i) => kept.add(i)));
    m.kept = kept;
    if (t === "Q_official") {
      const o = A.Q_official;
      m.status = o.status;
      if (o.status === "robust") m.fair = rec(o.winner_rid);
      if (o.status === "conditional")
        m.sets = o.sets.map((s) => ({ w: rec(s.winner_rid), n: s.rids.length, key: s.key }));
    }
    if (t === "Q_threshold") {
      const q = A.Q_threshold;
      m.status = q.status;
      if (q.champion_rid != null) {
        m.fair = rec(q.champion_rid);
        m.tau = q.tau;
        m.groups = q.groups;
      }
    }
    if (t === "Q_trend") {
      const tr = A.Q_trend;
      m.status = tr.status;
      m.years = tr.years;
    }
    return m;
  }

  /* ---- hand-made strokes: deterministic jitter seeded by the text they mark, so no two are alike ---- */
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return ((h >>> 0) % 10000) / 10000;
    };
  }
  function marker(g, x, y, w, h, fill, seedStr) {
    const rnd = seeded(seedStr || String(x + w));
    const j = (a) => (rnd() - 0.5) * a;
    const tilt = j(3),
      x0 = x - 3 + j(4),
      x1 = x + w + 2 + j(6),
      yt = y + j(2),
      yb = y + h + j(2);
    const d =
      "M" +
      x0.toFixed(1) +
      " " +
      (yt + tilt).toFixed(1) +
      " C " +
      (x0 + w * 0.3).toFixed(1) +
      " " +
      (yt + j(2.4)).toFixed(1) +
      ", " +
      (x0 + w * 0.7).toFixed(1) +
      " " +
      (yt + j(2.4) - tilt * 0.5).toFixed(1) +
      ", " +
      x1.toFixed(1) +
      " " +
      (yt - tilt).toFixed(1) +
      " L " +
      (x1 + 2 + j(3)).toFixed(1) +
      " " +
      ((yt + yb) / 2 + j(2)).toFixed(1) +
      " L " +
      (x1 + j(3)).toFixed(1) +
      " " +
      (yb - tilt).toFixed(1) +
      " C " +
      (x0 + w * 0.65).toFixed(1) +
      " " +
      (yb + j(2.4)).toFixed(1) +
      ", " +
      (x0 + w * 0.35).toFixed(1) +
      " " +
      (yb + j(2.4)).toFixed(1) +
      ", " +
      (x0 + j(2)).toFixed(1) +
      " " +
      (yb + tilt).toFixed(1) +
      " L " +
      (x0 - 2 + j(3)).toFixed(1) +
      " " +
      ((yt + yb) / 2 + j(2)).toFixed(1) +
      " Z";
    const p = el("path", { d, fill, class: "marker" });
    g.insertBefore(p, g.firstChild);
    return p;
  }
  function pencil(g, x1, y1, x2, y2, seedStr, arrow) {
    const rnd = seeded(seedStr),
      j = (a) => (rnd() - 0.5) * a;
    const mx = (x1 + x2) / 2 + j(3),
      my = (y1 + y2) / 2 + j(3);
    const p = el(
      "path",
      {
        d:
          "M" +
          (x1 + j(1.5)).toFixed(1) +
          " " +
          (y1 + j(1.5)).toFixed(1) +
          " Q " +
          mx.toFixed(1) +
          " " +
          (my + j(4)).toFixed(1) +
          " " +
          x2.toFixed(1) +
          " " +
          y2.toFixed(1),
        fill: "none",
        stroke: "var(--red)",
        "stroke-width": 1.8 + j(0.5),
        "stroke-linecap": "round",
      },
      g,
    );
    if (arrow) {
      const ang = Math.atan2(y2 - my, x2 - mx),
        a1 = ang + 2.6 + j(0.3),
        a2 = ang - 2.6 + j(0.3),
        L = 6 + j(2);
      el(
        "path",
        {
          d:
            "M" +
            (x2 + Math.cos(a1) * L).toFixed(1) +
            " " +
            (y2 + Math.sin(a1) * L).toFixed(1) +
            " L " +
            x2.toFixed(1) +
            " " +
            y2.toFixed(1) +
            " L " +
            (x2 + Math.cos(a2) * L).toFixed(1) +
            " " +
            (y2 + Math.sin(a2) * L).toFixed(1),
          fill: "none",
          stroke: "var(--red)",
          "stroke-width": 1.8,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
        g,
      );
    }
    return p;
  }
  const textW = (t) => {
    try {
      return t.getComputedTextLength();
    } catch (e) {
      return (t.textContent || "").length * 8;
    }
  };
  const shortMethod = (r, n, bare) => {
    const s = (bare ? r.method : methodName(r))
      .replace(/\s*∗?\s*\((?:[^()]*et al\.?,?\s*\d{4}[a-z]?)\)/g, "")
      .replace(/\s*∗\s*$/, "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };

  function renderHero() {
    S.heroAt = performance.now();
    const host = $("hero");
    host.innerHTML = "";
    const b = S.board,
      m = heroModel(),
      P = S.present,
      phone = !P && window.matchMedia("(max-width: 760px)").matches;
    const W = P ? 1800 : phone ? 358 : 1248;
    // on a projector the slide's own proportions set the height, so steps 1–3 fill the screen without dead space
    const H = P
      ? Math.round(
          Math.max(560, Math.min(900, (1800 * (window.innerHeight - 300)) / Math.max(600, window.innerWidth - 128))),
        )
      : phone
        ? 268
        : 520;
    const svg = el(
      "svg",
      {
        viewBox: "0 0 " + W + " " + H,
        role: "img",
        "aria-label":
          "Every result record on one rule; the leaderboard's top value and the fair comparison at their true heights",
      },
      host,
    );
    const g = el("g", {}, svg);
    if (m.mode === "unscored") {
      const x = W / 2,
        y0 = 60,
        y1 = H - 50;
      rule(g, x, y0, y1, "2 5");
      const top = ranked(b.records.map((q) => q.rid))[0];
      tx(g, x - 40, (y0 + y1) / 2 + 30, val(top.value), {
        "font-size": phone ? 48 : 120,
        "text-anchor": "end",
        class: "num",
      });
      tx(g, x + 40, (y0 + y1) / 2 - 6, "No ranking", { "font-size": phone ? 20 : 34, class: "it" });
      tx(g, x + 40, (y0 + y1) / 2 + 22, "the data do not record whether higher or lower is better here.", {
        "font-size": phone ? 11 : 18,
      });
      $("heroCap").innerHTML =
        "<b>Fig. 1.</b> " + b.records.length + " result records, unranked: metric direction unknown.";
      return;
    }
    if (phone) {
      phoneHero(svg, g, m, W, H);
      return;
    }
    const num = P ? 196 : 128,
      small = P ? 20 : 15,
      it = P ? 30 : 22,
      fn = P ? 27 : 19,
      relF = P ? 34 : 24;
    const n = b.records.length,
      nU = b.records.filter((q) => sideOf(q) === 0).length,
      dn = density(n),
      r = Math.round((P ? dn.r * 1.6 : dn.r * 1.35) * 10) / 10,
      R2 = r + 2;
    const x = W / 2,
      y0 = Math.round(num * 0.55) + 30,
      y1 = H - (P ? 56 : 74);
    const top = m.top,
      kept = m.kept;
    let vals =
      m.status === "insufficient" || !kept.size
        ? b.records.map((q) => q.value)
        : [...kept].map((i) => rec(i).value).concat([top.value]);
    if (m.tau != null) vals.push(m.tau);
    const sc0 = scale(vals, y0, y1, b.direction),
      outside = { lo: 0, hi: 0 };
    const sc = {
      lo: sc0.lo,
      hi: sc0.hi,
      y: (v) => {
        const yy = sc0.y(v);
        return yy > y1 + 6 ? y1 + 22 : yy < y0 - 6 ? y0 - 6 : yy;
      },
    };
    b.records.forEach((q) => {
      const yy = sc0.y(q.value);
      if (yy > y1 + 6) outside.lo++;
      else if (yy < y0 - 6) outside.hi++;
    });
    // the rule
    const rl = rule(g, x, y0 - 16, y1 + (outside.lo ? 28 : 6), m.status === "insufficient" ? "2 5" : null);
    rl.style.setProperty("--len", y1 - y0 + 22);
    anim(rl, "draw");
    el(
      "path",
      {
        d: "M" + (x - 6) + " " + (y0 - 7) + " L" + x + " " + (y0 - 18) + " L" + (x + 6) + " " + (y0 - 7),
        fill: "none",
        stroke: "var(--ink)",
        "stroke-width": 2,
      },
      g,
    );
    tx(g, x + 11, y0 - 11, "better", { "font-size": small - 1, fill: "var(--mute)", class: "it" });
    const ticks = niceTicks(sc.lo, sc.hi, 5).filter((v) => sc.y(v) >= y0 - 4 && sc.y(v) <= y1 + 4);
    // every record, laid out together so no two marks overprint
    const special = new Map([[top.rid, "top"]]);
    if (m.fair) special.set(m.fair.rid, "fair");
    (m.sets || []).forEach((s) => special.set(s.w.rid, "fair"));
    if (m.mode === "Q_threshold" && m.groups)
      m.groups.forEach((gq) => {
        if (!special.has(gq.champion_rid)) special.set(gq.champion_rid, "champ");
      });
    const pos = layout(b.records, x, sc, r, dn.cols, 7);
    const at = new Map(pos.map((p) => [p.r.rid, p]));
    pos.forEach((p, i) => {
      const sp = special.get(p.r.rid);
      if (sp) return;
      const e = drawMark(g, p, p.s === 0 && nU > 8 ? Math.max(2, r * 0.45) : r, { tick: dn.tick });
      e.setAttribute("opacity", m.status === "insufficient" ? 0.75 : kept.has(p.r.rid) ? 0.9 : 0.5);
      e.style.setProperty("--dx", -p.s * 14 + "px");
      anim(e, "hang", 40 + Math.min(i * (dn.tick ? 3 : 22), 500));
    });
    const minL = Math.min(x - (nU && nU <= 8 ? r + 2 : 10), ...pos.filter((p) => p.s < 0).map((p) => p.x - r)),
      maxR = Math.max(x + 10, ...pos.filter((p) => p.s > 0).map((p) => p.x + r));
    const tp = at.get(top.rid);
    const topMark = drawMark(g, tp, R2, { circle: true, win: true });
    // the top value first lands where a leaderboard puts it, on the test side, then moves to where it was measured
    const evict = sideOf(top) <= 0 && !S.reduced && !S.quick;
    const T0 = evict ? 300 : 0;
    if (evict) {
      const ex0 = x + Math.max(r + 7, 2 * r + 3);
      topMark.style.setProperty("--ex", ex0 - tp.x + "px");
      anim(topMark, "evict", 350);
      topMark.style.setProperty("--fill-to", sideOf(top) === 0 ? "var(--page)" : hueOf(top)); // ink while it is "ranked first", its own colour once it crosses
      const fl = tx(g, ex0 + R2 + 10, tp.y + 5, "ranked first", {
        "font-size": small,
        class: "it flash",
        fill: "var(--mute)",
      });
      fl.style.animationDelay = "350ms";
      if (S.present && S.beat === 0 && !S.reduced)
        // step 1 of a talk: the value sits on the test side, "ranked first", until the presenter moves on
        requestAnimationFrame(() => {
          if (!S.present || S.beat !== 0) return; // the presenter has already moved on
          S.held = [];
          [
            [topMark, 670],
            [fl, 730],
          ].forEach(([e, t]) =>
            e.getAnimations().forEach((a) => {
              a.pause();
              a.currentTime = t;
              S.held.push(a);
            }),
          );
        });
    } else anim(topMark, "stamp", 500);
    const ty = tp.y,
      lx = Math.min(x - 54, minL - 62);
    // LEFT stack: the leaderboard's number (beat 0)
    const L = anim(el("g", { class: "beat-0" }, g), "fade", 880);
    tx(L, lx, ty - num * 0.5, "the leaderboard says", {
      "font-size": small,
      "text-anchor": "end",
      class: "it",
      fill: "var(--mute)",
    });
    const dag = sideOf(top) > 0 ? "" : sideOf(top) === 0 ? "?" : "†";
    const nT = tx(L, lx, ty + num * 0.34, val(top.value), {
      "font-size": num,
      "text-anchor": "end",
      fill: textHue(top),
      class: "num topnum",
      "letter-spacing": "-0.02em",
    });
    if (dag) {
      const ds = el("tspan", { "font-size": num * 0.3, dy: -num * 0.44, dx: 3, fill: "var(--ink)", class: "dag" }, nT);
      ds.textContent = dag;
    }
    anim(nT, "settle", 880);
    if (tp.x - (R2 + 3) - (lx + 10) > 18)
      el("line", { x1: tp.x - (R2 + 3), x2: lx + 10, y1: ty, y2: ty, stroke: "var(--ink)", "stroke-width": 1.5 }, L);
    const yM = ty + num * 0.34 + it + 8;
    tx(L, lx, yM, shortMethod(top, 34), { "font-size": it, "text-anchor": "end", class: "it" });
    const fnText =
      sideOf(top) > 0
        ? "measured on the test split"
        : sideOf(top) === 0
          ? "? split not recorded in the source table"
          : "† measured on the " + splitWord(top.proto);
    const yF = yM + fn + 12;
    // on a projector the footnote is step 2's news, so it waits with the fair answer
    const FN = el("g", S.present ? { class: "beat-1" } : {}, L);
    const fT = tx(FN, lx, yF, fnText, { "font-size": fn, "text-anchor": "end" });
    if (sideOf(top) <= 0) {
      const w = textW(fT);
      anim(
        marker(
          FN,
          lx - w,
          yF - fn * 0.8,
          w,
          fn * 1.02,
          sideOf(top) === 0 ? "rgba(128,128,128,.18)" : "var(--hl-o)",
          fnText,
        ),
        "swipe",
        1250,
      );
      el(
        "line",
        { x1: lx - w, x2: lx, y1: yF + 5, y2: yF + 5, class: "hl-line " + (sideOf(top) === 0 ? "hl-u" : "hl-o") },
        FN,
      );
    }
    tx(
      L,
      lx,
      yF + small + 9,
      (top.arxiv_id ? "arXiv:" + top.arxiv_id : "no arXiv id") + " · " + pointer(top.source_location),
      { "font-size": small, "text-anchor": "end", class: "mono src", fill: "var(--mute)" },
    );
    // the nearest rivals the leaderboard would show next, named where a reader looks for them
    const runL = ranked(
      b.records
        .filter((q) => q.rid !== top.rid && !(m.fair && q.rid === m.fair.rid) && sideOf(q) <= 0)
        .map((q) => q.rid),
    ).slice(0, P ? 0 : 2);
    runL.forEach((q, k) => {
      const t = tx(
        L,
        lx,
        yF + small + 9 + (k + 1) * (small + 7),
        "next: " +
          shortMethod(q, 30) +
          " " +
          val(q.value) +
          (sideOf(q) === 0 ? " · no split" : " · " + (SPLIT_SHORT[q.proto.split] || q.proto.split)),
        {
          "font-size": small - 1,
          "text-anchor": "end",
          class: "mono src",
          fill: sideOf(q) === 0 ? "var(--mute)" : textHue(q),
          opacity: 0.85,
        },
      );
      t.classList.add("rival");
    });
    const leftBand = [ty - num * 0.62, yF + small + 14 + runL.length * (small + 7)];
    // RIGHT: relation + the fair number (beat 1)
    const Rg = anim(el("g", { class: "beat-1" }, g), "fade", 1020);
    const bx = Math.max(x + 30, maxR + 14);
    const relation = (txt, yA, yB) => {
      const a = Math.min(yA, yB),
        c = Math.max(yA, yB);
      if (c - a > 6)
        anim(
          el(
            "path",
            {
              d: "M" + (bx - 6) + " " + a + " H" + bx + " V" + c + " H" + (bx - 6),
              fill: "none",
              stroke: "var(--ink)",
              "stroke-width": 1.5,
            },
            Rg,
          ),
          "fade",
          1120,
        );
      const t = tx(Rg, bx + 10, (a + c) / 2 + relF * 0.35, txt, { "font-size": relF, class: "it" });
      anim(t, "settle", 1160);
      return bx + 10 + textW(t) + 26;
    };
    let rightBand = [0, 0],
      capText = "";
    const rightStack = (F, rx, label) => {
      const fp = at.get(F.rid),
        fy = fp.y;
      el("line", { x1: fp.x + (R2 + 3), x2: bx - 9, y1: fy, y2: fy, stroke: "var(--ink)", "stroke-width": 1.5 }, Rg);
      tx(Rg, rx, fy - num * 0.5, label, { "font-size": small, class: "it", fill: "var(--mute)" });
      const t = tx(Rg, rx, fy + num * 0.34, val(F.value), {
        "font-size": num,
        fill: "var(--test-text)",
        class: "num",
        "letter-spacing": "-0.02em",
      });
      anim(t, "settle", 1060);
      const w = textW(t);
      anim(
        marker(Rg, rx, fy + num * 0.34 - num * 0.14, w, num * 0.2, "var(--hl-t)", val(F.value) + F.method),
        "swipe",
        1350,
      );
      el(
        "line",
        {
          x1: rx,
          x2: rx + w,
          y1: fy + num * 0.34 + num * 0.08,
          y2: fy + num * 0.34 + num * 0.08,
          class: "hl-line hl-t",
        },
        Rg,
      );
      tx(Rg, rx, fy + num * 0.34 + it + 8, shortMethod(F, 34) + (tiedWith([...kept], F.rid).length ? " (tied)" : ""), {
        "font-size": it,
        class: "it",
      });
      const a = auditOf(F);
      const ok = a && (a.verdict === "ok" || a.verdict === "missing");
      const pv = (F.arxiv_id ? "arXiv:" + F.arxiv_id : "no arXiv id") + " · " + pointer(F.source_location),
        yP = fy + num * 0.34 + it + 8 + small + 10;
      tx(Rg, rx, yP, ok ? "✓ checked by hand" : pv, {
        "font-size": small,
        class: ok ? "mono" : "mono src",
        fill: "var(--mute)",
      });
      let yLast = yP;
      if (ok) {
        yLast = yP + small + 6;
        tx(Rg, rx, yLast, pv, { "font-size": small, class: "mono src", fill: "var(--mute)" });
      }
      const runR = P
        ? []
        : ranked(b.records.filter((q) => q.rid !== F.rid && sideOf(q) > 0 && kept.has(q.rid)).map((q) => q.rid)).slice(
            0,
            1,
          );
      let yR = yLast + small + 10;
      runR.forEach((q) => {
        tx(Rg, rx, yR, "next on test: " + shortMethod(q, 30) + " " + val(q.value), {
          "font-size": small - 1,
          class: "mono src",
          fill: "var(--test-text)",
          opacity: 0.85,
        });
        yR += small + 7;
      });
      rightBand = [fy - num * 0.62, Math.max(fy + num * 0.34 + it + small + 26, yR)];
    };
    if (m.mode === "Q_official" && m.status === "conditional") {
      m.sets.forEach((s) => {
        const p = at.get(s.w.rid);
        anim(drawMark(g, p, R2, { win: true, circle: true, cls: S.present ? "beat-1" : "" }), "stamp", 1000);
      });
      const ys = m.sets.map((s) => at.get(s.w.rid).y);
      const rx = relation(m.sets.length + " sets disagree", Math.min(...ys), Math.max(...ys));
      tx(Rg, rx, Math.min(...ys) - num * 0.5, "fair comparison, test split · each set has its own winner", {
        "font-size": small,
        class: "it",
        fill: "var(--mute)",
      });
      const used = [];
      let lo = 1e9,
        hi = -1e9;
      m.sets.forEach((s, i) => {
        const p = at.get(s.w.rid);
        let yy = p.y;
        while (used.some((u) => Math.abs(u - yy) < num * 0.4)) yy += num * 0.4;
        used.push(yy);
        lo = Math.min(lo, yy);
        hi = Math.max(hi, yy);
        el("line", { x1: p.x + (R2 + 3), x2: rx - 8, y1: p.y, y2: yy, stroke: "var(--ink)", "stroke-width": 1.2 }, Rg);
        const t = tx(Rg, rx, yy + num * 0.14, val(s.w.value), {
          "font-size": num * 0.42,
          fill: "var(--test-text)",
          class: "num",
        });
        anim(t, "settle", 1060 + i * 120);
        tx(Rg, rx + textW(t) + 12, yy + num * 0.14, shortMethod(s.w, 30), { "font-size": it * 0.8, class: "it" });
        tx(Rg, rx, yy + num * 0.14 + small + 6, "metric written as “" + s.key.metric_surface + "” · " + nRec(s.n), {
          "font-size": small,
          class: "mono",
          fill: "var(--mute)",
        });
      });
      rightBand = [lo - num * 0.6, hi + num * 0.4 + small + 10];
      capText =
        "The test-split records fall into " +
        m.sets.length +
        " groups whose metric names are written differently, and each has its own best value.";
    } else if (m.fair && (m.mode === "Q_official" || m.mode === "Q_threshold")) {
      const F = m.fair,
        fp = at.get(F.rid);
      anim(drawMark(g, fp, R2, { win: true, circle: true, cls: S.present ? "beat-1" : "" }), "stamp", 1000);
      const relTxt =
        m.mode === "Q_threshold"
          ? "holds in " + m.groups.filter((q) => q.clears).length + " of " + m.groups.length
          : F.method === top.method && F.rid !== top.rid
            ? "same method, test run"
            : F.rid === top.rid
              ? "the top is the fair answer"
              : (F.value - top.value >= 0 ? "+" : "−") +
                Math.abs(F.value - top.value).toFixed(Math.max(dec(F.value), dec(top.value)));
      const rx = relation(relTxt, ty, fp.y);
      rightStack(F, rx, m.mode === "Q_threshold" ? "test-set leader" : "fair comparison, test split");
      if (m.mode === "Q_threshold" && m.tau != null) {
        const yt = sc.y(m.tau);
        el(
          "line",
          {
            x1: x - 34,
            x2: x + 50,
            y1: yt,
            y2: yt,
            stroke: "var(--ink)",
            "stroke-width": 1.5,
            "stroke-dasharray": "5 4",
          },
          Rg,
        );
        tx(Rg, x + 56, yt + 16, "bar " + val(m.tau), { "font-size": small - 2, class: "mono", fill: "var(--mute)" });
        m.groups.forEach((gq) => {
          const c = rec(gq.champion_rid);
          if (c.rid === F.rid) return;
          const cp = at.get(c.rid);
          drawMark(g, cp, R2, { circle: true });
          const ex = cp.x + (cp.s < 0 ? -(R2 + 10) : R2 + 10);
          if (gq.clears)
            el(
              "path",
              { d: "M" + (ex - 4) + " " + cp.y + " l4 4 l7 -8", fill: "none", stroke: "var(--ink)", "stroke-width": 2 },
              Rg,
            );
          else {
            pencil(Rg, ex - 9, cp.y - 9, ex + 9, cp.y + 9, "x" + c.rid);
            pencil(Rg, ex - 9, cp.y + 9, ex + 9, cp.y - 9, "y" + c.rid);
          }
        });
        capText =
          "The test-set leader has to beat the bar (the next test record) in every setup where it has a rival. A red stroke marks a setup where it doesn't.";
      } else
        capText =
          "Every record sits at its value: test split to the right, other splits to the left, faded if the question does not keep it. " +
          (nU ? "Hollow rings on the rule state no split, so they compete with nothing. " : "") +
          (sideOf(top) === 0
            ? "The top value is one of them."
            : "The top value hangs on the " + splitWord(top.proto).replace(" split", "") + " side.");
    } else if (m.status === "insufficient") {
      const rx = bx + 16;
      const cnt = S.meta.stats.status_counts[S.tmpl].insufficient,
        tot = S.meta.stats.query_conditioned_boards;
      const ex = b.answers.Q_official.excluded;
      const reason =
        m.mode === "Q_official"
          ? ex.split_not_reported === n
            ? n === 1
              ? "the only record does not state its split."
              : "none of the " + n + " records states its split."
            : "no two records share a test-split setup."
          : m.mode === "Q_trend"
            ? "no preprint year has two records with the same setup."
            : plainTerms(b.answers.Q_threshold.reason);
      tx(Rg, rx, ty - num * 0.5, "fair comparison", { "font-size": small, class: "it", fill: "var(--mute)" });
      anim(tx(Rg, rx, ty + 14, "No fair comparison possible", { "font-size": 38, class: "it" }), "settle", 1100);
      tx(Rg, rx, ty + 14 + fn + 14, reason, { "font-size": fn });
      tx(
        Rg,
        rx,
        ty + 14 + fn + 14 + small + 12,
        fmtN(cnt) + " of " + fmtN(tot) + " rankable leaderboards end the same way",
        { "font-size": small, class: "mono", fill: "var(--mute)" },
      );
      rightBand = [ty - num * 0.62, ty + 14 + fn + small + 40];
      capText =
        "No two records can be compared under this question, so the right side stays bare: that is the verdict.";
    } else if (m.mode === "Q_trend") {
      const ys = m.years,
        n2 = ys.length;
      const x0 = x + 160;
      const gapx = Math.min(170, (W - x0 - 70) / Math.max(1, n2 - 1));
      const nW = ys.reduce((a2, yy) => a2 + yy.sets.length, 0);
      tx(
        Rg,
        x0 - 10,
        y0 - 34,
        "fair comparison, by preprint year · " +
          n2 +
          " year" +
          (n2 === 1 ? "" : "s") +
          (nW > n2 ? ", " + nW + " setup winners" : ""),
        { "font-size": small, class: "it", fill: "var(--mute)" },
      );
      // faint gridlines carry the main rule's scale across to the year rules
      ticks.forEach((v) =>
        el(
          "line",
          {
            x1: x0 - 24,
            x2: x0 + (n2 - 1) * gapx + 24,
            y1: sc.y(v),
            y2: sc.y(v),
            stroke: "var(--faint)",
            "stroke-width": 1,
            "stroke-dasharray": "2 4",
          },
          Rg,
        ),
      );
      ys.forEach((yy, i) => {
        const xx = x0 + i * gapx;
        anim(
          el("line", { x1: xx, x2: xx, y1: y0, y2: y1 + 6, stroke: "var(--ink)", "stroke-width": 1.5 }, Rg),
          "fade",
          1100 + i * 120,
        );
        tx(Rg, xx, y1 + 24, String(yy.year), {
          "font-size": small,
          "text-anchor": "middle",
          class: "mono",
          fill: "var(--mute)",
        });
        const sets = yy.sets.map((s) => rec(s.winner_rid));
        const used2 = [];
        sets.forEach((w, j) => {
          const y2 = sc.y(w.value),
            sd = sideOf(w),
            cx = xx + sd * (r + 6);
          const c = el(
            "circle",
            {
              cx,
              cy: y2,
              r: r + 2,
              fill: sd === 0 ? "var(--page)" : hueOf(w),
              stroke: "var(--ink)",
              "stroke-width": 2,
              class: "mk",
              "data-rid": w.rid,
            },
            Rg,
          );
          anim(c, "stamp", 1200 + i * 120);

          const right = sd >= 0;
          let ly = y2 + 5;
          while (used2.some((u) => u[0] === right && Math.abs(u[1] - ly) < 15)) ly += 15;
          used2.push([right, ly]);
          tx(Rg, cx + (right ? r + 10 : -(r + 10)), ly, val(w.value), {
            "font-size": small,
            "text-anchor": right ? "start" : "end",
            class: "mono",
            fill: textHue(w),
          });
        });
        tx(Rg, xx, y1 + 24 + small + 3, shortMethod(sets[0], Math.max(6, Math.floor(gapx / 8))), {
          "font-size": small - 2,
          "text-anchor": "middle",
          class: "it",
          fill: "var(--mute)",
        });
      });
      rightBand = [y0 - 40, y1 + 60];
      const orangeW = ys.some((yy) => yy.sets.some((s2) => sideOf(rec(s2.winner_rid)) < 0));
      capText =
        "Each preprint year gets its own rule, on the same scale as the main one, holding that year's best record for each setup. Years with fewer than two comparable records are left out." +
        (orangeW ? " An orange winner was measured on another split, so it can't be compared with a green one." : "");
    }
    if (outside.lo) {
      el("rect", { x: x - 3, y: y1 + 8, width: 6, height: 6, fill: "var(--page)" }, g);
      el(
        "path",
        {
          d: "M" + (x - 7) + " " + (y1 + 11) + " l14 -5 M" + (x - 7) + " " + (y1 + 16) + " l14 -5",
          stroke: "var(--ink)",
          "stroke-width": 1.5,
          fill: "none",
        },
        g,
      );
    }
    if (outside.lo)
      tx(
        g,
        x + 26,
        y1 + 26,
        outside.lo +
          " more below " +
          fmtTick(+(b.direction === "higher" ? sc0.lo : sc0.hi).toPrecision(2)) +
          ", off the scale",
        { "font-size": small - 3, class: "mono", fill: "var(--mute)" },
      );
    if (outside.hi)
      tx(g, x + 12, y0 - 24, "▴ " + outside.hi + " above", {
        "font-size": small - 3,
        class: "mono",
        fill: "var(--mute)",
      });
    // the scale, kept clear of the two leaders
    const champs = (m.groups || []).map((gq) => at.get(gq.champion_rid)).filter((c) => c && c.s < 0);
    ticks.forEach((v) => {
      const yy = sc.y(v);
      el("line", { x1: x - 5, x2: x, y1: yy, y2: yy, stroke: "var(--ink)", "stroke-width": 1.5 }, g);
      // a group leader sitting on a tick pushes the label further left; the scale never loses a number
      const clash = champs.filter((c) => Math.abs(c.y - yy) < R2 + 12).map((c) => c.x - R2 - 10);
      const lxT = Math.min(x - 9, minL - 10, ...clash) - (nU > 8 ? 4 : 0);
      if (Math.abs(yy - ty) < 12) return;
      tx(g, lxT, yy + 4, fmtTick(v), {
        "font-size": small - 1,
        "text-anchor": "end",
        class: "mono tick",
        fill: "var(--mute)",
      });
    });
    // annotate every other record at its height, where the big stacks leave room: the leaderboard, as a ruler
    if (!P && m.mode !== "Q_trend" && n <= 40) {
      const inBand = (y, band) => y > band[0] && y < band[1];
      const usedL = [],
        usedR = [];
      pos
        .slice()
        .sort((a2, b2) => a2.y - b2.y)
        .forEach((p) => {
          if (special.has(p.r.rid)) return;
          const left = p.s < 0 || (p.s === 0 && false);
          if (p.s === 0) return;
          if (left ? inBand(p.y, leftBand) : inBand(p.y, rightBand)) return;
          const used = left ? usedL : usedR;
          if (used.some((u) => Math.abs(u - p.y) < 15)) return;
          used.push(p.y);
          const lxA = left ? minL - 12 : maxR + 12;
          const k2 = kept.has(p.r.rid);
          const t = tx(g, lxA, p.y + 4, shortMethod(p.r, 26) + "  " + val(p.r.value), {
            "font-size": 12.5,
            "text-anchor": left ? "end" : "start",
            class: "mono anno",
            fill: left ? "var(--other-text)" : "var(--test-text)",
            opacity: k2 ? 0.9 : 0.55,
          });
          anim(t, "fade", 1300 + p.y * 0.5);
        });
    }
    if (!P) {
      const yc = y1 + (outside.lo ? 50 : 30);
      // the legend names only the kinds of record this leaderboard actually has
      const hasO = b.records.some((q) => sideOf(q) < 0),
        hasT = b.records.some((q) => sideOf(q) > 0);
      if (hasO) {
        tx(g, x - 24, yc, "other splits", {
          "font-size": small,
          "text-anchor": "end",
          class: "it",
          fill: "var(--other-text)",
        });
        el("circle", { cx: x - 11, cy: yc - 5, r: 5, fill: "var(--other)" }, g);
      }
      const tT = hasT
        ? tx(g, x + 24, yc, "test split", { "font-size": small, class: "it", fill: "var(--test-text)" })
        : null;
      if (hasT) el("circle", { cx: x + 11, cy: yc - 5, r: 5, fill: "var(--test)" }, g);
      if (nU && m.mode !== "Q_trend") {
        const xu = tT ? x + 24 + textW(tT) + 26 : x + 16;
        el("circle", { cx: xu, cy: yc - 5, r: 5, fill: "var(--page)", stroke: "var(--ink)", "stroke-width": 1.5 }, g);
        tx(g, xu + 11, yc, "on the rule: split not stated (" + nU + ")", {
          "font-size": small,
          class: "it",
          fill: "var(--mute)",
        });
      }
    }
    if (T0)
      [L, Rg, ...g.querySelectorAll(".win")].forEach((e0) =>
        [e0, ...e0.querySelectorAll("*")].forEach((e) => {
          if (e !== topMark && e.style.animationDelay)
            e.style.animationDelay = parseFloat(e.style.animationDelay) + T0 + "ms";
        }),
      );
    shortCap(
      "heroCap",
      "<b>Fig. 1.</b> All " +
        n +
        " records on one rule, best at the top. " +
        (touchOnly() ? "Tap" : "Hover") +
        " for sources.",
      "<b>Fig. 1.</b> All " + n + " result records on one rule. " + capText,
    );
  }

  /* phone: one rule on the left; both numbers hang to its right at their true heights */
  function phoneHero(svg, g, m, W, H) {
    const b = S.board,
      top = m.top,
      x = 44,
      y0 = 34,
      y1 = H - 28,
      num = 44,
      n = b.records.length,
      r = n > 40 ? 2.4 : 3.4;
    const vals = b.records.map((q) => q.value);
    if (m.tau != null) vals.push(m.tau);
    const sc = scale(vals, y0, y1, b.direction);
    const rl = rule(g, x, y0 - 12, y1 + 4, m.status === "insufficient" ? "2 5" : null);
    rl.style.setProperty("--len", y1 - y0 + 16);
    anim(rl, "draw");
    el(
      "path",
      {
        d: "M" + (x - 5) + " " + (y0 - 4) + " L" + x + " " + (y0 - 13) + " L" + (x + 5) + " " + (y0 - 4),
        fill: "none",
        stroke: "var(--ink)",
        "stroke-width": 2,
      },
      g,
    );
    const pos = layout(b.records, x, sc, r, 2, 4);
    const at = new Map(pos.map((p) => [p.r.rid, p]));
    niceTicks(sc.lo, sc.hi, 6).forEach((v) => {
      const yy = sc.y(v);
      if (yy < y0 - 2 || yy > y1 + 2) return;
      el("line", { x1: x - 4, x2: x, y1: yy, y2: yy, stroke: "var(--ink)", "stroke-width": 1.2 }, g);
      if (pos.some((p) => p.x < x + 1 && Math.abs(p.y - yy) < r + 7)) return;
      tx(g, x - 7, yy + 3.5, fmtTick(v), { "font-size": 11, "text-anchor": "end", class: "mono", fill: "var(--mute)" });
    });
    pos.forEach((p, i) => {
      if (p.r.rid === top.rid || (m.fair && p.r.rid === m.fair.rid)) return;
      const e = drawMark(g, p, r, { tick: n > 120 });
      e.setAttribute("opacity", m.kept.has(p.r.rid) ? 0.9 : 0.5);
      anim(e, "settle", 150 + i * 18);
    });
    const tp = at.get(top.rid);
    // as on desktop: the top value lands on the test side in ink, then crosses to where it was measured
    const tm = drawMark(g, tp, r + 1.5, { circle: true, win: true }),
      pEv = sideOf(top) <= 0 && !S.reduced && !S.quick;
    if (pEv) {
      tm.style.setProperty("--ex", x + r + 4 - tp.x + "px");
      tm.style.setProperty("--fill-to", sideOf(top) === 0 ? "var(--page)" : hueOf(top));
      anim(tm, "evict", 250);
    } else anim(tm, "stamp", 500);
    const lx = x + 44;
    // each stack (leader line, label, number, name) arrives as one unit, after its mark
    const stack = (q, y, label, hue, extra, delay, mark) => {
      const sg = anim(el("g", {}, g), "fade", delay);
      el(
        "line",
        {
          x1: at.get(q.rid).x + r + 3,
          x2: lx - 6,
          y1: at.get(q.rid).y,
          y2: y,
          stroke: "var(--ink)",
          "stroke-width": 1.2,
        },
        sg,
      );
      tx(sg, lx, y - num * 0.44, label, { "font-size": 11, class: "it", fill: "var(--mute)" });
      const t = tx(sg, lx, y + num * 0.34, val(q.value), { "font-size": num, fill: hue, class: "num" });
      if (mark) {
        const ds = el("tspan", { "font-size": 16, dy: -num * 0.42, dx: 2, fill: "var(--ink)" }, t);
        ds.textContent = mark;
      }
      anim(t, "settle", delay);
      const w = textW(t);
      tx(sg, lx + w + 12, y - 2, shortMethod(q, Math.max(8, Math.floor((W - lx - w - 16) / 7.5))), {
        "font-size": 14,
        class: "it",
      });
      tx(sg, lx + w + 12, y + 15, extra, { "font-size": 11, class: "mono", fill: "var(--mute)" });
    };
    const topExtra =
      sideOf(top) > 0
        ? "test split"
        : sideOf(top) === 0
          ? "split not stated"
          : (SPLIT_SHORT[top.proto.split] || top.proto.split) + " split";
    const dag = sideOf(top) > 0 ? "" : sideOf(top) === 0 ? "?" : "†";
    let ty = tp.y;
    if (m.fair && (m.mode === "Q_official" || m.mode === "Q_threshold")) {
      const F = m.fair,
        fp = at.get(F.rid);
      anim(drawMark(g, fp, r + 1.5, { circle: true, win: true }), "stamp", 1000);
      let fy = fp.y;
      const minGap = num * 1.2;
      if (Math.abs(fy - ty) < minGap) {
        if (fy >= ty) fy = ty + minGap;
        else ty = fy + minGap;
      }
      stack(top, ty, "the leaderboard says", textHue(top), topExtra, pEv ? 1000 : 500, dag);
      stack(
        F,
        fy,
        m.mode === "Q_threshold" ? "test-set leader" : "fair comparison",
        "var(--test-text)",
        "test split",
        1150,
        "",
      );
      const relTxt =
        m.mode === "Q_threshold"
          ? "holds " + m.groups.filter((q) => q.clears).length + "/" + m.groups.length
          : F.method === top.method && F.rid !== top.rid
            ? "same method"
            : (F.value - top.value >= 0 ? "+" : "−") +
              Math.abs(F.value - top.value).toFixed(Math.max(dec(F.value), dec(top.value)));
      anim(
        tx(g, lx, Math.max(ty, fy) + num * 0.34 + 30, "gap " + relTxt, { "font-size": 13, class: "it" }),
        "fade",
        1350,
      );
    } else {
      stack(top, ty, "the leaderboard says", textHue(top), topExtra, pEv ? 1000 : 500, dag);
      const line2 =
        m.status === "insufficient"
          ? "No fair comparison possible"
          : m.mode === "Q_trend"
            ? m.years.length +
              " yearly winners: " +
              m.years.map((y) => y.year + " " + val(rec(y.sets[0].winner_rid).value)).join(" · ")
            : m.sets
              ? m.sets.length + " test groups disagree: " + m.sets.map((s) => val(s.w.value)).join(" · ")
              : "";
      const ins = m.status === "insufficient",
        fs2 = ins ? 18 : 12,
        room = Math.max(12, Math.floor((W - lx - 6) / (ins ? 8.4 : 7.3))),
        l2 = wrapWords(line2, room, 3),
        y2 = Math.min(y1 - 4 - (l2.length - 1) * (fs2 + 3), ty + num * 0.34 + 34);
      const t2 = tx(g, lx, y2, "", {
        "font-size": fs2,
        class: ins ? "it" : "mono",
        fill: ins ? "var(--ink)" : "var(--test-text)",
      });
      l2.forEach((ln, li) => {
        const ts = el("tspan", { x: lx, dy: li ? fs2 + 3 : 0 }, t2);
        ts.textContent = ln;
      });
    }
    shortCap(
      "heroCap",
      "<b>Fig. 1.</b> All " + n + " records on one rule, best at the top.",
      "<b>Fig. 1.</b> All " +
        n +
        " result records on one rule; better is up. <span class='tt'>Test split</span> right of the rule, <span class='ot'>other splits</span> left, hollow rings on the rule state no split.",
    );
  }

  // ------------------------------------------------------------------ why line
  function whyText() {
    const A = S.board.answers,
      n = rec(A.Q_any.winner_rid);
    if (S.tmpl === "Q_official") {
      const o = A.Q_official,
        e = o.excluded;
      if (o.status === "insufficient") {
        const n = S.board.records.length,
          parts = [];
        if (e.split_not_reported)
          parts.push(
            e.split_not_reported === n
              ? (n === 1 ? "the only record has" : "all " + n + " records have") +
                  " no split identified in the extracted record"
              : e.split_not_reported + " have no split identified",
          );
        if (e.other_split) parts.push(e.other_split + " are on another split");
        if (o.n_official_records)
          parts.push(
            o.n_official_records +
              (o.n_official_records === 1 ? " carries" : " carry") +
              " a test-split label but has no peer with the same metric name and unit",
          );
        return "<b>No two records can be fairly compared</b> on the test split: " + parts.join("; ") + ".";
      }
      if (o.status === "conditional")
        return "<b>The test-split groups disagree</b>: each has its own winner, so there is no single fair answer.";
      const q = rec(o.winner_rid);
      if (q.rid === n.rid) return "The top number is also the best comparable test-split record.";
      if (q.method === n.method) return "Both answers name " + esc(q.method) + ", but from different records.";
      if (n.proto.split == null || n.proto.metric_surface == null)
        return "The top number has <b>no recorded setup</b>, so it cannot be compared with test-split records.";
      if (n.proto.split !== "test")
        return (
          "The top number was measured on the <b class='o'>" +
          esc(splitWord(n.proto)) +
          "</b>, so it does not compete with test-split records."
        );
      return "The top number is on the test split, but under <b>a different metric name</b>, so it sits in its own group.";
    }
    if (S.tmpl === "Q_trend") {
      const tr = A.Q_trend;
      if (tr.status === "insufficient") return "<b>No preprint year</b> has two records with the same recorded setup.";
      if (tr.status === "conditional")
        return "<b>In some years the groups disagree</b>, so the winner depends on the setup. Records are grouped by the year of their preprint, so this is not a history of progress.";
      return "Each preprint year has one winner across its groups. Records are grouped by the year of their preprint, so this is not a history of progress.";
    }
    const q = A.Q_threshold;
    if (q.status === "insufficient")
      return "<b>The lead cannot be tested</b>: the test-set leader meets a rival under only one setup, or there is no test-set group.";
    if (q.status === "conditional")
      return "The test-set leader stays ahead of the bar in some groups <b>but not all</b>.";
    return "The test-set leader stays ahead of the bar in <b>every group</b> where it meets a rival.";
  }
  function askText() {
    const b = S.board,
      ds = esc(b.dataset),
      m = esc(metricName(b.metric));
    if (S.tmpl === "Q_trend" && b.scored) return "How does the best " + m + " on " + ds + " change by preprint year?";
    if (S.tmpl === "Q_threshold" && b.scored) return "On " + ds + " (" + m + "), does the test-set leader stay ahead?";
    return "What is the best " + m + " on " + ds + "?";
  }

  // ------------------------------------------------------------------ pipeline (five rulers, one scale)
  function pipeModel() {
    const b = S.board,
      A = b.answers,
      t = S.tmpl,
      kept = new Set(),
      winners = new Set();
    if (b.scored) {
      if (t === "Q_official")
        A.Q_official.sets.forEach((s) => {
          s.rids.forEach((i) => kept.add(i));
          winners.add(s.winner_rid);
        });
      if (t === "Q_trend")
        A.Q_trend.years.forEach((y) =>
          y.sets.forEach((s) => {
            s.rids.forEach((i) => kept.add(i));
            winners.add(s.winner_rid);
          }),
        );
      if (t === "Q_threshold")
        A.Q_threshold.groups.forEach((g) => {
          g.rids.forEach((i) => kept.add(i));
          winners.add(g.champion_rid);
        });
    }
    const n = b.records.length,
      tagged = b.records.filter((q) => q.cluster != null).length,
      un = b.unknown_rids.length;
    const papers = {};
    b.records.forEach((q) => {
      const a = q.arxiv_id || "?";
      (papers[a] = papers[a] || []).push(q);
    });
    const plist = Object.keys(papers).sort((a, c) => papers[c].length - papers[a].length);
    let sets = b.clusters.map((c, i) => ({
      i,
      rids: c.rids.slice(),
      p: c.protocol,
      hit: c.rids.filter((r) => kept.has(r)).length,
    }));
    sets.sort((a, c) => (a.p && a.p.split === "test") - (c.p && c.p.split === "test") || c.rids.length - a.rids.length);
    if (sets.length > 5) {
      const rest = sets.splice(4);
      sets.push({
        i: -1,
        rids: rest.flatMap((s) => s.rids),
        p: null,
        more: rest.length,
        hit: rest.reduce((a, s) => a + s.hit, 0),
      });
    }
    let s4 = "",
      s5 = "",
      out = "",
      outRec = null,
      kcount = kept.size + " kept";
    if (!b.scored) {
      s4 = "no question applied: higher or lower is not recorded";
      s5 = "nothing to pick";
      out = "no answer";
    } else if (t === "Q_official") {
      const o = A.Q_official;
      s4 =
        "“Best on test split” keeps " +
        (o.sets.length === 0 ? "no group" : o.sets.length === 1 ? "one group" : o.sets.length + " groups");
      if (o.status === "robust") {
        const r = rec(o.winner_rid);
        outRec = r;
        s5 = "take the best kept record";
        out = methodName(r) + " " + val(r.value);
      } else if (o.status === "conditional") {
        s5 = "each kept group has its own winner";
        out = "no single winner";
      } else {
        s5 = "nothing to compare";
        out = "no fair comparison";
      }
    } else if (t === "Q_trend") {
      const tr = A.Q_trend,
        y = tr.years.length;
      s4 = "“Best per year” splits each group by preprint year";
      kcount = y + (y === 1 ? " year" : " years");
      if (y) {
        s5 = "best per year within each group";
        out = tr.years.reduce((a, x) => a + x.sets.length, 0) + " yearly winners";
      } else {
        s5 = "nothing to compare";
        out = "no fair comparison";
      }
    } else {
      const q = A.Q_threshold,
        k = q.groups.filter((x) => x.clears).length;
      s4 = "fix the test-set leader and the bar, then test each group";
      kcount = q.groups.length + (q.groups.length === 1 ? " group tested" : " groups tested");
      s5 = "does the leader beat the bar in every group?";
      out = q.status === "insufficient" ? "no fair comparison" : "holds in " + k + " of " + q.groups.length;
    }
    return {
      kept,
      winners,
      n,
      tagged,
      un,
      papers,
      plist,
      sets,
      outRec,
      kcount,
      out,
      counts: [
        n + (n === 1 ? " record · " : " records · ") + plist.length + (plist.length === 1 ? " paper" : " papers"),
        tagged + " of " + n + " tagged",
        b.clusters.length + (b.clusters.length === 1 ? " setup" : " setups") + (un ? " + " + un + " unknown" : ""),
        kcount,
        out,
      ],
      descs: [
        "collect result records from papers",
        "note each record's split, metric name and unit",
        "put records with the same setup together",
        s4,
        s5,
      ],
    };
  }

  function renderPipeline() {
    const host = $("pipe");
    host.innerHTML = "";
    host.classList.add("pipe-host");
    const b = S.board,
      m = pipeModel(),
      P = S.present,
      phone = !P && window.matchMedia("(max-width: 760px)").matches,
      // desktop: the stage names, plain descriptions and counts live in the clickable bar above the figure
      bar = !P && !phone;
    const W = P ? 1800 : phone ? 360 : 1248,
      H = bar
        ? 330
        : P
          ? Math.round(
              Math.max(
                380,
                Math.min(760, (1800 * (window.innerHeight - 330)) / Math.max(600, window.innerWidth - 128)),
              ),
            )
          : phone
            ? 250
            : 400, // present: its own slide, sized to the screen
      cols = 5,
      cw = W / cols,
      y0 = bar ? 22 : P ? 60 : 52,
      y1 = phone ? H - 46 : P ? H - 118 : bar ? H - 66 : H - 92,
      small = P ? 22 : phone ? 10 : 14;
    const dn = density(m.n),
      r = P ? dn.r * 1.5 : phone ? Math.max(2.5, dn.r * 0.6) : dn.r;
    const svg = el(
      "svg",
      {
        viewBox: (phone ? "-6 0 " + (W + 16) : "0 0 " + W) + " " + H, // phone: room so the last column's marks are not cut
        role: "img",
        "aria-label": m.n + " result records ruled by value through five stages",
      },
      host,
    );
    const g = el("g", {}, svg);
    const sc = scale(
      b.records.map((q) => q.value),
      y0,
      y1,
      b.direction,
    );
    const names = ["Extract", "Tag setup", "Group", "Apply question", "Pick"];
    // each column is also a target: click anywhere in it to open that stage's records beneath the figure
    if (bar)
      for (let i = 0; i < 5; i++)
        el("rect", { x: i * cw, y: 0, width: cw, height: H, class: "colhit", "data-action": "stage", "data-s": i }, g);
    const layers = [0, 1, 2, 3, 4].map(() => el("g", { class: "col" }, g));
    if (phone) {
      const defs = el("defs", {}, svg);
      layers.forEach((ly, k) => {
        const id = "pc" + k;
        const cp = el("clipPath", { id }, defs);
        el("rect", { x: k * cw - 7, y: 0, width: cw + 14, height: H }, cp); // a little bleed so edge marks are not cut in half
        ly.setAttribute("clip-path", "url(#" + id + ")");
      });
    }
    for (let i = 0; i < cols; i++) {
      if (i)
        el(
          "line",
          {
            x1: i * cw,
            x2: i * cw,
            y1: 10,
            y2: H - 6,
            stroke: "var(--faint)",
            "stroke-width": 1,
            "stroke-dasharray": "2 5",
          },
          g,
        );
      if (phone) {
        const ls = phoneCount(m, i, Math.floor((cw - 6) / 6.2));
        ls.forEach((ln, li) =>
          tx(layers[i], i * cw + cw / 2, 16 + li * 14, ln, {
            "font-size": 11,
            "text-anchor": "middle",
            class: li ? "mono" : "mono strong",
            fill: i === 4 && m.outRec ? "var(--test-text)" : li ? "var(--mute)" : "var(--ink)",
          }),
        );
      }
      // on a projector the stage-5 answer is the payoff, so it is set large, in the paper face
      else if (!bar)
        tx(layers[i], i * cw + cw / 2, 22 + (P ? 6 : 0) + (P && i === 4 ? 10 : 0), m.counts[i], {
          "font-size": P && i === 4 ? 36 : small,
          "text-anchor": "middle",
          class: P && i === 4 ? "num" : "mono",
          fill: i === 4 ? "var(--test-text)" : "var(--ink)",
        });
      if (!bar)
        tx(
          g,
          phone ? i * cw + cw / 2 : i * cw + 12,
          H - (P ? 4 : 12),
          phone ? names[i].split(" ")[0] : i + 1 + "  " + names[i],
          {
            "font-size": phone ? 11 : small + 2,
            fill: phone ? "var(--mute)" : "var(--ink)",
            class: "it stage-name",
            "data-s": i,
            "text-anchor": phone ? "middle" : "start",
          },
        );
    }
    const pos = {};
    b.records.forEach((q) => {
      pos[q.rid] = [];
    });
    const put = (k, list, x, opts) =>
      layout(list, x, sc, r, phone ? 2 : dn.cols, phone ? 4 : 9).forEach((p) => {
        pos[p.r.rid][k] = { x: p.x, y: p.y, s: p.s };
      });
    // 1 extract
    const maxP = phone ? 3 : P ? 7 : Math.max(2, Math.min(7, Math.floor(cw / 46) - 1)),
      shown = m.plist.slice(0, maxP),
      rest1 = m.plist.slice(maxP),
      step1 = cw / (shown.length + (rest1.length ? 1 : 0) + 1);
    shown.forEach((a, i) => {
      const x = step1 * (i + 1);
      rule(layers[0], x, y0, y1);
      if (!phone && !P)
        tx(layers[0], x, y1 + 18 + (step1 < 110 ? (i % 2) * 16 : 0), a, {
          "font-size": small - 1,
          "text-anchor": "middle",
          class: "mono",
          fill: "var(--mute)",
        });
      layout(m.papers[a], x, sc, r, phone ? 1 : 4, 6, 0).forEach((p) => {
        pos[p.r.rid][0] = { x: p.x, y: p.y, s: 0 };
      });
    });
    if (rest1.length) {
      const x = step1 * (shown.length + 1);
      rule(layers[0], x, y0, y1, "2 5");
      if (!phone && !P)
        tx(layers[0], x, y1 + 50, "+" + rest1.length + " more papers", {
          "font-size": small - 1,
          "text-anchor": "middle",
          class: "mono",
          fill: "var(--mute)",
        });
      layout(
        rest1.flatMap((a) => m.papers[a]),
        x,
        sc,
        r,
        4,
        6,
        0,
      ).forEach((p) => {
        pos[p.r.rid][0] = { x: p.x, y: p.y, s: 0 };
      });
    }
    // 2 tag
    const x2 = cw * 1.5;
    rule(layers[1], x2, y0, y1);
    put(1, b.records, x2);
    // 3 group / 4 apply
    const slots = m.sets.length + (m.un ? 1 : 0),
      step3 = cw / (slots + 1),
      setX = (c, i) => cw * c + step3 * (i + 1);
    m.sets.forEach((s, i) => {
      const list = s.rids.map(rec);
      [2, 3].forEach((k) => {
        const x = setX(k, i);
        rule(layers[k], x, y0, y1, s.i < 0 ? "2 5" : null);
        put(k, list, x);
      });
      if (!phone) {
        const x3 = setX(2, i);
        const sw = s.p && s.p.split ? (s.p.split === "val" ? "val" : s.p.split === "train" ? "train" : s.p.split) : "?";
        const lab3 =
          s.i < 0
            ? ["+" + s.more + " sets", String(s.rids.length)]
            : [SPLIT_SHORT[s.p.split] || sw, String(s.rids.length)];
        el(
          "line",
          {
            x1: x3 - 8,
            x2: x3 + 8,
            y1: y1 + 8,
            y2: y1 + 8,
            stroke:
              s.i < 0
                ? "var(--mute)"
                : s.p.split === "test"
                  ? "var(--test)"
                  : s.p.split
                    ? "var(--other)"
                    : "var(--ink)",
            "stroke-width": 3,
          },
          layers[2],
        );
        stackLab(layers[2], x3, y1 + (P ? 38 : 24), lab3, small - (P ? 4 : 2), step3);
      }
      const x4 = setX(3, i);
      if (s.hit) {
        el(
          "line",
          { x1: x4 - 14, x2: x4 + 14, y1, y2: y1, stroke: "var(--ink)", "stroke-width": "var(--foot)" },
          layers[3],
        );
        if (!phone)
          tx(layers[3], x4, y1 + (P ? 34 : 24) + (step3 < 52 ? (i % 2) * (P ? 24 : 15) : 0), s.hit + " kept", {
            "font-size": small - 2,
            "text-anchor": "middle",
            class: "mono",
            fill: "var(--test-text)",
          });
      } else {
        {
          const cz = phone ? 5 : 9,
            cy0 = phone ? y1 - 10 : y1;
          el(
            "line",
            { x1: x4 - cz, x2: x4 + cz, y1: cy0 - cz, y2: cy0 + cz, stroke: "var(--ink)", "stroke-width": 2 },
            layers[3],
          );
          el(
            "line",
            { x1: x4 + cz, x2: x4 - cz, y1: cy0 - cz, y2: cy0 + cz, stroke: "var(--ink)", "stroke-width": 2 },
            layers[3],
          );
        }
        if (!phone) {
          tx(layers[3], x4, y1 + (P ? 34 : 24) + (step3 < 52 ? (i % 2) * (P ? 24 : 15) : 0), s.rids.length + " held", {
            "font-size": small - 2,
            "text-anchor": "middle",
            class: "mono",
          });
          if (step3 >= 120 && !P)
            tx(layers[3], x4, y1 + 39, heldReason(s.rids), {
              "font-size": small - 2,
              "text-anchor": "middle",
              class: "it",
              fill: "var(--mute)",
            });
        }
      }
    });
    if (m.un) {
      const list = b.unknown_rids.map(rec),
        i = m.sets.length;
      [2, 3].forEach((k) => {
        const x = setX(k, i);
        rule(layers[k], x, y0, y1, "2 5");
        put(k, list, x);
      });
      if (!phone) {
        const xu3 = setX(2, i);
        el(
          "circle",
          { cx: xu3, cy: y1 + 10, r: 3, fill: "var(--page)", stroke: "var(--ink)", "stroke-width": 1.2 },
          layers[2],
        );
        stackLab(layers[2], xu3, y1 + (P ? 38 : 26), ["no split", String(m.un)], small - (P ? 4 : 2), step3);
        const x4 = setX(3, i);
        {
          const cz = phone ? 5 : 9,
            cy0 = phone ? y1 - 10 : y1;
          el(
            "line",
            { x1: x4 - cz, x2: x4 + cz, y1: cy0 - cz, y2: cy0 + cz, stroke: "var(--ink)", "stroke-width": 2 },
            layers[3],
          );
          el(
            "line",
            { x1: x4 + cz, x2: x4 - cz, y1: cy0 - cz, y2: cy0 + cz, stroke: "var(--ink)", "stroke-width": 2 },
            layers[3],
          );
        }
        tx(layers[3], x4, y1 + (P ? 34 : 24) + (step3 < 52 ? (i % 2) * (P ? 24 : 15) : 0), m.un + " held", {
          "font-size": small - 2,
          "text-anchor": "middle",
          class: "mono",
        });
        if (step3 >= 120 && !P)
          tx(layers[3], x4, y1 + 39, "split not recorded", {
            "font-size": small - 2,
            "text-anchor": "middle",
            class: "it",
            fill: "var(--mute)",
          });
      }
    }
    // 5 pick
    const x5 = cw * 4.5;
    rule(layers[4], x5, y0, y1, m.kept.size ? null : "2 5");
    if (m.kept.size)
      el(
        "line",
        { x1: x5 - 14, x2: x5 + 14, y1, y2: y1, stroke: "var(--ink)", "stroke-width": "var(--foot)" },
        layers[4],
      );
    const keptList = [...m.kept].map(rec);
    put(4, keptList, x5);
    if (b.scored && S.tmpl === "Q_official" && b.answers.Q_official.status === "robust") {
      const w = rec(b.answers.Q_official.winner_rid);
      const yf = sc.y(w.value);
      el(
        "line",
        {
          x1: cw * 3 + 6,
          x2: cw * 4 - 8,
          y1: yf,
          y2: yf,
          stroke: "var(--test)",
          "stroke-width": 2,
          "stroke-dasharray": "5 4",
        },
        layers[3],
      );
    }
    if (b.scored) {
      const top = rec(b.answers.Q_any.winner_rid);
      if (!m.kept.has(top.rid)) {
        const yt = sc.y(top.value);
        el(
          "circle",
          {
            cx: x5 - (r + 6),
            cy: yt,
            r: r + 1,
            fill: "none",
            stroke: sideOf(top) < 0 ? "var(--other)" : "var(--ink)",
            "stroke-width": 2,
          },
          layers[4],
        );
        if (!phone) {
          const tt = tx(layers[4], x5 - (r + 16), yt + 5, "top " + val(top.value), {
            "font-size": small,
            "text-anchor": "end",
            class: "mono",
            fill: sideOf(top) < 0 ? "var(--other-text)" : "var(--ink)",
          });
          const dg = el("tspan", { class: "paper", dx: 3 }, tt);
          dg.textContent = sideOf(top) === 0 ? "?" : "†";
        }
      }
    }
    // static marks per column (the resting picture)
    const statics = [{}, {}, {}, {}, {}];
    b.records.forEach((q) => {
      pos[q.rid].forEach((p, k) => {
        if (!p) return;
        const held = k === 3 && !m.kept.has(q.rid);
        const e = drawMark(layers[k], { r: q, x: p.x, y: p.y, s: k === 0 ? 0 : p.s }, r, {
          tick: dn.tick,
          held,
          win: k === 4 && m.winners.has(q.rid),
        });
        if (k === 0) {
          e.setAttribute("fill", "var(--page)");
          e.setAttribute("stroke", "var(--ink)");
        }
        statics[k][q.rid] = e;
      });
    });
    const pipeShort = "<b>Fig. 2.</b> Every record goes through five checks. A cross marks where one drops out.";
    $("pipeCap").innerHTML =
      "<b>Fig. 2.</b> " +
      m.counts[0] +
      ", ruled by value through five stages. " +
      (m.kept.size
        ? nRec(m.kept.size) +
          (m.kept.size === 1 ? " reaches" : " reach") +
          " the bottom of the rule. The rest stop at a cross. "
        : "Nothing reaches the answer. ") +
      (b.scored && !m.kept.has(b.answers.Q_any.winner_rid)
        ? (b.scored && S.tmpl === "Q_official" && b.answers.Q_official.status === "robust"
            ? "A dashed green line carries the answer’s value across stage 4. "
            : "") +
          (!m.winners.size
            ? "The top value is drawn beside the empty final rule as a hollow ring: nothing reached the answer."
            : "The top value is drawn beside the final rule as a hollow ring: it sits " +
              (isBetter(
                rec(b.answers.Q_any.winner_rid).value,
                m.winners.size ? rec([...m.winners][0]).value : 0,
                b.direction,
              )
                ? "above"
                : "below") +
              " the answer, on the wrong side.")
        : "");
    renderStageBar(m, names);
    $("stageLine").innerHTML =
      "<span class='lab'>Select a stage to see its records:</span>" +
      names
        .map(
          (nm, i) =>
            "<button type='button' class='lk" +
            (i === S.stage ? " on" : "") +
            "' data-action='stage' data-s='" +
            i +
            "'>" +
            (i + 1) +
            " " +
            nm +
            "</button>",
        )
        .join("") +
      " <button type='button' class='lk replay' data-action='replay'>↻ replay</button>";
    shortCap("pipeCap", pipeShort, $("pipeCap").innerHTML);
    S.flow = { pos, statics, svg, r, stagesY: [y0, y1], m, layers };
    if (S.reduced || (S.present && S.beat < 3)) S.flowDone = true;
    else if (S.present) runFlow();
    else flowWhenSeen(svg);
    renderPeek();
  }
  /* the stage bar: five cells over the five columns. A newcomer reads one plain line per stage; anyone can open a
     stage to see every record it holds, in a panel right under the figure, so the picture never leaves the screen */
  function renderStageBar(m, names) {
    const sb = $("stageBar");
    sb.innerHTML =
      names
        .map(
          (nm, i) =>
            "<button type='button' class='stg" +
            (i === S.stage ? " on" : "") +
            (i === 4 ? " fin" : "") +
            "' data-action='stage' data-s='" +
            i +
            "' aria-pressed='" +
            (i === S.stage) +
            "' aria-controls='peek'><span class='stg-h'><span class='stg-n'>" +
            (i + 1) +
            "</span>" +
            esc(nm) +
            "</span><span class='stg-d'>" +
            esc(m.descs[i]) +
            "</span><span class='stg-c'>" +
            esc(m.counts[i]) +
            "</span></button>",
        )
        .join("") +
      "<button type='button' class='stg-replay' data-action='replay' title='Run the five stages again'>↻ replay</button>";
  }
  // a stage-3 label: the split's name over its record count, both centred under the rule (no diagonal staircase)
  function stackLab(layer, x, y, lines, fs, room) {
    const fit = Math.max(4, Math.floor((room * 1.7 - 10) / (fs * 0.6))); // neighbours are short ("test", "no split"), so a label may borrow some of their width; the overlap check guards this
    const t = tx(layer, x, y, "", { "font-size": fs, "text-anchor": "middle", class: "mono", fill: "var(--mute)" });
    lines.forEach((ln, i) => {
      const ts = el("tspan", { x, dy: i ? fs + 3 : 0 }, t);
      ts.textContent = i === 0 && ln.length > fit ? ln.slice(0, fit - 1) + "…" : ln;
      if (i) ts.setAttribute("fill", "var(--ink)");
    });
  }
  // two short lines per stage for the phone pipeline, each fitted to its column
  function phoneCount(m, i, fit) {
    const b = S.board,
      two = (t) => wrapWords(t, fit, 2);
    if (i === 0) return [String(m.n), "records"];
    if (i === 1) return [String(m.tagged), "tagged"];
    if (i === 2) {
      const c = b.clusters.length;
      return [c + (c === 1 ? " setup" : " setups"), m.un ? m.un + " unknown" : ""];
    }
    if (i === 3) return two(m.kcount);
    if (m.outRec) {
      const nm = methodName(m.outRec);
      return [val(m.outRec.value), nm.length > fit ? nm.slice(0, fit - 1) + "…" : nm];
    }
    return two(m.out);
  }
  function heldReason(rids) {
    const r = rec(rids[0]);
    if (S.tmpl === "Q_official")
      return r.proto.split == null
        ? "split not recorded"
        : r.proto.split !== "test"
          ? "not test split"
          : "no matching peer";
    return r.proto.split == null ? "unknown setup" : "no matching peer";
  }

  /* the run: one pass, left to right. Each mark walks the five rulers; it leaves its resting copy behind
     as it departs a column, so every column fills in order and nothing is drawn twice. */
  // the run starts when the figure is on screen, not while it sits below the fold
  function flowWhenSeen(svg) {
    if (S.flowIO) S.flowIO.disconnect();
    if (!("IntersectionObserver" in window)) return runFlow();
    svg.classList.add("pending");
    S.flowIO = new IntersectionObserver(
      (es) => {
        if (!es[0].isIntersecting) return;
        S.flowIO.disconnect();
        svg.classList.remove("pending");
        if (!handoff()) runFlow();
      },
      // with a handoff to come, start as Fig. 2 enters, while Fig. 1 is still in sight
      { threshold: S.handed === S.board || S.reduced ? 0.35 : 0.02 },
    );
    S.flowIO.observe(svg);
  }
  /* the handoff: when Fig. 2 comes into view, the marks of Fig. 1 travel down into its first column and lose their
     colour as they land, because at step 1 no split has been read yet. Then the five-stage run starts from there.
     Both ends are tracked every frame, relative to their own figures, so the flight stays true while the reader
     scrolls. Once per leaderboard; never with reduced motion or on a slide. */
  const HAND = 1100;
  function handoff() {
    const F = S.flow;
    if (!F || S.reduced || S.present || S.handed === S.board) return false;
    const heroSvg = document.querySelector("#hero svg");
    if (!heroSvg) return false;
    const hs = heroSvg.getBoundingClientRect(),
      ps = F.svg.getBoundingClientRect();
    if (!hs.width || !ps.width) return false;
    const marks = [...heroSvg.querySelectorAll(".mk[data-rid]")].filter((e) => F.statics[0][e.dataset.rid]);
    if (!marks.length) return false;
    S.handed = S.board;
    const board = S.board,
      every = Math.max(1, Math.ceil(marks.length / 120)),
      stagger = Math.min(14, 420 / marks.length),
      wait = Math.max(0, (S.heroAt || 0) + 2300 - performance.now()); // let Fig. 1 finish its own entrance first
    const centre = (e, box) => {
      const r = e.getBoundingClientRect();
      return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top];
    };
    const lay = document.createElement("div");
    lay.className = "handoff";
    lay.setAttribute("aria-hidden", "true");
    document.body.appendChild(lay);
    const items = marks
      .filter((e, i) => i % every === 0)
      .map((e, i) => {
        const dst = F.statics[0][e.dataset.rid],
          fill = e.getAttribute("fill"),
          hollow = !fill || fill === "none" || fill === "var(--page)",
          d = document.createElement("i");
        if (hollow) d.className = "raw";
        else d.style.background = fill;
        lay.appendChild(d);
        return { a: centre(e, hs), b: centre(dst, ps), d, delay: i * stagger, raw: hollow };
      });
    const total = HAND + items[items.length - 1].delay;
    runFlow(wait + total - 80);
    const mv = F.svg.querySelector(".movers");
    if (mv) mv.style.opacity = 0;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    let t0 = null;
    const end = () => {
      lay.remove();
      if (mv) mv.style.opacity = "";
    };
    const frame = (now) => {
      if (S.board !== board || !lay.isConnected) return end();
      if (t0 === null) t0 = now + wait;
      const t = now - t0,
        H = heroSvg.getBoundingClientRect(),
        P = F.svg.getBoundingClientRect();
      items.forEach((it) => {
        const p = Math.min(1, Math.max(0, (t - it.delay) / HAND)),
          k = ease(p),
          x = H.left + it.a[0] + (P.left + it.b[0] - H.left - it.a[0]) * k,
          y = H.top + it.a[1] + (P.top + it.b[1] - H.top - it.a[1]) * k;
        it.d.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)";
        it.d.style.opacity = p <= 0 || p >= 1 ? 0 : 1;
        if (!it.raw && p > 0.72) {
          it.raw = true;
          it.d.classList.add("raw");
        }
      });
      if (t >= total) return end();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return true;
  }
  // delay: the run is primed at once (empty columns, marks waiting at stage 1) and starts moving after `delay` ms
  function runFlow(delay) {
    const F = S.flow;
    if (!F) return;
    cancelAnimationFrame(S.raf);
    const b = S.board,
      m = F.m,
      svg = F.svg,
      r = F.r;
    const old = svg.querySelector(".movers");
    if (old) old.remove();
    const movers = el("g", { class: "movers" }, svg);
    F.statics.forEach((col) =>
      Object.values(col).forEach((e) => {
        e.style.transition = "none";
        e.style.opacity = 0;
      }),
    );
    const decor = F.layers.map((L) => [...L.children].filter((c) => !c.classList.contains("mk")));
    decor.forEach((d, k) => {
      if (k)
        d.forEach((e) => {
          e.style.transition = "none";
          e.style.opacity = 0;
        });
    });
    const decorShown = [true, false, false, false, false];
    // records leave in value order, best first, so the run reads top-down; on big boards only a sample of 120
    // travels (the rest appear in place as each column fills), which keeps the run smooth
    const order = ranked(b.records.map((q) => q.rid)).map((q) => q.rid),
      rank = new Map(order.map((rid, i) => [rid, i])),
      n = order.length,
      every = Math.max(1, Math.ceil(n / 120));
    const items = b.records.map((q) => {
      const P = F.pos[q.rid];
      const last = P[4] ? 4 : 3;
      const k = rank.get(q.rid);
      const e =
        k % every === 0
          ? el(
              "circle",
              { r: r, cx: 0, cy: 0, fill: "var(--page)", stroke: "var(--ink)", "stroke-width": 1.5, class: "mover" },
              movers,
            )
          : null;
      return { q, P, last, e, phase: n > 1 ? k / (n - 1) : 0, shown: -1, col: -1, gone: false };
    });
    // on a projector the speaker narrates, so the run is brisker (about 2 s instead of 4)
    const STAGE = S.present ? 280 : 700,
      HOLD = S.present ? 80 : 240,
      SEG = STAGE + HOLD,
      SPREAD = S.present ? 160 : 260;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    let t0 = null;
    S.flowDone = false;
    const frame = (now) => {
      if (!t0) t0 = now + (delay || 0);
      const el2 = now - t0;
      let allDone = true;
      items.forEach((it) => {
        const local = el2 - it.phase * SPREAD;
        const seg = local < 0 ? -1 : Math.floor(local / SEG);
        const depart = local < 0 ? -1 : seg > it.last ? it.last : seg === it.last ? it.last - 1 : seg;
        while (it.shown < depart) {
          it.shown++;
          const s = F.statics[it.shown][it.q.rid];
          if (s) {
            s.style.transition = "opacity .35s";
            s.style.opacity = "";
          }
        }
        const arrived = local < 0 ? 0 : Math.min(it.last, seg + (local - seg * SEG >= STAGE ? 1 : 0));
        for (let k = 1; k <= arrived; k++)
          if (!decorShown[k]) {
            decorShown[k] = true;
            decor[k].forEach((e) => {
              e.style.transition = "opacity .45s";
              e.style.opacity = "";
            });
          }
        if (seg > it.last) {
          if (it.e && !it.gone) {
            it.gone = true;
            it.e.style.display = "none";
          }
          return;
        }
        allDone = false;
        if (!it.e) return;
        let x, y, col;
        if (local < 0) {
          const p = it.P[0];
          x = p.x;
          y = p.y;
          col = 0;
        } else {
          const k = Math.min(seg, it.last),
            within = local - seg * SEG;
          const a = it.P[k],
            c = it.P[Math.min(k + 1, it.last)];
          const f = k >= it.last ? 1 : Math.min(1, within / STAGE);
          // an orthogonal path: across to the next rule first, then down or up to its place there
          x = a.x + (c.x - a.x) * ease(Math.min(1, f / 0.7));
          y = a.y + (c.y - a.y) * ease(Math.max(0, (f - 0.3) / 0.7));
          col = f >= 1 ? Math.min(k + 1, it.last) : k;
        }
        it.e.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
        if (col !== it.col) {
          // colour and fading change only when a mark reaches a new column
          it.col = col;
          const s = col >= 1 ? sideOf(it.q) : 0;
          it.e.setAttribute("fill", s === 0 ? "var(--page)" : hueOf(it.q));
          it.e.setAttribute("stroke", s === 0 ? "var(--ink)" : "none");
          it.e.setAttribute("opacity", col === 3 && !m.kept.has(it.q.rid) ? 0.5 : 1);
        }
      });
      if (allDone) {
        decor.forEach((d) =>
          d.forEach((e) => {
            e.style.opacity = "";
          }),
        );
        movers.remove();
        F.statics.forEach((col) =>
          Object.values(col).forEach((e) => {
            e.style.opacity = "";
          }),
        );
        S.flowDone = true;
        return;
      }
      S.raf = requestAnimationFrame(frame);
    };
    S.raf = requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ stage panel
  const btTable = (head, rows, cls) =>
    "<div class='tbl " +
    (cls || "") +
    "'><table class='bt'><thead><tr>" +
    head +
    "</tr></thead><tbody>" +
    rows +
    "</tbody></table></div>";
  function leftOut() {
    const b = S.board,
      A = b.answers,
      kept = new Set(),
      why = new Map();
    if (!b.scored) {
      b.records.forEach((r) => why.set(r.rid, "no question applied"));
      return { kept, why };
    }
    if (S.tmpl === "Q_official") {
      A.Q_official.sets.forEach((s) => s.rids.forEach((i) => kept.add(i)));
      b.records.forEach((r) => {
        if (!kept.has(r.rid))
          why.set(
            r.rid,
            r.proto.split == null
              ? "no split identified in the extracted record"
              : r.proto.split !== "test"
                ? "on the " + splitWord(r.proto)
                : "test split, but no other record shares its metric name and unit",
          );
      });
    } else if (S.tmpl === "Q_trend") {
      A.Q_trend.years.forEach((y) => y.sets.forEach((s) => s.rids.forEach((i) => kept.add(i))));
      b.records.forEach((r) => {
        if (!kept.has(r.rid))
          why.set(r.rid, r.cluster == null ? "unknown setup" : "no other record with the same setup and preprint year");
      });
    } else {
      A.Q_threshold.groups.forEach((g) => g.rids.forEach((i) => kept.add(i)));
      b.records.forEach((r) => {
        if (!kept.has(r.rid))
          why.set(r.rid, r.cluster == null ? "unknown setup" : "in a group where the test-set leader has no rival");
      });
    }
    return { kept, why };
  }
  // the figure and the opened stage share the screen: if either is cut off, bring the bar to the top
  function keepStageInView() {
    if (S.present) return;
    requestAnimationFrame(() => {
      const top = $("process").getBoundingClientRect().top,
        bot = $("peek").getBoundingClientRect().bottom;
      if (top < 0 || bot > window.innerHeight)
        window.scrollTo({ top: window.scrollY + top - 12, behavior: S.reduced ? "auto" : "smooth" });
    });
  }
  function renderPeek() {
    const peek = $("peek");
    // the chosen stage's column stays lit; the others step back
    if (S.flow) S.flow.layers.forEach((L, k) => (L.style.opacity = S.stage < 0 || k === S.stage ? "" : 0.22));
    $("process").classList.toggle("staged", S.stage >= 0); // the caption steps aside so the records sit right under the figure
    $("process").style.setProperty("--stage", S.stage < 0 ? 0 : S.stage); // where the drawer's tab joins the figure
    document.querySelectorAll("#pipe .colhit").forEach((r) => r.classList.toggle("on", +r.dataset.s === S.stage));
    peek.hidden = S.stage < 0;
    if (S.stage < 0) {
      peek.innerHTML = "";
      return;
    }
    const b = S.board,
      i = S.stage,
      n = b.records.length,
      m = pipeModel();
    const head = (io) =>
      "<h4>Stage " +
      (i + 1) +
      " · " +
      ["Extract", "Tag setup", "Group", "Apply question", "Pick"][i] +
      " <span class='muted'>— " +
      esc(m.descs[i]) +
      ". " +
      io +
      "</span><button type='button' class='peek-x' data-action='stage' data-s='" +
      i +
      "' aria-label='Close this step'>×</button></h4>";
    const row = (r) =>
      "<tr data-hl='" + r.rid + "'><td>" + esc(methodName(r)) + "</td><td class='num'>" + val(r.value) + "</td>";
    let html;
    if (i === 0)
      html =
        head("Input: source papers → output: " + n + " result records") +
        btTable(
          "<th>Method</th><th class='num'>Value</th><th>Source</th><th><span class='vh'>Report an error</span></th>",
          ranked(b.records.map((r) => r.rid))
            .map(
              (r) =>
                row(r) +
                "<td class='m'>" +
                paperLink(r) +
                " · " +
                pointer(r.source_location) +
                (auditBadge(r) ? " · " + auditBadge(r) : "") +
                "</td><td>" +
                reportLink(r) +
                "</td></tr>",
            )
            .join(""),
          "tall",
        );
    else if (i === 1)
      html =
        head("Input: " + nRec(n) + " → output: split, metric name and unit, where recorded") +
        btTable(
          "<th>Method</th><th class='num'>Value</th><th>Split</th><th>Metric name</th><th>Unit</th>",
          ranked(b.records.map((r) => r.rid))
            .map((r) => {
              const c = (v) => (v == null ? "<i class='muted'>not recorded</i>" : esc(v));
              return (
                row(r) +
                "<td>" +
                c(r.proto.split) +
                "</td><td>" +
                c(r.proto.metric_surface) +
                "</td><td>" +
                c(r.proto.unit) +
                "</td></tr>"
              );
            })
            .join(""),
          "tall",
        );
    else if (i === 2) {
      // every record, one small table per group, so a reviewer can see exactly who sits with whom
      const grp = (label, rids) =>
        "<p class='note'>" +
        label +
        " · " +
        rids.length +
        (rids.length === 1 ? " record" : " records") +
        "</p>" +
        btTable(
          "<th>Method</th><th class='num'>Value</th><th>Source</th>",
          ranked(rids)
            .map((r) => row(r) + "<td class='m'>" + paperLink(r) + " · " + pointer(r.source_location) + "</td></tr>")
            .join(""),
        );
      html =
        head(
          "Input: " +
            nRec(n) +
            " → output: " +
            b.clusters.length +
            (b.clusters.length === 1 ? " group" : " groups") +
            (b.unknown_rids.length ? " + " + b.unknown_rids.length + " of unknown setup" : ""),
        ) +
        b.clusters.map((c) => grp(setupLine(c.protocol), c.rids)).join("") +
        (b.unknown_rids.length
          ? grp("unknown setup: stands alone, so it can be compared with nothing", b.unknown_rids)
          : "");
    } else if (i === 3) {
      const { kept, why } = leftOut();
      const A = b.answers;
      let keptHtml = "";
      if (b.scored && S.tmpl === "Q_official")
        keptHtml = A.Q_official.sets.length
          ? A.Q_official.sets
              .map(
                (s) =>
                  "<li><b>" +
                  setupLine(Object.assign({ split: "test" }, s.key)) +
                  "</b>: " +
                  s.rids.length +
                  (s.rids.length === 1 ? " record" : " records") +
                  "</li>",
              )
              .join("")
          : "<li>No group holds two records, so 0 are kept.</li>";
      else if (b.scored && S.tmpl === "Q_trend")
        keptHtml = A.Q_trend.years.length
          ? A.Q_trend.years
              .map(
                (y) =>
                  "<li><b>" +
                  y.year +
                  "</b>: " +
                  y.sets.map((s) => setupLine(s.key) + " (" + s.rids.length + ")").join("; ") +
                  "</li>",
              )
              .join("")
          : "<li>No year: 0 kept. " + esc(plainTerms(A.Q_trend.reason)) + "</li>";
      else if (b.scored)
        keptHtml = A.Q_threshold.groups.length
          ? A.Q_threshold.groups
              .map(
                (g) =>
                  "<li><b>" +
                  setupLine(g.key) +
                  "</b>: " +
                  g.rids.length +
                  (g.rids.length === 1 ? " record" : " records") +
                  "</li>",
              )
              .join("")
          : "<li>No group tested. " + esc(plainTerms(A.Q_threshold.reason)) + "</li>";
      html =
        head("Input: " + nRec(n) + " → output: " + kept.size + " kept") +
        (keptHtml ? "<p class='note'>Kept</p><ul class='minilist'>" + keptHtml + "</ul>" : "") +
        (kept.size
          ? btTable(
              "<th>Method</th><th class='num'>Value</th><th>Setup</th>",
              ranked([...kept])
                .map((r) => row(r) + "<td>" + setupLine(r.proto) + "</td></tr>")
                .join(""),
            )
          : "") +
        (why.size
          ? "<p class='note'>Left out (" +
            why.size +
            ")</p>" +
            btTable(
              "<th>Method</th><th class='num'>Value</th><th>Why</th>",
              ranked([...why.keys()])
                .map((r) => row(r) + "<td>" + esc(why.get(r.rid)) + "</td></tr>")
                .join(""),
              "tall",
            )
          : "");
    } else {
      let body;
      const A = b.answers;
      if (!b.scored) body = "<p>There is nothing to pick.</p>";
      else if (S.tmpl === "Q_official") {
        const o = A.Q_official;
        body =
          o.status === "robust"
            ? "<p>Best kept record: <b>" +
              esc(methodName(rec(o.winner_rid))) +
              " " +
              val(rec(o.winner_rid).value) +
              "</b> (" +
              setupLine(rec(o.winner_rid).proto) +
              ").</p>"
            : o.status === "conditional"
              ? "<ul class='minilist'>" +
                o.sets
                  .map((s) => {
                    const w = rec(s.winner_rid);
                    return (
                      "<li>" +
                      setupLine(s.key.split ? s.key : Object.assign({ split: "test" }, s.key)) +
                      ": <b>" +
                      esc(methodName(w)) +
                      " " +
                      val(w.value) +
                      "</b></li>"
                    );
                  })
                  .join("") +
                "</ul>"
              : "<p><b>No fair comparison possible.</b> No group holds two comparable records, so nothing is picked.</p>";
      } else if (S.tmpl === "Q_trend") {
        const tr = A.Q_trend;
        body = tr.years.length
          ? "<ul class='minilist'>" +
            tr.years
              .map(
                (y) =>
                  "<li><b>" +
                  y.year +
                  "</b>: " +
                  y.sets
                    .map((s) => {
                      const w = rec(s.winner_rid);
                      return esc(methodName(w)) + " " + val(w.value) + " (" + esc(splitWord(w.proto)) + ")";
                    })
                    .join("; ") +
                  (y.agree ? "" : " <i class='muted'>groups disagree</i>") +
                  "</li>",
              )
              .join("") +
            "</ul>"
          : "<p><b>No fair comparison possible.</b> " + esc(plainTerms(tr.reason)) + "</p>";
      } else {
        const q = A.Q_threshold;
        body =
          q.status === "insufficient" || q.champion_rid == null
            ? "<p><b>No fair comparison possible.</b> " + esc(plainTerms(q.reason)) + "</p>"
            : "<p>Leader: <b>" +
              esc(methodName(rec(q.champion_rid))) +
              " " +
              val(rec(q.champion_rid).value) +
              "</b>; bar: " +
              val(q.tau) +
              " (" +
              esc(methodName(rec(q.tau_rid))) +
              ").</p><ul class='minilist'>" +
              q.groups
                .map(
                  (g) =>
                    "<li>" +
                    setupLine(g.key) +
                    ": " +
                    val(rec(g.champion_rid).value) +
                    " → " +
                    (g.clears
                      ? "<span class='audit-ok'>beats the bar</span>"
                      : "<span class='audit-bad'>does not beat the bar</span>") +
                    "</li>",
                )
                .join("") +
              "</ul>";
      }
      const { kept: k5 } = leftOut(),
        winners = pipeModel().winners;
      html =
        head("Input: kept records → output: the answer") +
        body +
        (k5.size
          ? btTable(
              "<th>Method</th><th class='num'>Value</th><th><span class='vh'>Picked</span></th>",
              ranked([...k5])
                .map((r) => row(r) + "<td>" + (winners.has(r.rid) ? "<b class='tt'>← picked</b>" : "") + "</td></tr>")
                .join(""),
            )
          : "");
    }
    // the title stays put as a header; only the records under it scroll
    peek.innerHTML = html;
    const h4 = peek.querySelector("h4");
    if (h4) {
      const body = document.createElement("div");
      body.className = "peek-body";
      while (h4.nextSibling) body.appendChild(h4.nextSibling);
      peek.appendChild(body);
    }
  }

  // ------------------------------------------------------------------ §1 groups (stage 3 at full size) + table
  function selectedClusters() {
    const A = S.board.answers;
    if (!A) return new Set();
    const sel = new Set();
    const add = (rids) => {
      const r = rec(rids[0]);
      if (r.cluster != null) sel.add(r.cluster);
    };
    if (S.tmpl === "Q_official") A.Q_official.sets.forEach((s) => add(s.rids));
    if (S.tmpl === "Q_threshold" && A.Q_threshold.reference_set) add(A.Q_threshold.reference_set.rids);
    return sel;
  }
  function renderGroups() {
    const host = $("groups");
    host.innerHTML = "";
    const b = S.board,
      sel = selectedClusters();
    const phone = window.matchMedia("(max-width: 760px)").matches;
    const cols = b.clusters
      .map((c, i) => ({ i, rids: c.rids, p: c.protocol }))
      .sort((a, c) => c.rids.length - a.rids.length);
    if (b.unknown_rids.length) cols.push({ i: -1, rids: b.unknown_rids, p: null });
    const W = 1248,
      tot = b.records.length,
      minW = 110,
      H = phone ? 320 : Math.min(620, 320 + b.records.length),
      y0 = 40,
      y1 = H - 56;
    let widths = cols.map((c) => Math.max(minW, ((W - 80) * c.rids.length) / tot));
    const k = (W - 80) / widths.reduce((a, w) => a + w, 0);
    widths = widths.map((w) => w * Math.min(1, k));
    const svg = el(
      "svg",
      { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "All records grouped by setup" },
      host,
    );
    const g = el("g", {}, svg);
    const sc = scale(
      b.records.map((q) => q.value),
      y0,
      y1,
      b.direction,
    );
    const naive = b.answers ? b.answers.Q_any.winner_rid : null,
      qual = b.answers && S.tmpl === "Q_official" ? b.answers.Q_official.winner_rid : null;
    let x = 40;
    cols.forEach((c, ci) => {
      const w = widths[ci],
        cx = x + w / 2;
      rule(g, cx, y0 - 10, y1, c.i < 0 ? "2 5" : null);
      const isSel = sel.has(c.i);
      if (isSel)
        el("line", { x1: cx - 16, x2: cx + 16, y1, y2: y1, stroke: "var(--ink)", "stroke-width": "var(--foot)" }, g);
      const list = c.rids.map(rec);
      const dnl = density(list.length);
      const lay = layout(list, cx, sc, dnl.r, Math.max(2, Math.floor(w / (2 * dnl.r + 2) / 2)), 6);
      lay.forEach((p) => {
        const e = drawMark(g, p, dnl.r, {
          tick: dnl.tick,
          circle: p.r.rid === naive || p.r.rid === qual || p.r.rid === c.rids[0],
          win: p.r.rid === qual || p.r.rid === naive,
        });
        e.classList.add("pick");
        if (S.picks.includes(p.r.rid)) e.classList.add("on");
      });
      const best = ranked(c.rids)[0];
      const bp = lay.find((p) => p.r.rid === best.rid);
      const near = lay.filter((p) => Math.abs(p.y - bp.y) < dnl.r * 2 + 8);
      const xR = Math.max(...near.map((p) => p.x)),
        xL = Math.min(...near.map((p) => p.x));
      const toRight = bp.s >= 0 ? xR < W - 220 : xL < 220;
      tx(g, toRight ? xR + dnl.r + 10 : xL - dnl.r - 10, bp.y + 5, shortMethod(best, 30) + " " + val(best.value), {
        "font-size": 13,
        "text-anchor": toRight ? "start" : "end",
        class: "mono",
      });
      tx(g, cx, y1 + 20, (c.i < 0 ? "split not recorded" : setupLine(c.p)) + " · " + c.rids.length, {
        "font-size": 13,
        "text-anchor": "middle",
        class: "mono",
        fill: "var(--mute)",
      });
      if (isSel)
        tx(g, cx, y1 + 38, "used by this question", {
          "font-size": 13,
          "text-anchor": "middle",
          class: "it",
          fill: "var(--test-text)",
        });
      x += w;
    });
    // tables beneath
    const LIM = 10;
    const trow = (r, i) =>
      "<tr class='pick" +
      (S.picks.includes(r.rid) ? " chosen" : "") +
      "' data-rid='" +
      r.rid +
      "' tabindex='0'><td class='num'>" +
      (i == null ? "" : i + 1) +
      "</td><td>" +
      esc(methodName(r)) +
      (r.rid === naive ? "<span class='mark'>top</span>" : "") +
      (r.rid === qual ? "<span class='mark'>fair</span>" : "") +
      "</td><td class='num'>" +
      val(r.value) +
      "</td><td class='m'>" +
      paperLink(r) +
      " · " +
      pointer(r.source_location) +
      (auditBadge(r) ? " · " + auditBadge(r) : "") +
      "</td><td>" +
      reportLink(r) +
      "</td></tr>";
    const table = (rs, numbered, id) => {
      const open = S.open[id],
        shown = open ? rs : rs.slice(0, LIM);
      return (
        btTable(
          "<th class='num'>#</th><th>Method</th><th class='num'>Value</th><th>Source</th><th><span class='vh'>Report an error</span></th>",
          shown.map((r, i) => trow(r, numbered ? i : null)).join(""),
        ) +
        (rs.length > LIM
          ? "<p class='line'><button type='button' class='lk' data-action='more' data-open='" +
            id +
            "'>" +
            (open ? "Show fewer" : "Show all " + rs.length) +
            "</button></p>"
          : "")
      );
    };
    let html =
      "<p class='note'>" +
      dirWord().replace(/^./, (c) => c.toUpperCase()) +
      "." +
      (S.picks.length === 1 ? " One record picked; pick another." : "") +
      "</p>";
    b.clusters.forEach((c, i) => {
      html +=
        "<p class='line'><i>" +
        setupLine(c.protocol) +
        "</i>" +
        (i === b.principal_cluster ? "<span class='mark'>largest comparable group</span>" : "") +
        (sel.has(i) ? "<span class='mark audit-ok'>used by this question</span>" : "") +
        "</p>" +
        table(ranked(c.rids), true, "c" + i);
    });
    if (b.unknown_rids.length)
      html +=
        "<p class='line'><i>Unknown setup: flagged, not ranked</i> <span class='mark'>split, metric name or unit not all recorded</span></p>" +
        table(ranked(b.unknown_rids), false, "u");
    $("boardBody").innerHTML = html;
    $("boardSummary").innerHTML =
      "§1 All " +
      b.records.length +
      " records, grouped by setup <small>Pick any two marks or rows to see whether they can be compared, and why.</small>";
  }

  // ------------------------------------------------------------------ §2 the ladder (comparability determination)
  function certFor(a, b) {
    const C = S.board.certificates;
    if (C[a + "-" + b]) return { c: C[a + "-" + b], l: a, r: b };
    if (C[b + "-" + a]) return { c: C[b + "-" + a], l: b, r: a };
    return null;
  }
  function missingReason(a, b) {
    const ra = rec(a),
      rb = rec(b),
      scope = new Set(S.board.certificate_scope_rids);
    if (ra.cluster == null || rb.cluster == null)
      return "One of the two result records has an unknown setup: its split, metric name or unit is not all recorded. Such records get no comparability determination.";
    if (!S.board.multi_cluster)
      return "This leaderboard has a single setup group. Comparability determinations cover only leaderboards with two or more groups.";
    if (!scope.has(a) || !scope.has(b))
      return "At least one record is outside the released set: comparability determinations cover the top 10 records of each leaderboard with two or more groups.";
    return "No comparability determination is stored for this pair.";
  }
  function certSlots() {
    const A = S.board.answers,
      t = S.tmpl,
      slots = [];
    if (!A) return S.picks.length === 2 ? [{ title: "Your selected pair", a: S.picks[0], b: S.picks[1] }] : [];
    const naive = A.Q_any.winner_rid;
    const runnerUp = (rids, w) => {
      const r = ranked(rids).find((x) => x.rid !== w);
      return r ? r.rid : null;
    };
    if (t === "Q_official" && A.Q_official.status === "robust") {
      const o = A.Q_official,
        w = o.winner_rid;
      if (rec(w).method !== rec(naive).method)
        slots.push({ title: "Fair answer vs the leaderboard's top number", a: w, b: naive });
      const ru = runnerUp(o.sets[0].rids, w);
      if (ru != null) slots.push({ title: "Fair answer vs the next record", a: w, b: ru });
    } else if (t === "Q_official" && A.Q_official.status === "conditional") {
      const s = A.Q_official.sets;
      for (let i = 1; i < s.length; i++)
        slots.push({ title: "Set 1 winner vs set " + (i + 1) + " winner", a: s[0].winner_rid, b: s[i].winner_rid });
    } else if (t === "Q_threshold" && A.Q_threshold.champion_rid != null) {
      const q = A.Q_threshold;
      slots.push({ title: "Test-set leader vs the bar", a: q.champion_rid, b: q.tau_rid });
      q.groups.forEach((g, i) => {
        if (g.champion_rid !== q.champion_rid)
          slots.push({
            title: "Test-set leader vs its record in group " + (i + 1),
            a: q.champion_rid,
            b: g.champion_rid,
          });
      });
      if (rec(q.champion_rid).method !== rec(naive).method)
        slots.push({ title: "Test-set leader vs the leaderboard's top number", a: q.champion_rid, b: naive });
    } else if (t === "Q_trend" && A.Q_trend.status !== "insufficient") {
      const ys = A.Q_trend.years,
        last = ys[ys.length - 1];
      ys.filter((y) => !y.agree).forEach((y) =>
        y.sets.slice(1).forEach((s, i) =>
          slots.push({
            title: y.year + ": set 1 winner vs set " + (i + 2) + " winner",
            a: y.sets[0].winner_rid,
            b: s.winner_rid,
            first: true,
          }),
        ),
      );
      last.sets.forEach((s, i) => {
        const ru = runnerUp(s.rids, s.winner_rid);
        if (ru != null)
          slots.push({
            title: last.year + " winner vs runner-up" + (last.sets.length > 1 ? " (set " + (i + 1) + ")" : ""),
            a: s.winner_rid,
            b: ru,
          });
      });
      if (ys.length > 1)
        slots.push({
          title: ys[0].year + " winner vs " + last.year + " winner",
          a: ys[0].sets[0].winner_rid,
          b: last.sets[0].winner_rid,
        });
    }
    const out = slots.filter((s) => s.a !== s.b);
    const rank = (s) => (s.first ? 2 : 0) + (certFor(s.a, s.b) ? 1 : 0);
    out.sort((x, y) => rank(y) - rank(x));
    if (S.picks.length === 2) out.unshift({ title: "Your selected pair", a: S.picks[0], b: S.picks[1], picked: true });
    return out;
  }
  function renderCert() {
    const slots = certSlots();
    $("certSlots").innerHTML = "";
    $("certBody").innerHTML = "";
    if (!slots.length) {
      $("certBody").innerHTML =
        "<p class='note'>No fair answer, so no comparability determination is attached. Pick any two marks or rows in §1 to see the determination for that pair.</p>";
      return;
    }
    if (S.slot >= slots.length) S.slot = 0;
    $("certSlots").innerHTML =
      "<span class='lab'>Pair:</span>" +
      slots
        .map(
          (s, i) =>
            "<button type='button' class='lk" +
            (i === S.slot ? " on" : "") +
            "' data-action='slot' data-i='" +
            i +
            "'>" +
            esc(s.title) +
            "</button>",
        )
        .join("");
    const s = slots[S.slot],
      hit = certFor(s.a, s.b);
    const L = rec(s.a),
      Rr = rec(s.b);
    // the ladder
    const W = 1248,
      H = 250,
      svg = el("svg", {
        viewBox: "0 0 " + W + " " + H,
        role: "img",
        "aria-label": "Comparability determination drawn as a ladder",
      });
    const g = el("g", {}, svg);
    const xl = 380,
      xr = 870,
      yT = 30,
      yB = 212;
    rule(g, xl, yT, yB);
    rule(g, xr, yT, yB);
    el(
      "circle",
      {
        cx: xl,
        cy: yT,
        r: 7,
        fill: sideOf(L) === 0 ? "var(--page)" : hueOf(L),
        stroke: "var(--ink)",
        "stroke-width": 1.5,
      },
      g,
    );
    el(
      "circle",
      {
        cx: xr,
        cy: yT,
        r: 7,
        fill: sideOf(Rr) === 0 ? "var(--page)" : hueOf(Rr),
        stroke: "var(--ink)",
        "stroke-width": 1.5,
      },
      g,
    );
    tx(g, xl - 16, yT + 6, shortMethod(L, 28) + "  " + val(L.value), { "font-size": 20, "text-anchor": "end" });
    tx(g, xr + 16, yT + 6, shortMethod(Rr, 28) + "  " + val(Rr.value), { "font-size": 20 });
    tx(g, xl - 16, yT + 26, (L.arxiv_id ? "arXiv:" + L.arxiv_id : "no arXiv id") + " · " + pointer(L.source_location), {
      "font-size": 13,
      "text-anchor": "end",
      class: "mono",
      fill: "var(--mute)",
    });
    tx(
      g,
      xr + 16,
      yT + 26,
      (Rr.arxiv_id ? "arXiv:" + Rr.arxiv_id : "no arXiv id") + " · " + pointer(Rr.source_location),
      { "font-size": 13, class: "mono", fill: "var(--mute)" },
    );
    const facets = hit
      ? hit.c.per_facet.map((f) => [
          FACET_PLAIN[f.facet] || f.facet,
          hit.l === s.a ? f.left : f.right,
          hit.l === s.a ? f.right : f.left,
          f.relation,
        ])
      : ["split", "metric_surface", "unit"].map((f) => {
          const a = L.proto[f],
            b2 = Rr.proto[f];
          return [
            FACET_PLAIN[f],
            a,
            b2,
            a == null || b2 == null ? "missing" : a === b2 ? "observed-same" : "observed-different",
          ];
        });
    facets.forEach((f, i) => {
      const y = yT + 56 + i * 50,
        mid = (xl + xr) / 2;
      tx(g, xl + 12, y - 10, f[0] + (f[0] === "metric name" ? " (as written)" : ""), {
        "font-size": 14,
        class: "it",
        fill: "var(--mute)",
      });
      if (f[3] === "observed-same") {
        anim(el("line", { x1: xl, x2: xr, y1: y, y2: y, stroke: "var(--ink)", "stroke-width": 2 }, g), "fade", i * 150);
        tx(g, mid, y + 18, String(f[1]), { "font-size": 14, "text-anchor": "middle", class: "mono" });
      } else if (f[3] === "observed-different") {
        anim(
          el("line", { x1: xl, x2: mid - 40, y1: y, y2: y, stroke: "var(--ink)", "stroke-width": 2 }, g),
          "fade",
          i * 150,
        );
        anim(
          el("line", { x1: mid + 40, x2: xr, y1: y, y2: y, stroke: "var(--ink)", "stroke-width": 2 }, g),
          "fade",
          i * 150,
        );
        el("line", { x1: mid - 40, x2: mid - 40, y1: y - 6, y2: y + 6, stroke: "var(--ink)", "stroke-width": 2 }, g);
        el("line", { x1: mid + 40, x2: mid + 40, y1: y - 6, y2: y + 6, stroke: "var(--ink)", "stroke-width": 2 }, g);
        const hv = (v) => (v === "test" ? "var(--test-text)" : f[0] === "split" ? "var(--other-text)" : "var(--ink)");
        tx(g, mid - 52, y + 22, String(f[1]), { "font-size": 15, "text-anchor": "end", class: "mono", fill: hv(f[1]) });
        tx(g, mid + 52, y + 22, String(f[2]), { "font-size": 15, class: "mono", fill: hv(f[2]) });
        tx(g, mid, y + 5, "≠", { "font-size": 18, "text-anchor": "middle", fill: "var(--red)" });
      } else {
        el(
          "line",
          { x1: xl, x2: xr, y1: y, y2: y, stroke: "var(--mute)", "stroke-width": 2, "stroke-dasharray": "3 6" },
          g,
        );
        tx(g, mid, y + 18, "not recorded", {
          "font-size": 14,
          "text-anchor": "middle",
          class: "mono",
          fill: "var(--mute)",
        });
      }
    });
    const status = hit
      ? hit.c.status
      : facets.some((f) => f[3] === "observed-different")
        ? "incompatible"
        : facets.some((f) => f[3] === "missing")
          ? "no determination stored"
          : "comparable";
    tx(
      g,
      (xl + xr) / 2,
      yB + 26,
      status === "incompatible"
        ? "Not comparable: the records differ on " +
            facets
              .filter((f) => f[3] === "observed-different")
              .map((f) => f[0])
              .join(" and ") +
            "."
        : status === "comparable"
          ? "Comparable: split, metric name and unit all match."
          : "No determination stored: " +
            facets
              .filter((f) => f[3] === "missing")
              .map((f) => f[0])
              .join(", ") +
            " not recorded.",
      { "font-size": 15, "text-anchor": "middle", class: "it" },
    );
    const body = $("certBody");
    body.appendChild(svg);
    const extra = document.createElement("div");
    if (hit) {
      const c = hit.c,
        u = c.uncertainty || {};
      const shared = (S.board.shared_certificate_ids || {})[c.certificate_id];
      extra.innerHTML =
        "<p class='note'>" +
        (auditBadge(L) ? esc(L.method) + ": " + auditBadge(L) + " · " : "") +
        (auditBadge(Rr) ? esc(Rr.method) + ": " + auditBadge(Rr) + " · " : "") +
        reportLink(L, "Submit an erratum for " + shortMethod(L, 20) + " ↗") +
        " · " +
        reportLink(Rr, "for " + shortMethod(Rr, 20) + " ↗") +
        "</p>" +
        "<details class='plain'><summary>Released fields</summary><dl class='kv'><dt>identifier</dt><dd class='m'>" +
        esc(c.certificate_id) +
        (shared
          ? " <i class='muted'>(shared by " +
            shared +
            " determinations in the release; keyed here by board and both records; listed in KNOWN_ISSUES.md)</i>"
          : "") +
        "</dd><dt>query.template</dt><dd><span class='m'>" +
        esc(c.query.template) +
        "</span> (must agree: " +
        esc(c.query.must_agree_facets.map((f) => FACET_PLAIN[f] || f).join(", ")) +
        ")</dd><dt>compatible_dimensions</dt><dd>" +
        (esc(c.compatible_dimensions.map((f) => FACET_PLAIN[f] || f).join(", ")) || "none") +
        "</dd><dt>incompatible_dimensions</dt><dd>" +
        (esc(c.incompatible_dimensions.map((f) => FACET_PLAIN[f] || f).join(", ")) || "none") +
        "</dd><dt>missing_dimensions</dt><dd>" +
        (esc(c.missing_dimensions.map((f) => FACET_PLAIN[f] || f).join(", ")) || "none") +
        "</dd><dt>normalizations_applied</dt><dd>" +
        (c.normalizations_applied.length ? esc(plainTerms(JSON.stringify(c.normalizations_applied))) : "none") +
        "</dd><dt>typed_outcome_rule</dt><dd>" +
        esc(plainTerms(c.typed_outcome_rule)) +
        "</dd><dt>typed_outcome_requires</dt><dd>" +
        esc(plainTerms(c.typed_outcome_requires)) +
        "</dd><dt>implied_status / self_consistent</dt><dd>" +
        esc(c.implied_status) +
        " / " +
        esc(c.self_consistent) +
        "</dd><dt>judge_cause</dt><dd>" +
        (c.judge_cause == null ? "none (decided by fixed rules)" : esc(c.judge_cause)) +
        "</dd><dt>noise band</dt><dd>" +
        (u.beyond_noise == null
          ? "not evaluated for this pair (census pairs only). Rule: " + esc(S.templates.noise_rule.text)
          : (u.beyond_noise ? "beyond noise" : "within noise") +
            " (dispersion: " +
            esc(u.dispersion_source) +
            "). Rule: " +
            esc(S.templates.noise_rule.text)) +
        "</dd><dt>provenance_only</dt><dd>" +
        esc(c.provenance_only) +
        "; evidence_text_redistributed: " +
        esc(c.evidence_text_redistributed) +
        "</dd></dl><details class='plain'><summary>Raw JSON (field names as released)</summary><pre class='json'>" +
        esc(JSON.stringify(c, null, 2)) +
        "</pre></details></details>";
    } else
      extra.innerHTML =
        "<p class='note'>" +
        esc(missingReason(s.a, s.b)) +
        " The three rungs above are read from the two records' stored fields.</p>";
    body.appendChild(extra);
  }

  // ------------------------------------------------------------------ §3 threshold, §4 typed
  function renderThreshold() {
    const b = S.board,
      sec = $("thresholdSection");
    sec.hidden = !b.scored || S.tmpl !== "Q_threshold";
    if (sec.hidden) return;
    const q = b.answers.Q_threshold;
    const name = q.champion_rid != null ? methodName(rec(q.champion_rid)) + "'s" : "the test-set";
    $("thresholdSummary").innerHTML = "§3 Does " + esc(name) + " lead hold under other setups?";
    if (q.champion_rid == null) {
      $("thresholdBody").innerHTML =
        "<p class='note'>No fair comparison possible. " + esc(plainTerms(q.reason)) + "</p>";
      return;
    }
    const c = rec(q.champion_rid),
      tr = rec(q.tau_rid);
    let html =
      "<p class='body'>The test-set leader and the bar (the next test-set record) come from the largest test-set group. The leader must beat the bar in every group where it meets a rival. Leader: <b>" +
      esc(methodName(c)) +
      " " +
      val(c.value) +
      "</b>; bar: " +
      val(q.tau) +
      " (" +
      esc(methodName(tr)) +
      ", " +
      paperLink(tr) +
      ").</p>";
    if (q.status === "insufficient")
      html += "<p class='note'>No fair comparison possible. " + esc(plainTerms(q.reason)) + "</p>";
    else
      html += btTable(
        "<th>Group</th><th class='num'>Leader</th><th>Beats the bar?</th><th class='num'>n</th>",
        q.groups
          .map(
            (g) =>
              "<tr><td>" +
              setupLine(g.key) +
              "</td><td class='num'>" +
              val(rec(g.champion_rid).value) +
              "</td><td>" +
              (g.clears ? "<span class='audit-ok'>yes</span>" : "<span class='audit-bad'>no</span>") +
              "</td><td class='num'>" +
              g.rids.length +
              "</td></tr>",
          )
          .join(""),
      );
    $("thresholdBody").innerHTML = html;
  }
  function renderTyped() {
    const T = S.board.typed_questions || [];
    $("typedSection").hidden = !T.length;
    if (!T.length) return;
    $("typedSummary").innerHTML =
      "§" +
      (S.board.scored && S.tmpl === "Q_threshold" ? 4 : 3) +
      " Typed comparative questions <small>" +
      T.length +
      " question" +
      (T.length === 1 ? "" : "s") +
      " from the paper's development set. Each asks something different from the question above, so its answer can differ.</small>";
    const ANS = {
      invalid_premise: "the question assumes a comparison that does not exist",
      conditional: "the answer depends on the setup",
      robust: "one answer in every setup",
      abstain: "no answer",
    };
    const prov = (p) =>
      p
        .map(
          (x) =>
            esc(shortMethod(x, 30)) +
            " " +
            val(x.value) +
            " (" +
            paperLink(x) +
            ", " +
            pointer(x.source_location) +
            ")",
        )
        .join("; ");
    $("typedBody").innerHTML = T.map(
      (q) =>
        "<div class='typed-item'><p class='tq'>" +
        esc(q.question.replace(/ wer /g, " WER ").replace(/ bleu /g, " BLEU ")) +
        "</p><p class='ta'>" +
        esc(ANS[q.answer_type] || q.answer_type.replace(/_/g, " ")) +
        (q.answer != null ? ": <b>" + esc(q.answer) + "</b>" : "") +
        "</p>" +
        "<details class='plain'><summary>Why, and the records behind it</summary><p class='note'>" +
        esc(
          plainTerms(q.rationale)
            .replace(/\[split=([^|\]]+)\|metric=([^|\]]+)\|unit=([^\]]+)\]/g, "$1 · $2 · $3")
            .replace(/ -> /g, " → "),
        ) +
        "</p>" +
        ((q.conditions || []).length
          ? "<ul class='minilist'>" +
            q.conditions
              .map(
                (c) =>
                  "<li>" +
                  setupLine(c.protocol) +
                  ": " +
                  (c.verdict
                    ? "<b>" + esc(c.verdict) + "</b>"
                    : "leader and every method within its noise band: " + esc((c.winners || []).join(", "))) +
                  "</li>",
              )
              .join("") +
            "</ul>"
          : "") +
        (q.provenance && q.provenance.length ? "<p class='note'>" + prov(q.provenance) + "</p>" : "") +
        "</details></div>",
    ).join("");
  }

  // ------------------------------------------------------------------ erratum
  function renderErratum() {
    const host = $("erratum");
    host.innerHTML = "";
    $("erratumFig").hidden = !S.auditReady; // drawn once the hand-checked records are loaded, just after the first answer
    if (!S.auditReady) return;
    if (!S.auditList || !S.auditList.length) {
      $("erratumFig").hidden = true;
      return;
    }
    const A = S.auditList,
      boards = [];
    A.forEach((a) => {
      if (boards.indexOf(a.board) < 0) boards.push(a.board);
    });
    const phone = window.matchMedia("(max-width: 760px)").matches;
    const stats = { ok: 0, bad: 0, unsure: 0, missing: 0 };
    A.forEach((a) => {
      if (a.verdict === "wrong_split" || a.verdict === "wrong_value") stats.bad++;
      else if (a.verdict === "unsure") stats.unsure++;
      else if (a.verdict === "missing") stats.missing++;
      else stats.ok++;
    });
    $("erratumHead").innerHTML =
      "<i>Erratum.</i> " +
      A.length +
      " displayed records checked against their papers: <b class='red'>" +
      stats.bad +
      " with a wrong label</b>, " +
      stats.ok +
      " confirmed, " +
      stats.missing +
      " incomplete, " +
      stats.unsure +
      " unclear. <span class='muted'>A purposive sample, not an error rate.</span> <a class='m' href='" +
      esc(S.meta.demo_repo_url) +
      "/issues/new?labels=label-error' target='_blank' rel='noopener'>Submit an erratum ↗</a>";
    const n = boards.length,
      perRow = phone ? Math.ceil(n / 3) : n,
      fsE = phone ? 12 : 14,
      tier = 3 * (fsE + 3) + 8, // labels alternate between two tiers, so each full name gets two columns of width
      rowH = phone ? 118 + 16 + tier + 3 * (fsE + 3) + 14 : 0,
      W = phone ? 358 : 1248,
      H = phone ? rowH * Math.ceil(n / perRow) : 176 + 20 + tier + 3 * (fsE + 3) + 6,
      step = W / perRow,
      r = phone ? 3.2 : 5.5;
    const svg = el(
      "svg",
      {
        viewBox: (phone ? "-26 0 " + (W + 52) : "-44 0 " + (W + 88)) + " " + H,
        role: "img",
        "aria-label": "Erratum: " + A.length + " hand-checked records, " + stats.bad + " wrong",
      },
      host,
    );
    const g = el("g", {}, svg);
    boards.forEach((bid, i) => {
      const inRow = Math.min(perRow, n - Math.floor(i / perRow) * perRow),
        x = step * ((i % perRow) + 0.5) + ((perRow - inRow) * step) / 2,
        row0 = Math.floor(i / perRow) * rowH,
        y0 = row0 + (phone ? 12 : 22),
        y1 = row0 + (phone ? 118 : 176);
      const here = bid === S.board.id;
      if (here)
        el(
          "rect",
          {
            x: x - step / 2 + 3,
            y: y0 - 10,
            width: step - 6,
            height: y1 - y0 + 20,
            fill: "var(--hl-o)",
            opacity: 0.5,
            class: "here",
          },
          g,
        );
      rule(g, x, y0, y1);
      const row = S.byId.get(bid);
      const lab = row ? row.dataset : bid;
      {
        const fs = fsE,
          col = i % perRow,
          low = col % 2 === 1,
          fit = Math.max(6, Math.floor((2 * step - 12) / (fs * 0.6 - 0.4))),
          lines = wrapWords(lab.replace(/[-_]/g, (c) => c + " ").replace(/\s+/g, " "), fit, 2),
          ly = y1 + (phone ? 16 : 20) + (low ? tier : 0);
        if (low)
          el("line", { x1: x, x2: x, y1: y1 + 6, y2: ly - fs - 2, stroke: "var(--faint)", "stroke-width": 1 }, g);
        const lt = tx(g, x, ly, "", {
          "font-size": fs,
          "text-anchor": "middle",
          "letter-spacing": "-0.4",
          class: "mono",
          fill: here ? "var(--ink)" : "var(--mute)",
        });
        lines.forEach((ln, li) => {
          const ts = el("tspan", { x, dy: li ? fs + 2 : 0 }, lt);
          ts.textContent = ln.replace(/([-_]) /g, "$1");
        });
        if (row) {
          const ts = el("tspan", { x, dy: fs + 3, class: "paper it" }, lt);
          const mn = metricName(row.metric),
            fitM = Math.floor((2 * step - 12) / (fs * 0.48));
          ts.textContent = mn.length > fitM ? mn.slice(0, fitM - 1) + "…" : mn;
        }
        el("title", {}, lt).textContent = row ? row.dataset + " · " + metricName(row.metric) : bid;
      }
      const rs = A.filter((a) => a.board === bid);
      const vals = rs.map((a) => a.value),
        lo = Math.min(...vals),
        hi = Math.max(...vals);
      const taken = [];
      rs.forEach((a, j) => {
        const t = hi === lo ? 0.5 : (a.value - lo) / (hi - lo);
        let y = y1 - 12 - t * (y1 - y0 - 24);
        const sd = a.split == null ? 0 : a.split === "test" ? 1 : -1;
        let cx = x + sd * (r + 5);
        let k2 = 0;
        while (taken.some((q) => Math.abs(q[0] - cx) < 2 * r && Math.abs(q[1] - y) < 2 * r) && k2 < 6) {
          k2++;
          cx = x + (sd || 1) * (r + 5 + k2 * (2 * r + 1));
        }
        taken.push([cx, y]);
        const c = el(
          "circle",
          {
            cx,
            cy: y,
            r,
            fill: sd === 0 ? "var(--page)" : sd > 0 ? "var(--test)" : "var(--other)",
            stroke: sd === 0 ? "var(--ink)" : "none",
            "stroke-width": 1.5,
            class: "mk",
            "data-rid": here ? a.rid : "",
            "data-board": bid,
          },
          g,
        );
        el("title", {}, c).textContent =
          a.method +
          " " +
          val(a.value) +
          " · stored " +
          (a.split || "no split") +
          " · " +
          a.verdict.replace("_", " ") +
          (a.split_per_source ? " (source: " + a.split_per_source + ")" : "");
        const d = 500 + i * 60 + j * 40;
        const seed = bid + "#" + a.rid;
        if (a.verdict === "wrong_split") {
          const to = a.split_per_source === "test" ? 1 : a.split_per_source ? -1 : 0;
          const tx2 = x + to * (r + 5);
          const gg = el("g", {}, g);
          pencil(
            gg,
            cx - Math.sign(tx2 - cx || 1) * 2,
            y - 1,
            tx2 + Math.sign(tx2 - cx || 1) * (r + 6),
            y + 1,
            seed,
            true,
          );
          anim(gg, "fade", d);
        } else if (a.verdict === "wrong_value") {
          const gg = el("g", {}, g);
          pencil(gg, cx - r - 5, y + 5, cx + r + 5, y - 5, seed, false);
          anim(gg, "fade", d);
        } else if (a.verdict === "unsure" || a.verdict === "missing") {
          c.setAttribute("r", r + 2);
          c.setAttribute("stroke", "var(--red)");
          c.setAttribute("stroke-dasharray", "3 2");
          c.setAttribute("stroke-width", 2);
          c.setAttribute("fill", "var(--page)");
        }
      });
    });
    shortCap(
      "erratumCap",
      "<b>Fig. 3.</b> 56 records we checked by hand. <span style='color:var(--red)'>Red pencil</span> marks each one the data got wrong.",
      "<b>Fig. 3.</b> One rule per audited leaderboard; each mark one checked record on its stored side (<span style='color:var(--test-text)'>test</span> right, <span style='color:var(--other-text)'>other split</span> left, hollow if none). <span style='color:var(--red)'>Red pencil</span>: an arrow moves a mark to the split its paper gives; a strike marks a value read from the wrong column; a dashed red ring is unclear or incomplete. Each rule is scaled to its own checked records, lowest at the foot; the shaded rule is this leaderboard.",
    );
  }

  // ------------------------------------------------------------------ browse: the census
  const OUTCOME = {
    d: "Answers differ",
    c: "Depends on the group",
    s: "Same answer",
    n: "No fair comparison possible",
    x: "No ranking · metric direction unknown",
  };
  function outcomeOf(r) {
    if (!r.scored) return "x";
    const s = r.st.Q_official;
    return s === "i" ? "n" : s === "c" ? "c" : r.flip ? "d" : "s";
  }
  function prepareBrowse() {
    if (S.browse) return;
    const norm = (s) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const rows = S.index.map((r) => ({
      r,
      key: norm(r.dataset + " " + r.metric),
      oc: outcomeOf(r),
      hand: S.auditBoards.has(r.id),
      bad: S.auditBoards.get(r.id),
    }));
    const order = { d: 0, c: 1, s: 2, n: 3, x: 4 };
    rows.sort((a, b) => order[a.oc] - order[b.oc] || b.r.n - a.r.n || a.key.localeCompare(b.key));
    rows.forEach((x, i) => {
      x.i = i;
    });
    S.browse = { rows, q: "", f: "all", shown: 100, list: rows, norm };
  }
  function showBrowse(q) {
    markNav("browse");
    if (!S.byId) {
      S.indexP.then(() => showBrowse(q));
      return;
    }
    document.documentElement.classList.add("on-browse");
    prepareBrowse();
    const B = S.browse;
    if (q != null) B.q = q;
    $("boardView").hidden = true;
    $("aboutView").hidden = true;
    $("spotView").hidden = true;
    $("browseView").hidden = false;
    refreshSimple();
    if (!$("census")) {
      const n = (f) => fmtN(B.rows.filter((x) => (f === "hand" ? x.hand : x.oc === f)).length);
      $("browseView").innerHTML =
        "<h2 class='q'>All " +
        fmtN(B.rows.length) +
        " leaderboards</h2><p class='gloss'>Each small ruler below is one leaderboard, grouped by what the same-setup comparison found. " +
        (touchOnly() ? "Tap one to open it." : "Point at one to see it, and click to open it.") +
        "</p>" +
        "<div class='bfilters'><input id='browseQ' type='search' placeholder='dataset or metric' aria-label='Filter by dataset or metric' autocomplete='off' spellcheck='false'><span class='lab'>Show:</span><span class='bchips' role='group' aria-label='Show'>" +
        [
          ["all", "All"],
          ["d", "Answers differ (" + n("d") + ")"],
          ["c", "Depends (" + n("c") + ")"],
          ["s", "Same (" + n("s") + ")"],
          ["n", "No fair comparison (" + n("n") + ")"],
          ["hand", "Checked by hand (" + n("hand") + ")"],
        ]
          .map(
            ([f, t]) =>
              "<button type='button' class='lk" +
              (f === "all" ? " on" : "") +
              "' data-action='bfilter' data-f='" +
              f +
              "'>" +
              esc(t) +
              "</button>",
          )
          .join("") +
        "</span><span class='blive' id='browseLive' aria-live='polite'></span></div>" +
        "<p class='ckey'><span><i class='hk'>✓</i> checked by hand</span><span class='red'><i class='hk'>✓</i> in red: the hand check found errors</span></p>" +
        "<div class='census' id='census'></div><div class='btable'><h3 class='bt-h'>Every leaderboard as a row</h3><ul class='glyph-key' aria-label='Outcome marks in the first column'><li><span class='m'>≠</span> answers differ</li><li><span class='m'>⋮</span> depends on the group</li><li><span class='m'>·</span> same answer</li><li><span class='m'>∅</span> no fair comparison possible</li><li><span class='m'>–</span> no ranking</li></ul><p class='note' id='browseCount'></p>" +
        btTable(
          "<th class='g'><span class='vh'>Outcome</span></th><th>Dataset</th><th>Metric</th><th class='num'>Records</th><th>Where measured</th><th>Hand check</th>",
          "",
        ).replace("<tbody></tbody>", "<tbody id='browseRows'></tbody>") +
        "<p class='line'><button type='button' class='lk' id='browseMore' data-action='bmore'>Show more</button></p><div id='browseEnd'></div></div>";
      addDefs($("browseView").querySelector(".gloss"));
      $("browseQ").addEventListener("input", (e) => {
        B.q = e.target.value;
        filterBrowse();
      });
      if ("IntersectionObserver" in window)
        new IntersectionObserver(
          (es) => {
            if (es[0].isIntersecting && !$("browseView").hidden && B.shown < B.list.length) {
              B.shown += 100;
              drawRows();
            }
          },
          { rootMargin: "300px" },
        ).observe($("browseEnd"));
      drawCensus();
    }
    $("browseQ").value = B.q;
    filterBrowse();
    window.scrollTo(0, 0);
    if (!S.covById)
      loadCoverage()
        .then(() => {
          if (!$("browseView").hidden) drawRows();
        })
        .catch(() => {}); // the table still works without the split bars; a later visit retries
  }
  function drawCensus() {
    const host = $("census");
    host.innerHTML = "";
    const B = S.browse,
      phone = window.matchMedia("(max-width: 760px)").matches;
    ["d", "c", "s", "n", "x"].forEach((code) => {
      const list = B.rows.filter((x) => x.oc === code);
      const blk = document.createElement("div");
      blk.className = "block";
      blk.dataset.code = code;
      const EXPL = {
        d: "the fair winner is a different method",
        c: "each test-split group has its own winner",
        s: "the top number is also the fair answer",
        n: "no two records share a test setup",
      };
      blk.innerHTML =
        "<h3>" +
        OUTCOME[code] +
        "<small>" +
        fmtN(list.length) +
        "</small> <i class='bexpl'>" +
        (EXPL[code] || "") +
        "</i></h3>";
      host.appendChild(blk);
      if (code === "x") {
        blk.innerHTML =
          "<p class='note'>Not drawn: " +
          fmtN(list.length) +
          " leaderboards whose metric direction is unknown, so no ranking exists. They are listed in the table.</p>";
        return;
      }
      const big = code === "d" || code === "c";
      const cw = big ? 15 : 10,
        ch = big ? 21 : 14,
        cols = phone ? (big ? 14 : 40) : big ? 80 : 118, // on a phone the two blocks people open most are drawn large enough to tap
        rows = Math.ceil(list.length / cols),
        W = cols * cw,
        H = rows * ch + 4;
      const svg = el(
        "svg",
        { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": list.length + " leaderboards: " + OUTCOME[code] },
        blk,
      );
      if (!phone) svg.style.maxWidth = W + "px"; // on a phone the block spans the column, so each ruler is a fair tap target
      // drawn at once: the census is a map to read, not a sequence to watch
      const d = el("defs", {}, svg);
      const sy = el("symbol", { id: "g-" + code, viewBox: "0 0 10 14" }, d);
      el("line", { x1: 5, x2: 5, y1: 1, y2: 13, stroke: "var(--ink)", "stroke-width": 1, opacity: 0.38 }, sy); // the rule recedes; the marks carry the outcome, so each block reads as a field of its colour
      if (code === "d") {
        el("circle", { cx: 2.4, cy: 3.8, r: 2.2, fill: "var(--other)" }, sy);
        el("circle", { cx: 7.6, cy: 9, r: 2.2, fill: "var(--test)" }, sy);
      }
      if (code === "c") {
        el("circle", { cx: 7.6, cy: 3.8, r: 2.2, fill: "var(--test)" }, sy);
        el("circle", { cx: 7.6, cy: 9.6, r: 2.2, fill: "var(--test)" }, sy);
      }
      if (code === "s") el("circle", { cx: 7.6, cy: 3.8, r: 2.3, fill: "var(--test)" }, sy);
      if (code === "n")
        el("circle", { cx: 5, cy: 7, r: 2.3, fill: "var(--page)", stroke: "var(--ink)", "stroke-width": 1.1 }, sy);
      const hl = el("symbol", { id: "h-" + code, viewBox: "0 0 10 14" }, d);
      el("path", { d: "M2 2.5 l2 2 l4 -4", fill: "none", stroke: "var(--ink)", "stroke-width": 1.3 }, hl);
      const hr = el("symbol", { id: "r-" + code, viewBox: "0 0 10 14" }, d);
      el("path", { d: "M2 2.5 l2 2 l4 -4", fill: "none", stroke: "var(--red)", "stroke-width": 1.5 }, hr);
      el("line", { x1: 5, x2: 5, y1: 1, y2: 13, stroke: "var(--red)", "stroke-width": 1.2 }, hr);
      list.forEach((x, i) => {
        const px = (i % cols) * cw,
          py = Math.floor(i / cols) * ch;
        el("use", { href: "#g-" + code, x: px, y: py, width: cw, height: ch, "data-i": x.i, class: "cell" }, svg);
        if (x.bad === 2)
          el("use", { href: "#r-" + code, x: px, y: py, width: cw, height: ch, "data-i": x.i, class: "cell" }, svg);
        else if (x.hand)
          el("use", { href: "#h-" + code, x: px, y: py, width: cw, height: ch, "data-i": x.i, class: "cell" }, svg);
      });
    });
  }
  function filterBrowse() {
    const B = S.browse,
      toks = B.norm(B.q).split(" ").filter(Boolean);
    const match = (x) =>
      (B.f === "all" || (B.f === "hand" ? x.hand : x.oc === B.f)) && toks.every((t) => x.key.includes(t));
    B.list = B.rows.filter(match);
    B.shown = 100;
    const ok = new Set(B.list.map((x) => x.i));
    const any = toks.length || B.f !== "all";
    document
      .querySelectorAll("#census use.cell")
      .forEach((u) => u.classList.toggle("dim", any && !ok.has(+u.dataset.i)));
    drawRows();
  }
  function drawRows() {
    const B = S.browse;
    const gl = { d: "≠", c: "⋮", s: "·", n: "∅", x: "–" };
    $("browseRows").innerHTML = B.list
      .slice(0, B.shown)
      .map((x) => {
        const r = x.r;
        const check = !x.hand
          ? ""
          : S.disputed.has(r.id)
            ? "<span class='chk bad'>! answer disputed</span>"
            : x.bad === 2
              ? "<span class='chk bad'>✗ errors found</span>"
              : x.bad === 1
                ? "<span class='chk unsure'>? one label unclear</span>"
                : "<span class='chk'>✓ confirmed</span>";
        return (
          "<tr data-id='" +
          esc(r.id) +
          "' tabindex='0'><td class='g m' title='" +
          OUTCOME[x.oc] +
          "'>" +
          gl[x.oc] +
          "</td><td><a href='#q=Q_official&b=" +
          encodeURIComponent(r.id) +
          "'>" +
          esc(r.dataset) +
          "</a></td><td>" +
          esc(metricName(r.metric)) +
          "</td><td class='num'>" +
          r.n +
          "</td><td>" +
          (S.covById
            ? (() => {
                const c = S.covById.get(r.id);
                return mixBar(c[0], c[1], c[2], "90px");
              })()
            : "") +
          "</td><td>" +
          check +
          "</td></tr>"
        );
      })
      .join("");
    $("browseCount").textContent = B.list.length
      ? "Showing " +
        fmtN(Math.min(B.shown, B.list.length)) +
        " of " +
        fmtN(B.list.length) +
        (B.list.length === B.rows.length ? "" : " matching") +
        " leaderboards."
      : "No leaderboard matches “" + B.q.trim() + "”. Try a dataset name (e.g. ImageNet) or a metric (e.g. BLEU).";
    // the filter bar stays on screen down the whole page, and carries its own count; the table's column names stick under it
    $("browseView").style.setProperty("--bfh", $("browseView").querySelector(".bfilters").offsetHeight + "px");
    // the filter bar stays on screen down the whole page, and carries its own count
    $("browseLive").textContent =
      B.list.length === B.rows.length ? "" : fmtN(B.list.length) + (B.list.length === 1 ? " match" : " matches");
    // the heading says what is shown, so a filter or a search is never silent
    const h = $("browseView").querySelector("h2.q");
    if (h)
      h.textContent =
        B.list.length === B.rows.length
          ? "All " + fmtN(B.rows.length) + " leaderboards"
          : fmtN(B.list.length) + " of " + fmtN(B.rows.length) + " leaderboards";
    $("browseMore").hidden = B.shown >= B.list.length;
  }

  // ------------------------------------------------------------------ split mix: where a set of records was measured
  // One bar, three parts in the ruler's own code: test filled green, any other split orange, split not stated hatched and hollow.
  function mixBar(t, o, u, w, cls) {
    const n = t + o + u;
    if (!n) return "";
    const p = (x) => ((100 * x) / n).toFixed(3) + "%";
    return (
      "<span class='mixbar " +
      (cls || "") +
      "' style='width:" +
      w +
      "' role='img' aria-label='" +
      t +
      " test, " +
      o +
      " other split, " +
      u +
      " split not stated'>" +
      (t ? "<i class='t' style='--w:" + p(t) + "'></i>" : "") +
      (o ? "<i class='o' style='--w:" + p(o) + "'></i>" : "") +
      (u ? "<i class='u' style='--w:" + p(u) + "'></i>" : "") +
      "</span>"
    );
  }
  // plain = the plain-words sheet's vocabulary (real test / another set), so one panel never mixes two sets of terms
  const mixWords = (t, o, u, plain) =>
    [
      t ? "<span class='tt'>" + fmtN(t) + (plain ? " real test" : " test") + "</span>" : "",
      o ? "<span class='ot'>" + fmtN(o) + (plain ? " another set" : " other split") + "</span>" : "",
      u ? "<span>" + fmtN(u) + " not stated</span>" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  function boardMix(b) {
    let t = 0,
      o = 0,
      u = 0;
    b.records.forEach((r) => {
      const s = sideOf(r);
      if (s > 0) t++;
      else if (s < 0) o++;
      else u++;
    });
    return [t, o, u];
  }
  // the board's split bar, with a small tick over the segment the leaderboard's top number comes from
  function mixTop(t, o, u) {
    const n = t + o + u,
      top = S.board.scored ? S.board.records[S.board.answers.Q_any.winner_rid] : null;
    let tick = "";
    if (top && n) {
      const sd = sideOf(top),
        [a, w] = sd > 0 ? [0, t] : sd < 0 ? [t, o] : [t + o, u];
      tick =
        "<i class='mixtop' style='left:" +
        ((100 * a) / n).toFixed(2) +
        "%;width:" +
        ((100 * w) / n).toFixed(2) +
        "%' title='The top number is one of these records'></i>";
    }
    return "<span class='mixwrap'>" + mixBar(t, o, u, "100%", S.reduced || S.quick ? "" : "grow") + tick + "</span>";
  }
  function renderMix() {
    const [t, o, u] = boardMix(S.board);
    $("mix").innerHTML =
      "<span class='lab'>Where its " +
      fmtN(t + o + u) +
      " records were measured</span>" +
      mixTop(t, o, u) +
      "<span class='mixw'>" +
      mixWords(t, o, u) +
      "</span>";
    const g = $("mix").querySelector(".grow");
    if (g) requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add("in")));
  }
  const pct = (x, n) => Math.round((100 * x) / n) + "%";
  async function loadCoverage() {
    if (S.cov) return S.cov;
    if (!S.covP)
      S.covP = Promise.all([getJSON("data/coverage.json"), getJSON("data/blindspots.json")])
        .then(([c, b]) => {
          S.cov = c;
          S.spots = b;
          S.covById = new Map(S.index.map((r, i) => [r.id, c.rows[i]]));
          return c;
        })
        .catch((e) => {
          S.covP = null; // forget the failure so the next visit retries
          throw e;
        });
    return S.covP;
  }

  // ------------------------------------------------------------------ blindspots: the leaderboard's answer next to the same-setup answer
  const SPOT = { d: "Winner changes", o: "Top on another split", u: "Top split not stated" };
  const SPOT_EXPL = {
    d: "A same-setup comparison names a different method. In a few, the top number is itself a test number, but written under a different metric name",
    o: "The top number is a validation, training or other non-test number",
    u: "No split is recorded for the top number",
  };
  const oddScale = (a, b2) => a > 0 && b2 > 0 && Math.max(a, b2) / Math.min(a, b2) > 2;
  async function showBlindspots() {
    await S.indexP;
    $("boardView").hidden = true;
    $("aboutView").hidden = true;
    $("browseView").hidden = true;
    $("spotView").hidden = false;
    window.scrollTo(0, 0);
    const host = $("spotView");
    if (!S.cov) host.innerHTML = "<h2 class='q'>Blindspots</h2><p class='gloss'>Loading…</p>";
    try {
      await loadCoverage();
    } catch (e) {
      host.innerHTML =
        "<h2 class='q'>Blindspots</h2><p class='gloss'>The coverage data could not be loaded (the network may have dropped). <button type='button' class='lk' data-action='retry'>Try again</button></p>";
      return;
    }
    if (host.dataset.drawn) {
      refreshSimple();
      return;
    }
    const C = S.cov,
      R = C.records,
      T = C.top,
      nR = R[0] + R[1] + R[2],
      nT = T[0] + T[1] + T[2],
      notTest = T[1] + T[2];
    S.spot = S.spot || { f: "d", shown: 40 };
    S.spotTabs =
      "Each leaderboard sits in one tab. Those whose winner also changes are under “Winner changes”, so the other two tabs hold the rest: " +
      fmtN(S.spots.filter((x) => x.k === "o").length) +
      " of the " +
      fmtN(T[1]) +
      " tops on another split, and " +
      fmtN(S.spots.filter((x) => x.k === "u").length) +
      " of the " +
      fmtN(T[2]) +
      " with no split stated.";
    const cnt = (k) => S.spots.filter((x) => x.k === k).length;
    const bar = (v, n, lab) =>
      "<div class='pop'><p class='pop-h'>" +
      lab +
      "</p>" +
      mixBar(v[0], v[1], v[2], "100%", "big grow") +
      "<p class='pop-k'><span class='tt'>test " +
      fmtN(v[0]) +
      " (" +
      pct(v[0], n) +
      ")</span><span class='ot'>other split " +
      fmtN(v[1]) +
      " (" +
      pct(v[1], n) +
      ")</span><span>split not stated " +
      fmtN(v[2]) +
      " (" +
      pct(v[2], n) +
      ")</span></p></div>";
    host.innerHTML =
      "<h2 class='q'>Blindspots: where the top number is not the fair answer</h2><p class='gloss'>A leaderboard puts one number on top. For <b>" +
      fmtN(notTest) +
      " of the " +
      fmtN(nT) +
      "</b> leaderboards that can be ranked, that number is not a recorded test number, and for <b>" +
      fmtN(cnt("d")) +
      "</b> a same-setup comparison names a different winner.</p>" +
      "<div class='pops'>" +
      bar(T, nT, "The top number of each of the " + fmtN(nT) + " rankable leaderboards") +
      bar(R, nR, "All " + fmtN(nR) + " result records in the archive") +
      "</div>" +
      "<p class='line' id='spotTabs'><span class='lab'>Show</span>" +
      ["d", "o", "u"]
        .map(
          (k) =>
            "<button type='button' class='lk" +
            (k === S.spot.f ? " on" : "") +
            "' data-action='spotf' data-f='" +
            k +
            "'>" +
            SPOT[k] +
            " <span class='muted mono-n'>" +
            fmtN(cnt(k)) +
            "</span></button>",
        )
        .join("") +
      "<span class='lab' style='margin-left:18px'>Order</span>" +
      [
        ["n", "largest leaderboards"],
        ["gap", "largest gap"],
      ]
        .map(
          ([k, t]) =>
            "<button type='button' class='lk" +
            ((S.spot.sort || "n") === k ? " on" : "") +
            "' data-action='spotsort' data-s='" +
            k +
            "'>" +
            t +
            "</button>",
        )
        .join("") +
      "</p><p class='note' id='spotExpl'></p>" +
      "<p class='spot-key'><span>† measured on another split</span><span>? split not stated</span><span class='muted'>" +
      (touchOnly() ? "Tap" : "Click") +
      " a row to open its leaderboard, with every record and its source." +
      "</span></p>" +
      "<div class='spot-head' aria-hidden='true'><span>Leaderboard</span><span>The leaderboard says</span><span>Same setup</span><span>Gap</span></div>" +
      "<div class='spots' id='spots' role='list'></div><p class='line'><button type='button' class='lk' id='spotMore' data-action='spotmore'>Show more</button></p>";
    host.dataset.drawn = "1";
    drawSpots();
    host.querySelectorAll(".gloss, .spot-key").forEach(addDefs);
    refreshSimple();
    if (!S.reduced)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => host.querySelectorAll(".grow").forEach((g) => g.classList.add("in"))),
      );
    else host.querySelectorAll(".grow").forEach((g) => g.classList.add("in"));
  }
  /* the gap, drawn in the hero's language: a short rule, better is up. The top number sits at the top on its own side
     (left: another split, on the rule: none stated, right: test); the same-setup answer sits on the test side,
     set down by the square root of its relative gap, so small gaps stay visible (full height = 20% or more). */
  function gapGlyph(x, odd, behind) {
    if (!x.fair || x.fair[0] == null || odd) return "<div class='sg'></div>";
    const tp = x.top,
      rel = Math.abs(x.fair[1] - tp[1]) / Math.max(Math.abs(tp[1]), 1e-9),
      s = tp[2] == null ? 0 : tp[2] === "test" ? 1 : -1;
    const X = 26,
      yT = 10,
      yF = yT + Math.max(3, Math.sqrt(Math.min(rel, 0.2) / 0.2) * 46),
      xT = X + s * 10,
      xF = X + 10,
      xb = X + 20,
      pc = rel < 0.001 ? "&lt;0.1%" : (100 * rel).toFixed(1) + "%";
    const ln = (x1, x2, y1, y2, c, w) =>
      "<line x1='" +
      x1 +
      "' x2='" +
      x2 +
      "' y1='" +
      y1 +
      "' y2='" +
      y2 +
      "' stroke='" +
      c +
      "' stroke-width='" +
      w +
      "'/>";
    return (
      "<div class='sg' title='The same-setup answer is " +
      pc +
      " worse than the top number" +
      (behind ? ", " + behind + " points behind" : "") +
      "'><svg viewBox='0 0 56 66' aria-hidden='true'>" +
      ln(X, X, 2, 64, "var(--ink)", 1.6) +
      ln(xb, xb, yT, yF, "var(--ink)", 1.2) +
      ln(xb - 3, xb, yT, yT, "var(--ink)", 1.2) +
      ln(xb - 3, xb, yF, yF, "var(--ink)", 1.2) +
      "<circle cx='" +
      xT +
      "' cy='" +
      yT +
      "' r='5' fill='" +
      (s === 0 ? "var(--page)" : s > 0 ? "var(--test)" : "var(--other)") +
      "' stroke='var(--ink)' stroke-width='" +
      (s === 0 ? 1.5 : 0) +
      "'/>" +
      "<circle cx='" +
      xF +
      "' cy='" +
      yF +
      "' r='5' fill='var(--test)'/></svg><span><b>" +
      pc +
      "</b> worse</span></div>"
    );
  }
  // relative gap between the top number and the same-setup answer (0 when there is no single answer)
  const spotGap = (x) =>
    x.fair && x.fair[0] != null ? Math.abs(x.fair[1] - x.top[1]) / Math.max(Math.abs(x.top[1]), 1e-9) : 0;
  function drawSpots() {
    const f = S.spot.f;
    const list = S.spots
      .filter((x) => x.k === f)
      .map((x) => ({ x, r: S.index[x.i], c: S.cov.rows[x.i] }))
      .map((o2) =>
        Object.assign(o2, { odd: !!(o2.x.fair && o2.x.fair[0] != null && oddScale(o2.x.fair[1], o2.x.top[1])) }),
      )
      .sort(
        (a, b) =>
          a.odd - b.odd ||
          (S.spot.sort === "gap" ? (a.r.n < 5) - (b.r.n < 5) || spotGap(b.x) - spotGap(a.x) : 0) ||
          b.r.n - a.r.n ||
          a.r.dataset.localeCompare(b.r.dataset),
      );
    const nOdd = list.filter((o2) => o2.odd).length;
    const full =
      SPOT_EXPL[f] +
      (S.spot.sort === "gap"
        ? ". Largest gaps first. Leaderboards with fewer than 5 records come after, because a single record can swing them"
        : ". Largest leaderboards first") +
      (nOdd
        ? ". Rows whose two values differ more than twofold, perhaps because of a different scale or unit, come last and are marked"
        : "") +
      ". The small rule on the right draws the gap." +
      (f === "d" && S.disputed.size
        ? " One counted change, RefCOCOg, is disputed by the hand check: its source reports a better test value the data missed. It stays in the count because every count is computed from the stored records."
        : "") +
      " " +
      S.spotTabs;
    shortCap("spotExpl", esc(SPOT_EXPL[f]) + ".", esc(full), "more");
    const side = (sp) => (sp == null ? 0 : sp === "test" ? 1 : -1);
    $("spots").innerHTML = list
      .slice(0, S.spot.shown)
      .map(({ x, r, c, odd }) => {
        const tp = x.top,
          s = side(tp[2]),
          hue = s > 0 ? "tt" : s < 0 ? "ot" : "",
          spl =
            tp[2] == null
              ? "split not stated"
              : (SPLIT_SHORT[tp[2]] || tp[2]) + (tp[2] === "test" ? " split" : " split");
        const dag = s > 0 ? "" : s < 0 ? "<sup>†</sup>" : "<sup>?</sup>";
        let fair,
          behind = "";
        if (x.fair && x.fair[0] != null) {
          const g = x.fair[1] - tp[1];
          const dg = Math.max(dec(x.fair[1]), dec(tp[1]));
          behind = g && !odd ? Math.abs(g).toFixed(Math.min(dg, 4)) : "";
          fair =
            "<span class='sv tt' title='test split'>" +
            val(x.fair[1]) +
            "</span> <span class='sm'>" +
            esc(methodName({ method: x.fair[0], arxiv_id: x.fair[2] })) +
            "</span>" +
            (odd
              ? "<span class='ss odd'>values differ more than twofold: possibly a different scale or unit</span>"
              : "") +
            (S.disputed.has(r.id)
              ? "<span class='ss odd'>disputed by the hand check: its source reports a better test value the data missed</span>"
              : "");
        } else if (x.st === "c")
          fair =
            "<span class='sv cond'>depends</span><span class='ss'>" +
            x.fair[1] +
            " test groups, each with its own winner</span>";
        else fair = "<span class='sv none' title='No two records share a test setup'>no fair comparison</span>";
        return (
          "<div class='spot' role='listitem' tabindex='0' data-id='" +
          esc(r.id) +
          "'><div class='sc'><a href='#q=Q_official&b=" +
          encodeURIComponent(r.id) +
          "' class='sd'>" +
          esc(r.dataset) +
          "</a><span class='smeta'>" +
          esc(metricName(r.metric)) +
          ", " +
          nRec(r.n) +
          "</span>" +
          mixBar(c[0], c[1], c[2], "min(150px, 100%)") +
          "</div>" +
          "<div class='sc'><span class='sk'>the leaderboard says</span><span class='sv " +
          hue +
          "' title='" +
          spl +
          "'>" +
          val(tp[1]) +
          dag +
          "</span> <span class='sm'>" +
          esc(methodName({ method: tp[0], arxiv_id: tp[3] })) +
          "</span></div>" +
          "<div class='sc'><span class='sk'>same setup</span>" +
          fair +
          "</div>" +
          gapGlyph(x, odd, behind) +
          "</div>"
        );
      })
      .join("");
    $("spotMore").hidden = S.spot.shown >= list.length;
    $("spotMore").textContent = "Show more (" + fmtN(list.length - Math.min(S.spot.shown, list.length)) + " left)";
  }

  // ------------------------------------------------------------------ explain simply: a quiet side note, written in advance, filled from the board's own numbers
  // No model is called: every sentence is a fixed template or hand-written for the paper's examples.
  const SIMPLE_EX = {
    1: "Here, BSN++ reports 34.88, but on the practice set. Its own paper reports no real-test number. Among real-test scores, BSN is best with 32.84.",
    2: "Here we ask a harder question: is the best real-test score far enough ahead of the next one in every group? In some groups it is not.",
    3: "Here, BYTE and ByteTrack are the same tracker. 79.3 is its practice run; 77.3 is its real-test run. They also trained on different data, so not all of the 2-point gap comes from the split.",
    4: "Here, the top score (MHNet-64, 33.76) does not say which set it came from, so it cannot win. Among scores that say real test, Restormer is on top with 32.92.",
    5: "Here we ask year by year. Each year gets its own fair winner, picked only from scores measured the same way. The years are when the papers were posted, not a race over time.",
    6: "Here, none of the four scores says which set it was measured on. So no fair winner can be named: that is the honest answer, not a broken page.",
  };
  const picto =
    "<svg class='picto' viewBox='0 0 300 112' role='img' aria-label='How the pictures on this site place a score: practice scores to the left of the rule, real-test scores to the right, scores that do not say on the rule'><line x1='150' y1='6' x2='150' y2='106' stroke='var(--ink)' stroke-width='2'/><circle cx='131' cy='28' r='8' fill='var(--other)'/><text x='114' y='33' text-anchor='end' font-size='15' fill='var(--other-text)'>practice score</text><circle cx='169' cy='56' r='8' fill='var(--test)'/><text x='186' y='61' font-size='15' fill='var(--test-text)'>real-test score</text><circle cx='150' cy='86' r='8' fill='var(--page)' stroke='var(--ink)' stroke-width='1.5'/><text x='167' y='91' font-size='15' fill='var(--mute)' class='it'>does not say</text></svg>";
  const CATCH =
    "<p><b>The catch.</b> Researchers tune a method on <i>practice</i> questions (usually the validation split) and are meant to report its final score on <i>real-test</i> questions kept aside (the test split). The two can differ in either direction, so they are not the same contest. A leaderboard ranks them together anyway.</p><p class='muted'>In the pictures on this site:</p>" +
    picto;
  function simpleBoard() {
    const b = S.board,
      A = b.answers,
      ex = S.examples.find((e) => e.board === b.id && e.template === S.tmpl),
      [t, o, u] = boardMix(b),
      n = t + o + u;
    const what =
      "<p><b>What is this?</b> " +
      esc(TASK_GLOSS[b.id] || "Papers report scores on " + b.dataset + ", measured as " + b.metric + ".") +
      (b.scored ? " " + (b.direction === "lower" ? "Lower" : "Higher") + " is better." : "") +
      "</p>";
    const others = [
      ...new Set(b.records.filter((q) => sideOf(q) < 0).map((q) => SPLIT_SHORT[q.proto.split] || q.proto.split)),
    ];
    const know =
      "<p><b>How much is written down.</b> Of its " +
      fmtN(n) +
      " scores, " +
      fmtN(t) +
      " say real test, " +
      fmtN(o) +
      " say another set" +
      (others.length ? " (" + esc(others.join(", ")) + ")" : "") +
      ", and " +
      fmtN(u) +
      (u === 1 ? " does" : " do") +
      " not say.</p>" +
      mixBar(t, o, u, "100%", "big") +
      "<p class='mixw'>" +
      mixWords(t, o, u, true) +
      "</p>";
    const foot =
      "<p class='muted'>One person checked 56 records like these against the papers and found 14 with a wrong label. So read every label as what was <i>recorded</i>, and follow the paper link to be sure.</p>";
    if (!b.scored)
      return (
        what +
        "<p><b>No answer here.</b> The data do not say whether higher or lower is better for this score, so nobody can be ‘best’.</p>" +
        know +
        foot
      );
    const top = b.records[A.Q_any.winner_rid],
      ts = sideOf(top);
    const says =
      "<p><b>What the leaderboard says.</b> " +
      esc(methodName(top)) +
      " is first with " +
      val(top.value) +
      ". " +
      (ts > 0
        ? "That is a real-test score."
        : ts < 0
          ? "But that is a <span class='ot'>practice score (" +
            esc(splitWord(top.proto)) +
            ")</span>, not a real-test one."
          : "But its record does not say which set it was measured on.") +
      "</p>";
    let fair = "";
    if (S.tmpl === "Q_official") {
      const q = A.Q_official;
      fair =
        q.status === "robust"
          ? "<p><b>The fair answer.</b> Comparing only real-test scores measured the same way, <span class='tt'>" +
            esc(methodName(b.records[q.winner_rid])) +
            " wins with " +
            val(b.records[q.winner_rid].value) +
            "</span>." +
            (q.winner_rid === top.rid ? " Same winner: here the leaderboard is right." : " A different winner.") +
            "</p>"
          : q.status === "conditional"
            ? "<p><b>The fair answer.</b> The real-test scores come in " +
              q.sets.length +
              " groups measured in different ways. Each group has its own winner, so there is no single one.</p>"
            : "<p><b>The fair answer.</b> There are not two real-test scores measured the same way, so no fair winner can be named. That is an answer too: not enough was written down to compare.</p>";
    } else if (S.tmpl === "Q_trend")
      fair =
        "<p><b>The question here.</b> Instead of one winner, we ask year by year: which score was best among scores measured the same way? " +
        (A.Q_trend.status === "insufficient"
          ? "No year has two such scores, so there is no answer."
          : A.Q_trend.years.length + " years have an answer.") +
        "</p>";
    else
      fair =
        "<p><b>The question here.</b> Is the best real-test score far enough ahead of the next one, in every group where both appear? " +
        (A.Q_threshold.status === "robust"
          ? "Yes."
          : A.Q_threshold.status === "conditional"
            ? "Only in some groups."
            : "There is not enough to tell.") +
        "</p>";
    const exOnly = ex && SIMPLE_EX[ex.n] && S.tmpl === "Q_official";
    return (
      what +
      CATCH +
      (exOnly ? "" : says) +
      (exOnly ? "" : fair) +
      (ex && SIMPLE_EX[ex.n] ? "<p class='ex-note'>" + esc(SIMPLE_EX[ex.n]) + "</p>" : "") +
      know +
      foot
    );
  }
  const SIMPLE_PAGE = {
    browse:
      "<p><b>What is this page?</b> Every leaderboard in the archive, one small mark each, sorted into four groups by what happens when only scores measured the same way compete: the winner changes, it depends on the group, the winner stays the same, or nothing can be fairly compared. Hover a mark to see its name; select it to open it.</p>",
    blindspots:
      "<p><b>What is this page?</b> The leaderboards where the number on top is not a real-test score, or where a fair comparison names someone else. Each row puts what the leaderboard says next to the fair answer, and the small line on the right shows how far apart they are.</p>",
    about:
      "<p><b>What is this page?</b> Who made this, what each question means, how the labels were checked by hand, and where to download everything.</p>",
  };
  function simpleSite(v) {
    const C = S.cov,
      st = S.meta.stats;
    return (
      (SIMPLE_PAGE[v] || "") +
      "<p><b>What is this site?</b> Machine-learning papers report scores on shared tests, and leaderboards rank them. This site checks whether the top score was measured the same way as the scores it beats.</p>" +
      CATCH +
      "<p><b>What we found.</b> Of " +
      fmtN(st.query_conditioned_boards) +
      " leaderboards that can be ranked, " +
      fmtN(st.winner_changes) +
      " name a different winner once only same-setup scores compete.</p>" +
      (C
        ? "<p><b>How much is written down.</b> Across all " +
          fmtN(C.records[0] + C.records[1] + C.records[2]) +
          " scores, more than half do not say which set they were measured on.</p>" +
          mixBar(C.records[0], C.records[1], C.records[2], "100%", "big") +
          "<p class='mixw'>" +
          mixWords(C.records[0], C.records[1], C.records[2]) +
          "</p>"
        : "") +
      "<p class='muted'>Everything here was worked out in advance from a frozen copy of the data. No AI model runs when you click.</p>"
    );
  }
  function refreshSimple() {
    if ($("simple").hidden) return;
    const onBoard = !$("boardView").hidden && S.board,
      v = viewOf();
    $("simplePage").textContent = onBoard
      ? S.board.dataset
      : { browse: "Browse", blindspots: "Blindspots", about: "About", home: "This site" }[v];
    $("simpleBody").innerHTML = onBoard ? simpleBoard() : simpleSite(v);
    sheetShift();
  }
  /* Explain simply is a margin card on wide screens. Every page makes room for it the same way (its column narrows
     beside the card), so nothing is ever hidden underneath; below 1280px it is a bottom sheet instead. */
  function sheetShift() {
    const h = document.documentElement;
    h.classList.toggle("simple-reflow", h.classList.contains("simple-open") && !S.present && window.innerWidth >= 1280);
    sheetTop();
  }
  // on wide screens the sheet starts below the masthead while it is in view, so the nav is never covered
  function sheetTop() {
    const sh = $("simple");
    if (!document.documentElement.classList.contains("simple-open") || window.innerWidth < 1280) {
      sh.style.removeProperty("top");
      return;
    }
    const place = () =>
      (sh.style.top =
        Math.max(18, Math.round(document.querySelector(".rh").getBoundingClientRect().bottom) + 16) + "px");
    place();
    requestAnimationFrame(place); // and again once the new page has laid out
  }
  function setSimple(open) {
    const sh = $("simple");
    $("simpleBtn").setAttribute("aria-expanded", open);
    document.documentElement.classList.toggle("simple-open", open);
    if (open) {
      sh.hidden = false;
      refreshSimple();
      sheetShift();
      if (!S.reduced) {
        sh.classList.remove("in");
        void sh.offsetWidth;
      }
      sh.classList.add("in");
      sh.querySelector("[data-action=simple-close]").focus({ preventScroll: true });
    } else {
      sheetShift();
      sh.classList.remove("in");
      const done = () => {
        sh.hidden = true;
      };
      if (S.reduced) done();
      else setTimeout(done, 260);
      $("simpleBtn").focus({ preventScroll: true });
    }
  }

  const touchOnly = () => window.matchMedia("(hover: none)").matches;
  // a one-line caption for the newcomer, with the full caption one click away for the expert
  function shortCap(id, short, full, more) {
    const c = $(id);
    c.innerHTML =
      "<span class='cap-s'>" +
      short +
      "</span> <button type='button' class='cap-more' aria-expanded='false' data-more='" +
      (more || "full caption") +
      "' data-less='" +
      (more ? "less" : "short caption") +
      "' aria-controls='" +
      id +
      "-f'>" +
      (more || "full caption") +
      "</button><span class='cap-f' id='" +
      id +
      "-f' hidden>" +
      full +
      "</span>";
  }
  function toggleCap(btn) {
    const c = btn.parentElement,
      f = c.querySelector(".cap-f"),
      open = f.hidden;
    f.hidden = !open;
    c.querySelector(".cap-s").hidden = open;
    btn.textContent = open ? btn.dataset.less : btn.dataset.more;
    btn.setAttribute("aria-expanded", open);
    c.appendChild(btn); // the button follows whichever caption is showing
  }
  // plain definitions on the few words the argument turns on; one per term per block
  const DEFS = [
    [
      "same",
      /\bsame-setup\b/,
      "Same setup: measured on the same data split, with the same metric and unit, so the numbers can be compared.",
    ],
    [
      "test",
      /\btest split\b/,
      "Test split: data held back for the final measurement. It is the score a leaderboard is meant to rank.",
    ],
    [
      "val",
      /\bvalidation split\b/,
      "Validation split: data used while a method is being tuned, so a score on it is not the final test.",
    ],
    [
      "other",
      /\bother splits?\b/,
      "Other split: any data split that is not the test split, most often the validation data used for tuning.",
    ],
    [
      "none",
      /\bnot stated\b/,
      "Not stated: the paper does not say which split it measured on, so the record cannot be compared.",
    ],
  ];
  function addDefs(root) {
    if (!root || S.present) return;
    DEFS.forEach(([k, re, def]) => {
      if (root.querySelector("dfn[data-k='" + k + "']")) return;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.parentElement.closest(".term,button,a,svg")) continue;
        const m = n.data.match(re);
        if (!m) continue;
        const r = n.splitText(m.index);
        r.splitText(m[0].length);
        const d = document.createElement("dfn");
        d.className = "term";
        d.tabIndex = 0;
        d.dataset.k = k;
        d.dataset.def = def;
        r.parentNode.replaceChild(d, r);
        d.appendChild(r);
        return;
      }
    });
  }
  // one shared note for every definition, kept inside the screen
  function showDef(d) {
    const tip = $("defTip");
    tip.textContent = d.dataset.def;
    tip.hidden = false;
    d.setAttribute("aria-describedby", "defTip");
    const r = d.getBoundingClientRect(),
      w = tip.offsetWidth,
      h = tip.offsetHeight,
      vw = document.documentElement.clientWidth,
      x = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2)),
      below = r.bottom + 8 + h < window.innerHeight - 8;
    tip.style.left = x + scrollX + "px";
    tip.style.top = (below ? r.bottom + 8 : r.top - 8 - h) + scrollY + "px";
    S.defOn = d;
  }
  function hideDef() {
    if (!S.defOn) return;
    S.defOn.removeAttribute("aria-describedby");
    S.defOn = null;
    $("defTip").hidden = true;
  }
  // ------------------------------------------------------------------ static chrome
  function renderStatic() {
    const st = S.meta.stats,
      sq = st.status_counts && st.status_counts.Q_official,
      fair = sq ? (sq.robust || 0) + (sq.conditional || 0) : 0; // leaderboards with a same-setup answer on test
    $("deck").innerHTML =
      "Leaderboards rank one number. Papers measure it under different setups. This site sets the two side by side, for every leaderboard in a frozen archive.";
    $("kicker").innerHTML =
      "<span><b>" +
      fmtN(st.winner_changes) +
      "</b> of " +
      fmtN(st.query_conditioned_boards) +
      " rankable leaderboards name a different winner when only same-setup results compete" +
      (fair
        ? "<small class='denom'>That is about 1 in " +
          Math.round(fair / st.winner_changes) +
          " of the " +
          fmtN(fair) +
          " leaderboards where a same-setup answer exists.</small>"
        : "") +
      "</span><a class='deck-err' href='#erratumFig'><b class='red'>14</b> of 56 hand-checked records had a wrong label</a>";
    $("examples").innerHTML =
      "<span class='lab'>Six cases from the paper <i>· choose one, or search any leaderboard</i></span>" +
      S.examples
        .map(
          (e, k) =>
            "<button type='button' class='ex' data-action='example' data-n='" +
            e.n +
            "'><span class='ex-k'>" +
            (k + 1) +
            "</span><span class='ex-t'><span class='ex-n'>" +
            esc(EX_SHORT[e.board] || e.label.replace(/ \(.*\)$/, "").replace(" by year", "")) +
            "</span><span class='ex-r'>" +
            esc(EX_REASON[e.n] || "") +
            "</span></span></button>",
        )
        .join("");
    $("templateHelp").innerHTML = S.templates.templates
      .map(
        (t) =>
          "<div><b>" +
          esc(ASK_LABEL[t.name] || "The leaderboard says (the baseline the three questions are compared with)") +
          "</b><br>" +
          esc(QUESTION_TEXT[t.name] || "") +
          "<br><span class='muted'>Must match: " +
          (t.must_agree_facets.length
            ? esc(t.must_agree_facets.map((f) => FACET_PLAIN[f] || f).join(", "))
            : "nothing") +
          (t.restrictions.length && t.restrictions[0].op === "equals" ? "; test split only" : "") +
          (t.restrictions.length && t.restrictions[0].op === "partition_by" ? "; grouped by preprint year" : "") +
          "</span></div>",
      )
      .join("");
    // the hand check: one mark per checked record, then what was found, then what it means
    const AL = S.auditList || [],
      vc = (v) => AL.filter((r) => r.verdict === v).length,
      nOk = vc("ok"),
      nBad = vc("wrong_split") + vc("wrong_value"),
      nMiss = vc("missing"),
      nUns = vc("unsure"),
      order = [
        ...Array(nOk).fill("ok"),
        ...Array(nBad).fill("bad"),
        ...Array(nMiss).fill("miss"),
        ...Array(nUns).fill("uns"),
      ];
    $("auditText").innerHTML =
      "<p>Split, metric and unit labels were extracted automatically from the papers. Using the same pointers shown on this site, one person checked " +
      AL.length +
      " displayed records against their papers.</p>" +
      "<svg class='audit-strip' viewBox='0 0 " +
      order.length * 10 +
      " 26' role='img' aria-label='" +
      AL.length +
      " checked records: " +
      nOk +
      " confirmed, " +
      nBad +
      " with a wrong label, " +
      nMiss +
      " incomplete, " +
      nUns +
      " unclear'>" +
      order
        .map((k, i) => "<rect x='" + (i * 10 + 2) + "' y='2' width='6' height='22' class='as-" + k + "'/>")
        .join("") +
      "</svg>" +
      "<ul class='audit-key'><li><i class='ak ok'></i>" +
      nOk +
      " confirmed</li><li class='red'><i class='ak bad'></i>" +
      nBad +
      " with a wrong label</li><li><i class='ak miss'></i>" +
      nMiss +
      " incomplete</li><li><i class='ak uns'></i>" +
      nUns +
      " unclear</li></ul>" +
      "<p>The " +
      nBad +
      " wrong labels were of three kinds:</p><ul class='audit-kinds'><li>6 validation (development) values stored as test</li><li>3 values read from a neighbouring column or row</li><li>5 records whose paper states a split that the record gives wrongly or leaves out</li></ul>" +
      "<p>The incomplete record’s paper reports a better same-method test value that is not in the data, which disputes the RefCOCOg winner change. RefCOCOg still counts among the 120, because every count here is computed from the stored records, and it is marked as disputed wherever it appears.</p>" +
      "<p class='muted'>These records were drawn from boards with differing answers or too little evidence, so this is not an error rate for all the data. The worked examples use records that passed, except GoPro’s fair answer, whose split label is unclear; its caveat says so. Elsewhere, read a fair comparison as the best <i>recorded</i> value for that question, and follow the pointer to confirm it.</p>";
    $("downloads").innerHTML =
      "<li><a href='data/release/comparability_certificates.jsonl'>Comparability determinations</a> <span class='muted'>" +
      fmtN(st.certificates) +
      " decisions, one per line</span></li>" +
      "<li><a href='data/release/comparability_certificate.schema.json'>Schema</a> <span class='muted'>for the file above</span></li>" +
      "<li><a href='data/release/query_templates.json'>Question templates</a> <span class='muted'>the four questions, as data</span></li>" +
      "<li><a href='data/release/query_conditioned_by_leaderboard.jsonl'>Saved answers</a> <span class='muted'>every leaderboard’s answer to each question</span></li>" +
      "<li><a href='data/release/SHA256SUMS'>Checksums</a> <span class='muted'>to verify the files</span></li>" +
      "<li>Hand audit <span class='muted'>as <a href='data/audit/hand_audit.json'>JSON</a> or <a href='data/audit/hand_audit.csv'>CSV</a></span></li>";
    $("licence").innerHTML =
      "Data: <a href='https://creativecommons.org/licenses/by-sa/4.0/' target='_blank' rel='noopener'>CC BY-SA 4.0</a>. Evidence is given as pointers only (arXiv id, abstract URL, source location); no paper text is redistributed. All data are frozen and precomputed. No server and no model calls.";
    $("footStats").innerHTML =
      "<span>" +
      fmtN(st.boards) +
      " leaderboards</span><span>" +
      fmtN(st.entries) +
      " result records · " +
      fmtN(st.ranked_entries) +
      " with a full setup</span><span>" +
      fmtN(st.certificates) +
      " comparability determinations</span><span>No server and no model calls</span>";
    $("footLinks").innerHTML =
      "<span>frozen Papers with Code archive " +
      esc(S.meta.snapshot.replace(/.*frozen /, "")) +
      "</span><span>DOI <a href='https://doi.org/" +
      esc(S.meta.doi_version) +
      "' target='_blank' rel='noopener'>" +
      esc(S.meta.doi_version) +
      "</a></span><span><a href='" +
      esc(S.meta.repo_url) +
      "' target='_blank' rel='noopener'>dataset</a></span><span><a href='" +
      esc(S.meta.demo_repo_url) +
      "' target='_blank' rel='noopener'>demo source</a></span><span>CC BY-SA 4.0</span>";
    $("presentStats").innerHTML =
      "<span><b>" +
      fmtN(st.winner_changes) +
      "</b> of " +
      fmtN(st.query_conditioned_boards) +
      " rankable leaderboards name a different winner</span><span><b class='red'>14</b> of 56 hand-checked records had a wrong label</span><span class='pstep' id='presentStep'></span>";
  }
  function fillFindList() {
    const dl = $("findList");
    const seen = new Set();
    S.index.slice(0, 4000).forEach((r) => {
      if (!seen.has(r.dataset)) {
        seen.add(r.dataset);
        const o = document.createElement("option");
        o.value = r.dataset;
        dl.appendChild(o);
      }
    });
  }

  // ------------------------------------------------------------------ board page
  function renderBoardPage(full) {
    const b = S.board,
      ex = S.examples.find((e) => e.board === b.id && e.template === S.tmpl);
    document.querySelectorAll("#examples .ex").forEach((c) => {
      const e = S.examples.find((x) => x.n === +c.dataset.n);
      const chosen = S.examples.find((x) => x.n === S.exN);
      const on =
        chosen && chosen.board === b.id
          ? e === chosen
          : !!e &&
            e.board === b.id &&
            (e.template === S.tmpl || (e.template !== "Q_threshold" && S.tmpl !== "Q_threshold"));
      c.classList.toggle("on", on);
      if (on) c.setAttribute("aria-current", "true");
      else c.removeAttribute("aria-current");
    });
    $("ask").innerHTML = askText();
    const task = TASK_GLOSS[b.id];
    $("gloss").textContent =
      (task ? task + " " : "") + (b.scored ? dirWord().replace(/^./, (c) => c.toUpperCase()) + "." : "");
    $("modeSwitch").hidden = !b.scored;
    $("modeSwitch").innerHTML =
      "<span class='lab'>Ask this leaderboard</span>" +
      TEMPLATES.map(
        (t) =>
          "<button type='button' class='lk" +
          (t === S.tmpl ? " on" : "") +
          "' data-action='ask' data-t='" +
          t +
          "'>" +
          ASK_LABEL[t] +
          "</button>",
      ).join("");
    renderMix();
    renderHero();
    $("why").innerHTML = b.scored
      ? ex && ex.why
        ? ex.why
        : whyText()
      : "This leaderboard has no answer: the data do not record whether higher or lower is better on this metric, so there is no “best” to report.";
    $("why").className = "why beat-2";
    const disp =
      S.disputed && S.disputed.has(b.id)
        ? "<i class='red'>Disputed by the hand check</i> The source reports a better test value that is not in the data, so this fair answer, and the change of winner, may not hold. It still counts among the 120, because every count on this site is computed from the stored records, where errors like this are expected; the hand labels are published so anyone can check. "
        : "";
    $("caveat").hidden = !(ex && ex.caveat) && !disp;
    $("caveat").innerHTML = disp + (ex && ex.caveat ? "<i>Caveat</i> " + esc(ex.caveat) : "");
    $("pipeFig").className = "fig beat-3";
    renderPipeline();
    if (full) {
      renderErratum();
    } else {
      document.querySelectorAll("#erratum .here").forEach((e) => e.remove());
    }
    S.evDrawn = !$("evidence").hidden;
    if (S.evDrawn) {
      renderGroups();
      renderCert();
    }
    renderThreshold();
    renderTyped();
    ["kicker", "mix", "why"].forEach((id) => addDefs($(id)));
    refreshSimple();
    if (S.present) applyBeat();
  }

  // ------------------------------------------------------------------ routing
  async function loadBoard(id, t) {
    const tok = (S.navTok = (S.navTok || 0) + 1); // a slower earlier request must never draw over a later choice
    S.loading = true;
    const row = S.byId ? S.byId.get(id) : null;
    let data;
    try {
      data = await getShard(row ? row.shard : await shardOf(id));
    } catch (e) {
      if (tok !== S.navTok) return;
      S.loading = false;
      $("boardView").hidden = true;
      $("aboutView").hidden = true;
      $("spotView").hidden = true;
      $("browseView").hidden = false;
      $("browseView").innerHTML =
        "<p class='body'>This leaderboard could not be loaded (the network may have dropped). <button type='button' class='lk' data-action='retry'>Try again</button></p>";
      return;
    }
    if (tok !== S.navTok) return;
    S.loading = false;
    const b = data[id];
    if (!b) {
      $("boardView").hidden = true;
      $("aboutView").hidden = true;
      $("browseView").hidden = false;
      $("browseView").innerHTML = "<p class='body'>Leaderboard not found: " + esc(id) + "</p>";
      return;
    }
    const switching = !$("boardView").hidden && S.board && S.board.id !== id;
    S.board = b;
    S.tmpl = TEMPLATES.includes(t) ? t : "Q_official";
    S.picks = [];
    S.slot = 0;
    S.open = {};
    S.stage = -1;
    if (switching) setEvidence(false);
    $("browseView").hidden = true;
    $("aboutView").hidden = true;
    $("spotView").hidden = true;
    $("boardView").hidden = false;
    const draw = () => renderBoardPage(true);
    if (switching && document.startViewTransition && !S.reduced) document.startViewTransition(draw);
    else {
      if (switching && !S.reduced) {
        $("boardView").classList.remove("xfade");
        void $("boardView").offsetWidth;
        $("boardView").classList.add("xfade");
      }
      draw();
    }
    if (!switching) window.scrollTo(0, 0);
  }
  function setTemplate(t) {
    if (!S.board || t === S.tmpl) return;
    S.tmpl = t;
    S.slot = 0;
    history.pushState(null, "", "#q=" + encodeURIComponent(t) + "&b=" + encodeURIComponent(S.board.id));
    S.quick = !S.present; // on a projector every example starts from its claim, even on the same leaderboard
    try {
      renderBoardPage(false);
    } finally {
      S.quick = false;
    }
  }
  const go = (id, t) => {
    const h = "#q=" + encodeURIComponent(t) + "&b=" + encodeURIComponent(id);
    if (S.board && S.board.id === id && !$("boardView").hidden) {
      setTemplate(t);
      return;
    }
    history.pushState(null, "", h);
    route();
  };
  // which page is showing: the nav marks it, and the plain-words sheet explains that page
  function viewOf() {
    return location.hash === "#browse"
      ? "browse"
      : location.hash === "#blindspots"
        ? "blindspots"
        : location.hash === "#about"
          ? "about"
          : "home";
  }
  function markNav(v) {
    document.querySelectorAll(".links [data-nav]").forEach((a) => {
      if (a.dataset.nav === v) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }
  async function route() {
    markNav(viewOf());
    document.documentElement.classList.toggle("on-browse", location.hash === "#browse");
    if (location.hash === "#browse") {
      showBrowse();
      return;
    }
    if (location.hash === "#blindspots") {
      showBlindspots();
      return;
    }
    if (location.hash === "#about") {
      $("boardView").hidden = true;
      $("browseView").hidden = true;
      $("spotView").hidden = true;
      $("aboutView").hidden = false;
      refreshSimple();
      window.scrollTo(0, 0);
      return;
    }
    const h = new URLSearchParams(location.hash.slice(1));
    let id = h.get("b"),
      t = h.get("q");
    if (!id) {
      id = S.examples[0].board;
      t = S.examples[0].template;
    }
    if (S.board && S.board.id === id && !$("boardView").hidden) {
      setTemplate(TEMPLATES.includes(t) ? t : "Q_official");
      return;
    }
    await loadBoard(id, t);
  }

  // ------------------------------------------------------------------ events
  // open (or close) a step; the same call serves the stage bar, the column and the drawer's close control
  function selectStage(i) {
    S.stage = i === S.stage ? -1 : i;
    document.querySelectorAll("#stageLine .lk[data-s], #stageBar .stg").forEach((b) => {
      b.classList.toggle("on", +b.dataset.s === S.stage);
      if (b.classList.contains("stg")) b.setAttribute("aria-pressed", +b.dataset.s === S.stage);
    });
    renderPeek();
    if (S.stage >= 0) keepStageInView();
    if (S.stage >= 0 && S.kbd) {
      const h = $("peek").querySelector("h4");
      if (h) {
        h.tabIndex = -1;
        h.focus({ preventScroll: true });
      }
    }
  }
  // which pipeline column the pointer is in: the whole column is one target, marks and rules included
  function colAt(e) {
    const svg = e.target.closest ? e.target.closest("#pipe svg") : null;
    if (!svg || S.present) return null;
    const r = svg.getBoundingClientRect();
    return Math.max(0, Math.min(4, Math.floor(((e.clientX - r.left) / r.width) * 5)));
  }
  function onClick(e) {
    S.kbd = e.detail === 0; // a click with no pointer: Enter or Space on a focused control
    const cm = e.target.closest(".cap-more");
    if (cm) return toggleCap(cm);
    // on a touch screen there is no hover, so a tap on Fig. 1 shows or hides its sources
    if (touchOnly() && e.target.closest("#hero")) $("heroFig").classList.toggle("src-on");
    const col = colAt(e);
    if (col != null) {
      selectStage(col);
      return;
    }
    const a = e.target.closest("[data-action]");
    const tr = e.target.closest("tr[data-rid], tr[data-id]");
    const mk = e.target.closest("#groups .mk.pick");
    if (a) {
      const act = a.dataset.action;
      if (act === "ask") {
        setTemplate(a.dataset.t);
        toFig();
        return;
      }
      if (act === "example") {
        const ex = S.examples.find((x) => x.n === +a.dataset.n);
        S.exN = ex.n; // the case the reader chose stays marked, even if they then ask it another question
        go(ex.board, ex.template);
        toFig();
        return;
      }
      if (act === "stage") {
        selectStage(+a.dataset.s);
        return;
      }
      if (act === "replay") {
        runFlow();
        return;
      }
      if (act === "slot") {
        S.slot = +a.dataset.i;
        renderCert();
        return;
      }
      if (act === "more") {
        S.open[a.dataset.open] = !S.open[a.dataset.open];
        renderGroups();
        return;
      }
      if (act === "bfilter") {
        S.browse.f = a.dataset.f;
        document.querySelectorAll("[data-action=bfilter]").forEach((b) => b.classList.toggle("on", b === a));
        filterBrowse();
        return;
      }
      if (act === "bmore") {
        S.browse.shown += 100;
        drawRows();
        return;
      }
      if (act === "theme") {
        toggleTheme();
        return;
      }
      if (act === "simple") {
        setSimple($("simple").hidden);
        return;
      }
      if (act === "simple-close") {
        setSimple(false);
        return;
      }
      if (act === "spotf") {
        S.spot.f = a.dataset.f;
        S.spot.shown = 40;
        document.querySelectorAll("[data-action=spotf]").forEach((b) => b.classList.toggle("on", b === a));
        drawSpots();
        return;
      }
      if (act === "spotsort") {
        S.spot.sort = a.dataset.s;
        S.spot.shown = 40;
        document.querySelectorAll("[data-action=spotsort]").forEach((b) => b.classList.toggle("on", b === a));
        drawSpots();
        return;
      }
      if (act === "spotmore") {
        S.spot.shown += 40;
        drawSpots();
        return;
      }
      if (act === "evidence") {
        setEvidence($("evidence").hidden);
        // keep the toggle where it is; only nudge the page if the opened evidence starts below the screen
        if (!$("evidence").hidden && $("evidence").getBoundingClientRect().top > window.innerHeight - 120)
          window.scrollBy({ top: 240, behavior: S.reduced ? "auto" : "smooth" });
        return;
      }
      if (act === "retry") {
        route();
        return;
      }
      if (act === "home") {
        e.preventDefault();
        history.pushState(null, "", "#");
        route();
        return;
      }
    }
    const sp = e.target.closest(".spot[data-id]");
    if (sp && !e.target.closest("a")) {
      e.preventDefault();
      history.pushState(null, "", "#q=Q_official&b=" + encodeURIComponent(sp.dataset.id));
      route();
      return;
    }
    if (tr && tr.dataset.id && !e.target.closest("a")) {
      e.preventDefault();
      history.pushState(null, "", "#q=Q_official&b=" + encodeURIComponent(tr.dataset.id));
      route();
      return;
    }
    if ((tr && tr.dataset.rid != null && !e.target.closest("a")) || mk) {
      const rid = +(mk ? mk.dataset.rid : tr.dataset.rid);
      pick(rid);
      return;
    }
    const cell = e.target.closest("#census use.cell");
    if (cell) {
      const x = S.browse.rows[+cell.dataset.i];
      history.pushState(null, "", "#q=Q_official&b=" + encodeURIComponent(x.r.id));
      route();
    }
  }
  function toFig() {
    if (S.present) return;
    requestAnimationFrame(() => {
      const t = $("ask").getBoundingClientRect().top;
      if (t < 0 || t > window.innerHeight * 0.6) window.scrollTo({ top: window.scrollY + t - 16, behavior: "auto" }); // jump first, so the redraw is seen from its start
    });
  }
  function setEvidence(open) {
    $("evidence").hidden = !open;
    $("evidenceBtn").setAttribute("aria-expanded", open);
    $("evidenceLabel").textContent = open ? "Hide the evidence" : "Show the evidence";
    document.querySelector("#evidenceBtn .reveal-mark").textContent = open ? "−" : "+";
    if (open && !S.evDrawn) {
      S.evDrawn = true;
      renderGroups();
      renderCert();
    }
  }
  function pick(rid) {
    if ($("evidence").hidden) setEvidence(true);
    if (S.picks.includes(rid)) S.picks = S.picks.filter((x) => x !== rid);
    else S.picks = S.picks.length >= 2 ? [rid] : S.picks.concat(rid);
    if (S.picks.length === 2) S.slot = 0;
    renderGroups();
    renderCert();
    if (S.picks.length === 2) $("certHead").scrollIntoView({ behavior: S.reduced ? "auto" : "smooth", block: "start" });
  }
  function ticketFor(rid, boardId) {
    if (boardId && boardId !== (S.board && S.board.id)) {
      const a = S.auditList.find((x) => x.board === boardId && x.rid === rid);
      const row = S.byId && S.byId.get(boardId);
      return a
        ? "<b>" +
            esc(a.method) +
            " " +
            val(a.value) +
            "</b>" +
            esc(row ? row.dataset + " · " + row.metric : boardId) +
            "<br>stored " +
            esc(a.split || "no split") +
            " · " +
            esc(a.verdict.replace("_", " ")) +
            (a.split_per_source ? " (source: " + esc(a.split_per_source) + ")" : "")
        : "";
    }
    const r = rec(rid);
    if (!r) return "";
    const a = auditOf(r);
    return (
      "<b>" +
      esc(r.method) +
      " " +
      val(r.value) +
      "</b>" +
      esc(splitWord(r.proto)) +
      (r.proto.metric_surface ? " · " + esc(r.proto.metric_surface) : "") +
      (r.proto.unit ? " · " + esc(r.proto.unit) : "") +
      "<br>" +
      (r.arxiv_id ? "arXiv:" + esc(r.arxiv_id) : "no arXiv id") +
      " · " +
      pointer(r.source_location) +
      (a ? "<br>" + esc((VERDICT[a.verdict] || ["", "hand-checked"])[1]) : "")
    );
  }
  function onPointer(e) {
    const tk = $("ticket");
    // Browse census: one moving highlight and the shared ticket, instead of a title on every glyph
    const cell = e.target.closest ? e.target.closest("#census use.cell") : null;
    const hiOld = document.querySelector("#census .hi");
    if (cell) {
      const x = S.browse.rows[+cell.dataset.i],
        svg = cell.ownerSVGElement;
      let hi = svg.querySelector(".hi");
      if (hiOld && hiOld !== hi) hiOld.remove();
      if (!hi) hi = el("rect", { class: "hi", rx: 1.5, fill: "none", stroke: "var(--ink)", "stroke-width": 1.4 }, svg);
      ["x", "y", "width", "height"].forEach((k) => hi.setAttribute(k, cell.getAttribute(k)));
      if (S.spots && !S.spotById) S.spotById = new Map(S.spots.map((q) => [S.index[q.i].id, q]));
      const sp = S.spotById && S.spotById.get(x.r.id);
      tk.innerHTML =
        "<b>" +
        esc(x.r.dataset) +
        "</b>" +
        esc(metricName(x.r.metric)) +
        " · " +
        x.r.n +
        (x.r.n === 1 ? " record · " : " records · ") +
        OUTCOME[x.oc].toLowerCase() +
        (sp && sp.fair && sp.fair[0] != null
          ? "<br>leaderboard says " + val(sp.top[1]) + " · same setup " + val(sp.fair[1])
          : "");
      tk.hidden = false;
      tk.style.left = Math.min(window.innerWidth - 340, e.clientX + 14) + "px";
      tk.style.top = e.clientY + 16 + "px";
      return;
    }
    if (hiOld) hiOld.remove();
    // a row in an opened step points at its record in the figure above
    const hr = e.target.closest ? e.target.closest("#peek tr[data-hl]") : null;
    const mk = hr
      ? document.querySelector("#pipe .mk[data-rid='" + hr.dataset.hl + "']")
      : e.target.closest
        ? e.target.closest(".mk")
        : null;
    if (mk === S.lastMk && mk) return; // same mark: nothing to redo
    S.lastMk = mk;
    document.querySelectorAll(".mk.on").forEach((m) => {
      if (!m.classList.contains("pick") || !S.picks.includes(+m.dataset.rid)) m.classList.remove("on");
    });
    document.querySelectorAll(".pipe-host .lit").forEach((g) => g.classList.remove("lit"));
    if (!mk) {
      tk.hidden = true;
      return;
    }
    const rid = mk.dataset.rid,
      bid = mk.dataset.board;
    if (rid === "" || rid == null) {
      tk.hidden = true;
      return;
    }
    if (!bid || bid === S.board.id) {
      document.querySelectorAll(".mk[data-rid='" + rid + "']").forEach((m) => {
        if (!m.dataset.board || m.dataset.board === S.board.id) m.classList.add("on");
      });
      $("pipe").querySelector("svg") && $("pipe").querySelector("svg").classList.add("lit");
    }
    tk.innerHTML = ticketFor(+rid, bid);
    tk.hidden = !tk.innerHTML || !!hr; // a hovered row already says what the ticket would
    const x = Math.min(window.innerWidth - 340, e.clientX + 14),
      y = e.clientY + 16;
    tk.style.left = x + "px";
    tk.style.top = y + "px";
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const dark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    const swap = () => document.documentElement.setAttribute("data-theme", next);
    // a short cross-fade between themes where the browser supports it; otherwise an instant switch
    if (document.startViewTransition && !S.reduced) document.startViewTransition(swap);
    else swap();
    try {
      localStorage.setItem("lc-theme", next);
    } catch (e) {
      /* storage blocked: the choice lasts for this visit */
    }
    $("themeBtn").querySelector(".nl").textContent = next === "dark" ? "Light" : "Dark";
  }

  // ------------------------------------------------------------------ presentation mode
  function setPresent(on) {
    // entering starts the talk at the top; leaving returns the reader to where they were
    if (on && !S.present) S.preScroll = window.scrollY;
    S.present = on;
    document.documentElement.classList.toggle("present", on);
    S.beat = on ? 0 : 3;
    applyBeat();
    if (S.board) renderBoardPage(false);
    sheetShift(); // fullscreen stays on the F key; the plain-words sheet is hidden while presenting
    window.scrollTo(0, on ? 0 : S.preScroll || 0);
  }
  /* present: a step's entrance animations ran (invisibly) when the board was drawn; replay them the moment the
     step is revealed, shifted so they start right away instead of at their page-load delay */
  function replayBeat(n) {
    if (S.reduced) return;
    const els = [];
    document.querySelectorAll("#hero .beat-" + n).forEach((grp) =>
      [grp, ...grp.querySelectorAll("*")].forEach((e) => {
        if (!e.getAnimations || !e.getAnimations().length) return;
        if (e.dataset.d0 == null) e.dataset.d0 = parseFloat(e.style.animationDelay) || 0;
        els.push(e);
      }),
    );
    if (!els.length) return;
    // keep the step's own choreography, but start it 60 ms after the reveal
    const min = Math.min(...els.map((e) => +e.dataset.d0));
    els.forEach((e) => {
      e.style.animationDelay = Math.round(60 + (e.dataset.d0 - min) * 0.55) + "ms"; // same order, about half the gaps
      e.getAnimations().forEach((a) => {
        a.cancel();
        a.play();
      });
    });
  }
  function applyBeat() {
    const h = document.documentElement;
    const prev = S.shownBeat == null ? -1 : S.shownBeat;
    ["b0", "b1", "b2", "b3"].forEach((c) => h.classList.remove(c));
    if (S.present) h.classList.add("b" + S.beat);
    S.shownBeat = S.present ? S.beat : null;
    if (S.held && S.beat > 1) {
      // arrived past step 2 directly (going back from the next example): show the settled state
      S.held.forEach((a) => a.finish());
      S.held = null;
    }
    if (S.present && S.beat === 1 && prev === 0) {
      if (S.held) S.held.forEach((a) => a.play());
      S.held = null;
      replayBeat(1);
    }
    const ind = $("presentStep");
    if (ind && S.board) {
      const i = S.examples.findIndex((e) => e.board === S.board.id && e.template === S.tmpl);
      ind.textContent =
        (i >= 0 ? "example " + (i + 1) + " of " + S.examples.length + " · " : "") +
        "step " +
        (S.beat + 1) +
        " of 4 · " +
        (i === S.examples.length - 1 && S.beat === 3 ? "end · ← back" : "→ next") +
        " · Esc to leave";
    }
  }
  function exampleStep(dir) {
    const i = S.examples.findIndex((e) => e.board === S.board.id && e.template === S.tmpl);
    let j = i < 0 ? 0 : i + dir;
    if (j < 0 || j >= S.examples.length) return false;
    const ex = S.examples[j];
    go(ex.board, ex.template);
    return true;
  }
  function onKey(e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "Escape" && S.defOn) return hideDef();
    if (e.key === "Escape" && !S.present) {
      if (!$("simple").hidden) return setSimple(false);
      if (S.stage >= 0) {
        const s0 = S.stage;
        selectStage(s0);
        const b = document.querySelector("#stageBar .stg[data-s='" + s0 + "']");
        if (b && b.offsetParent) b.focus({ preventScroll: true });
        return;
      }
      if (!$("evidence").hidden) {
        setEvidence(false);
        $("evidenceBtn").focus({ preventScroll: true });
        return;
      }
      return;
    }
    if (e.key === "Enter" && e.target && e.target.classList && e.target.classList.contains("spot")) {
      e.target.click();
      return;
    }
    if (e.key === "P" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setPresent(!S.present);
      return;
    }
    if (!S.present) return;
    if (e.key === "Escape") {
      setPresent(false);
      return;
    }
    if (e.key === "ArrowRight") {
      if (e.repeat || S.loading) return; // a held key or a pending board must not skip steps
      if (S.beat < 3) {
        S.beat++;
        applyBeat();
        if (S.beat === 3 && !S.reduced) {
          // let the hero fold away first, then run the pipeline on its own slide
          runFlow(300); // primed now, so the slide never shows the finished state before the run
        }
      } else {
        // the next example is drawn at step 1, so its claim is held back like the first one's
        S.beat = 0;
        if (exampleStep(1)) applyBeat();
        else S.beat = 3;
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      if (e.repeat || S.loading) return;
      if (S.beat > 0) {
        S.beat--;
        applyBeat();
      } else {
        S.beat = 3;
        if (exampleStep(-1)) applyBeat();
        else S.beat = 0;
      }
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (!S.reduced) runFlow();
      return;
    }
    if (e.key === "f" || e.key === "F") {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      return;
    }
    if (/^[1-5]$/.test(e.key)) {
      const i = +e.key - 1;
      S.stage = i === S.stage ? -1 : i;
      renderPeek();
    }
  }

  // ------------------------------------------------------------------ init
  async function init() {
    S.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || /[?&]still\b/.test(location.search);
    try {
      const t = localStorage.getItem("lc-theme");
      if (t) {
        document.documentElement.setAttribute("data-theme", t);
        $("themeBtn").querySelector(".nl").textContent = t === "dark" ? "Light" : "Dark";
      } else
        $("themeBtn").querySelector(".nl").textContent = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "Light"
          : "Dark";
    } catch (e) {
      /* storage blocked: follow the system theme */
    }
    const h = new URLSearchParams(location.hash.slice(1));
    const wantId =
      location.hash === "#browse" || location.hash === "#about" || location.hash === "#blindspots" ? null : h.get("b");
    const [meta, templates, examples, audit] = await Promise.all([
      getJSON("data/meta.json"),
      getJSON("data/templates.json"),
      getJSON("data/examples.json"),
      getJSON("data/audit/hand_audit.json").catch(() => ({ records: [] })),
    ]);
    Object.assign(S, { meta, templates, examples });
    S.audit = new Map();
    S.auditBoards = new Map();
    S.auditList = [];
    S.disputed = new Set(audit.records.filter((r) => r.verdict === "missing").map((r) => r.board));
    audit.records.forEach((r) => {
      S.audit.set(r.board + "#" + r.rid, r);
      const level = r.verdict === "wrong_split" || r.verdict === "wrong_value" ? 2 : r.verdict === "unsure" ? 1 : 0;
      S.auditBoards.set(r.board, Math.max(S.auditBoards.get(r.board) || 0, level));
    });
    // the first board: shard fetched in parallel with the index, which is only needed for browse / the erratum labels
    const firstId = wantId || examples[0].board;
    const shardP = shardOf(firstId)
      .then(getShard)
      .catch(() => {});
    // the 1 MB index serves Browse, Blindspots, the search list and the erratum labels; the first answer does not wait for it
    S.indexP = getJSON("data/index.json").then((index) => {
      S.index = index;
      S.byId = new Map(index.map((r) => [r.id, r]));
    });
    await shardP;
    // audit list needs record details: resolve lazily from shards already loaded, else from index (method/value come from the audit file)
    S.auditList = audit.records.map((r) => ({
      board: r.board,
      rid: r.rid,
      verdict: r.verdict,
      split_per_source: r.split_per_source,
      notes: r.notes,
      method: r.method || "",
      value: r.value != null ? r.value : 0,
      split: r.split || null,
    }));
    renderStatic();
    document.addEventListener("click", onClick);
    document.addEventListener("pointerover", onPointer);
    // a step is one target: its header cell and its column light together, whichever one the pointer is over
    document.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const t = e.target.closest ? e.target.closest("#stageBar .stg") : null,
        c = t ? null : colAt(e),
        k = t ? t.dataset.s : c != null ? String(c) : null;
      if (k === S.hovStage) return;
      S.hovStage = k;
      document
        .querySelectorAll("#stageBar .stg, #pipe .colhit")
        .forEach((n) => n.classList.toggle("hov", n.dataset.s === k));
    });
    document.addEventListener("pointerout", (e) => {
      if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest(".mk"))
        onPointer({ target: document.body, clientX: 0, clientY: 0 });
    });
    document.addEventListener("keydown", onKey);
    // definitions: a mouse shows them on hover; a keyboard or a tap shows them on focus
    document.addEventListener("pointerover", (e) => {
      const d = e.target.closest && e.target.closest("dfn.term");
      if (d && e.pointerType === "mouse") showDef(d);
    });
    document.addEventListener("pointerout", (e) => {
      const d = e.target.closest && e.target.closest("dfn.term");
      if (d && e.pointerType === "mouse" && document.activeElement !== d) hideDef();
    });
    document.addEventListener("focusin", (e) => {
      if (e.target.matches && e.target.matches("dfn.term")) showDef(e.target);
    });
    document.addEventListener("focusout", (e) => {
      if (e.target.matches && e.target.matches("dfn.term")) hideDef();
    });
    addEventListener("scroll", hideDef, { passive: true });
    addEventListener("resize", hideDef);
    $("findForm").addEventListener("submit", (e) => {
      e.preventDefault();
      history.pushState(null, "", "#browse");
      showBrowse($("find").value);
    });
    window.addEventListener("scroll", sheetTop, { passive: true });
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);
    let wasNarrow = window.matchMedia("(max-width: 760px)").matches;
    window.addEventListener("resize", () => {
      clearTimeout(S.rz);
      if (S.present && S.board) S.rz = setTimeout(() => renderBoardPage(false), 200); // the slide's proportions changed
      sheetShift();
      const n = window.matchMedia("(max-width: 760px)").matches;
      if (n !== wasNarrow) {
        wasNarrow = n;
        if (S.board && !$("boardView").hidden) renderBoardPage(true);
      }
    });
    if (/[?&]present\b/.test(location.search)) setPresent(true);
    await route();
    // then, off the critical path: the index, the search list, and the hand-checked records behind the erratum
    await S.indexP;
    fillFindList();
    await hydrateAudit();
    S.auditReady = true;
    if (S.board && !$("boardView").hidden) renderErratum();
  }
  async function hydrateAudit() {
    const need = [...new Set(S.auditList.map((a) => a.board))].filter((bid) => S.byId.get(bid));
    const shards = await Promise.all(need.map((bid) => getShard(S.byId.get(bid).shard).catch(() => ({}))));
    need.forEach((bid, k) => {
      const b = shards[k][bid];
      if (!b) return;
      S.auditList
        .filter((a) => a.board === bid)
        .forEach((a) => {
          const r = b.records[a.rid];
          if (r) {
            a.method = r.method;
            a.value = r.value;
            a.split = r.proto ? r.proto.split : null;
          }
        });
    });
  }

  init().catch((e) => {
    $("ask").textContent =
      "Could not load the saved data (" +
      e.message +
      "). If you opened this file directly, serve the folder over HTTP instead.";
    console.error(e);
  });
})();
