/* Protocol-qualified leaderboard explorer. Static, no backend: every answer is precomputed
   by build/precompute.py from frozen data and only read here. */
(function () {
  "use strict";

  const TEMPLATES = ["Q_official", "Q_trend", "Q_threshold", "Q_any"];
  const TEMPLATE_LABEL = {
    Q_official: "Q_official: best under the official (test) protocol",
    Q_trend: "Q_trend: best per publication year",
    Q_threshold: "Q_threshold: does the official lead survive?",
    Q_any: "Q_any: best raw number (naive)",
  };
  const STATUS_LABEL = { robust: "robust", conditional: "conditional", insufficient: "insufficient evidence" };

  const S = {
    meta: null, templates: null, index: [], examples: [], shards: {},
    board: null, tmpl: "Q_official", picks: [], slot: 0, exampleN: null,
  };

  // ------------------------------------------------------------------ helpers
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : esc(n));
  const val = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(6)));
  const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });

  function pointer(loc) {
    if (!loc) return "location not recorded for this entry";
    const [kind, ...rest] = loc.split(":");
    const v = rest.join(":");
    if (kind === "table") return "extracted table #" + esc(v) + " (parser order)";
    if (kind === "figure") return "extracted figure #" + esc(v) + " (parser order)";
    if (kind === "section") return "section “" + esc(v) + "”";
    if (kind === "abstract") return "abstract";
    return esc(loc);
  }
  function paperLink(r) {
    if (!r.arxiv_id) return "<span class='muted'>no arXiv id</span>";
    const url = r.abs_url || "https://arxiv.org/abs/" + r.arxiv_id;
    return "<a href='" + esc(url) + "' target='_blank' rel='noopener'>arXiv:" + esc(r.arxiv_id) + "</a>";
  }
  function protoChips(p) {
    const f = (k, label) => {
      const v = p ? p[k] : null;
      if (v == null) return "<span class='pchip missing' title='" + label + " not recorded in the extracted data'>" + label + ": not recorded</span>";
      let cls = "pchip";
      if (k === "split") cls += v === "test" ? " split-test" : " split-other";
      return "<span class='" + cls + "' title='" + label + "'>" + label + ": " + esc(v) + "</span>";
    };
    return "<span class='proto'>" + f("split", "split") + f("metric_surface", "metric") + f("unit", "unit") + "</span>";
  }
  function protoShort(p) {
    const sp = p && p.split != null ? p.split : null;
    const cls = sp == null ? "pchip missing" : sp === "test" ? "pchip split-test" : "pchip split-other";
    const rest = [p && p.metric_surface, p && p.unit].map((x) => (x == null ? "?" : esc(x))).join(" \u00b7 ");
    return "<span class='nowrap'><span class='" + cls + "'>" + (sp == null ? "split ?" : esc(sp)) + "</span> <span class='mono small'>" + rest + "</span></span>";
  }
  const ABBREV = { acc: "accuracy", top1acc: "top1accuracy", f1score: "f1", fscore: "f1", fmeasure: "f1", dsc: "dice", meaniou: "miou" };
  const canonLabel = (s) => { const c = String(s || "").toLowerCase().replace(/\(\s*%\s*\)/g, "").replace(/[^a-z0-9@]+/g, ""); return ABBREV[c] || c; };
  /* Interface note (not part of any certificate): two protocol groups whose split and unit agree and whose
     metric labels differ only in how they are written. Describes stored labels; changes no answer. */
  function spellingOnly(protos) {
    for (let i = 0; i < protos.length; i++) for (let j = i + 1; j < protos.length; j++) {
      const a = protos[i], b = protos[j];
      if (a.split === b.split && a.unit === b.unit && a.metric_surface !== b.metric_surface &&
          canonLabel(a.metric_surface) === canonLabel(b.metric_surface)) return true;
    }
    return false;
  }
  const SPELLING_NOTE = "<p class='note ifnote'><b>Interface note:</b> These groups differ only in how the metric is written; they may report the same metric.</p>";
  const statusChip = (s) => "<span class='status " + s + "'>" + esc(STATUS_LABEL[s] || s) + "</span>";
  const rec = (rid) => S.board.records[rid];
  const isBetter = (a, b, d) => (d === "higher" ? a > b : a < b);
  function ranked(rids) {
    const d = S.board.direction;
    return rids.map(rec).slice().sort((a, b) => (a.value === b.value ? a.rid - b.rid : (isBetter(a.value, b.value, d) ? -1 : 1)));
  }
  /* names of other records in the same set with exactly the winner's value */
  function tiedWith(rids, w) {
    const v = rec(w).value;
    return rids.filter((i) => i !== w && rec(i).value === v).map((i) => rec(i).method);
  }
  const tieNote = (names) => (names.length ? " <span class='small muted'>(tied with " + names.map(esc).join(", ") + ")</span>" : "");
  const dirWord = () => (S.board.direction === "lower" ? "lower is better" : "higher is better");

  function questionText(t, b) {
    const ds = esc(b.dataset), m = esc(b.metric);
    switch (t) {
      case "Q_official": return "What is the best " + m + " on " + ds + " under the official (test) protocol?";
      case "Q_trend": return "How has the best " + m + " on " + ds + " changed by publication year?";
      case "Q_threshold": return "On " + ds + " (" + m + "), does the official champion’s lead survive protocol conditioning?";
      default: return "What is the best " + m + " on " + ds + "?";
    }
  }

  // ------------------------------------------------------------------ loading
  async function init() {
    const [meta, templates, index, examples] = await Promise.all([
      getJSON("data/meta.json"), getJSON("data/templates.json"), getJSON("data/index.json"), getJSON("data/examples.json"),
    ]);
    Object.assign(S, { meta, templates, index, examples });
    S.audit = new Map();
    try {
      const au = await getJSON("data/audit/hand_audit.json");
      au.records.forEach((r) => S.audit.set(r.board + "#" + r.rid, r));
      S.auditSummary = au.summary;
    } catch (e) { /* the audit file is optional; badges simply do not show */ }
    S.byId = new Map(index.map((r) => [r.id, r]));
    renderStatic();
    window.addEventListener("hashchange", fromHash);
    await fromHash();
  }

  async function loadBoard(id) {
    const row = S.byId.get(id);
    if (!row) return null;
    if (!S.shards[row.shard]) S.shards[row.shard] = await getJSON("data/boards/" + row.shard + ".json");
    return S.shards[row.shard][id] || null;
  }

  async function fromHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    let id = h.get("b"), t = h.get("q");
    if (!id) { const ex = S.examples[0]; id = ex.board; t = ex.template; }
    if (!TEMPLATES.includes(t)) t = "Q_official";
    S.tmpl = t;
    const b = await loadBoard(id);
    if (!b) { $("result").innerHTML = "<div class='card'>Board not found: " + esc(id) + "</div>"; return; }
    S.board = b; S.picks = []; S.slot = 0;
    const ex = S.examples.find((e) => e.board === id && e.template === t);
    S.exampleN = ex ? ex.n : null;
    render();
  }
  function go(id, t) {
    const h = "#q=" + encodeURIComponent(t) + "&b=" + encodeURIComponent(id);
    if (location.hash === h) fromHash(); else location.hash = h;
  }

  // ------------------------------------------------------------------ static parts
  function renderStatic() {
    $("tmpl").innerHTML = TEMPLATES.map((t) => "<option value='" + t + "'>" + esc(TEMPLATE_LABEL[t]) + "</option>").join("");
    $("tmpl").addEventListener("change", (e) => S.board && go(S.board.id, e.target.value));

    $("examples").innerHTML = S.examples.filter((e) => e.chip !== false).map((e) =>
      "<button class='chip' data-n='" + e.n + "'>" + esc(e.title) + "<span class='t'>" + esc(e.template) + "</span></button>").join("");
    $("examples").addEventListener("click", (e) => {
      const btn = e.target.closest(".chip"); if (!btn) return;
      const ex = S.examples.find((x) => x.n === +btn.dataset.n); go(ex.board, ex.template);
    });

    const help = S.templates.templates.map((t) =>
      "<div><b>" + esc(t.name) + "</b><br>" + esc(t.question) + "<br><span class='muted'>Must agree on: " +
      (t.must_agree_facets.length ? esc(t.must_agree_facets.join(", ")) : "nothing") +
      (t.restrictions.length && t.restrictions[0].op === "equals" ? "; split must be test" : "") +
      (t.restrictions.length && t.restrictions[0].op === "partition_by" ? "; grouped by arXiv year" : "") +
      "</span></div>").join("");
    $("templateHelp").innerHTML = help;
    const sem = S.templates.status_semantics;
    $("statusHelp").innerHTML = Object.keys(sem).map((k) => "<dt>" + statusChip(k) + "</dt><dd>" + esc(sem[k]) + "</dd>").join("") +
      "<dt class='muted'>labels</dt><dd>Split, metric and unit labels were extracted automatically from the papers. In two rounds of hand checks, 56 records were compared with the source papers: 11 had the wrong split label, 3 came from a different benchmark or table column, and 1 was unclear (the audit rows are downloadable below as <a href='data/audit/hand_audit.csv'>CSV</a>). Those records were drawn from boards with a winner change or an abstention, where errors are most likely, so this is not an error rate for the whole corpus. The worked examples show only records that passed the checks. Elsewhere, read a qualified answer as the best <i>recorded</i> value under the stated protocol, and follow the pointer to confirm it.</dd>" +
      "<dt class='muted'>missing facet</dt><dd>Two records are compared only when both report every facet the question needs. A record that is missing one stands alone, so it can never win a qualified answer.</dd>";

    const st = S.meta.stats;
    const items = [
      [st.boards, "leaderboards"], [st.entries, "entries in total"], [st.ranked_entries, "ranked entries (all three facets observed)"],
      [st.certificates, "certificates"], [st.schema_failures, "schema failures"], [st.query_conditioned_boards, "boards answerable by query"],
      [st.winner_changes, "winner changes under Q_official"],
    ];
    $("statsStrip").innerHTML = items.map(([n, l]) => "<li><b>" + fmt(n) + "</b><span>" + esc(l) + "</span></li>").join("");
    $("links").innerHTML = "Dataset: <a href='" + esc(S.meta.repo_url) + "' target='_blank' rel='noopener'>ml-result-comparability</a> · " +
      "Zenodo DOI <a href='https://doi.org/" + esc(S.meta.doi_version) + "' target='_blank' rel='noopener'>" + esc(S.meta.doi_version) + "</a> (v1.0.0; all versions: " +
      "<a href='https://doi.org/" + esc(S.meta.doi_concept) + "' target='_blank' rel='noopener'>" + esc(S.meta.doi_concept) + "</a>) · " +
      "Snapshot: " + esc(S.meta.snapshot) + ". Demo source and issue tracker: <a href='" + esc(S.meta.demo_repo_url) + "' target='_blank' rel='noopener'>ml-result-comparability-demo</a>.";
    $("licence").innerHTML = "Data on this site are licensed under <a href='https://creativecommons.org/licenses/by-sa/4.0/' target='_blank' rel='noopener'>CC-BY-SA 4.0</a>. " +
      "Evidence is given as pointers only (arXiv id, abstract URL, source location); no paper text is redistributed. All data are frozen and precomputed; this page makes no model or server calls. " +
      "Download: <a href='data/release/comparability_certificates.jsonl'>certificates</a> (" + fmt(S.meta.stats.certificates) + "), " +
      "<a href='data/release/comparability_certificate.schema.json'>certificate schema</a>, " +
      "<a href='data/release/query_templates.json'>query templates</a>, " +
      "<a href='data/release/query_conditioned_by_leaderboard.jsonl'>query-conditioned results</a>, " +
      "<a href='data/release/SHA256SUMS'>checksums</a>, hand audit (<a href='data/audit/hand_audit.json'>JSON</a>, <a href='data/audit/hand_audit.csv'>CSV</a>).";

    setupAutocomplete();
  }

  // ------------------------------------------------------------------ autocomplete
  function setupAutocomplete() {
    const input = $("boardInput"), list = $("acList");
    let items = [], active = -1;
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    S.index.forEach((r) => { r._k = norm(r.dataset + " " + r.metric); });
    function show() {
      const qs = norm(input.value);
      if (!qs) { list.hidden = true; return; }
      const toks = qs.split(" ");
      items = S.index.filter((r) => toks.every((t) => r._k.includes(t)))
        .sort((a, b) => (b.scored - a.scored) || (b.n - a.n)).slice(0, 14);
      active = items.length ? 0 : -1;
      list.innerHTML = items.length ? items.map((r, i) =>
        "<li role='option' data-i='" + i + "' aria-selected='" + (i === active) + "'><span class='ac-main'>" + esc(r.dataset) + " · " + esc(r.metric) +
        "</span><span class='ac-meta'>" + r.n + " entries" + (r.scored ? (r.flip ? " · winner changes" : "") : " · board only") + "</span></li>").join("")
        : "<li class='muted'>No matching benchmark</li>";
      list.hidden = false;
    }
    function choose(i) {
      const r = items[i]; if (!r) return;
      list.hidden = true; input.value = r.dataset + " · " + r.metric; input.blur();
      go(r.id, S.tmpl);
    }
    input.addEventListener("input", show);
    input.addEventListener("focus", () => { input.select(); });
    input.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
        list.children[active] && list.children[active].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") { e.preventDefault(); choose(active); }
      else if (e.key === "Escape") { list.hidden = true; }
    });
    list.addEventListener("mousedown", (e) => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
    document.addEventListener("click", (e) => { if (!e.target.closest(".ac")) list.hidden = true; });
  }

  // ------------------------------------------------------------------ main render
  function render() {
    const b = S.board;
    $("tmpl").value = S.tmpl;
    $("boardInput").value = b.dataset + " · " + b.metric;
    $("questionText").innerHTML = questionText(S.tmpl, b);
    const parentN = (() => { const e = S.examples.find((x) => x.n === S.exampleN); if (!e) return null;
      if (e.chip === false) { const p = S.examples.find((x) => x.followup === e.n); return p ? p.n : null; } return e.n; })();
    [...$("examples").children].forEach((c) => c.classList.toggle("active", +c.dataset.n === parentN));
    const ex = S.examples.find((e) => e.n === S.exampleN);

    if (!b.scored) {
      $("result").innerHTML = "<div class='card abstain'><div class='big'>Not answerable as a query</div><p>This board is shown for inspection only: " +
        esc(b.unscored_reason) + ". Without a known metric direction there is no “best” to report, so no template is evaluated on it.</p></div>";
      $("certSection").hidden = true;
    } else {
      const fu = ex && ex.followup ? S.examples.find((e) => e.n === ex.followup) : null;
      const back = ex && ex.chip === false ? S.examples.find((e) => e.followup === ex.n) : null;
      $("result").innerHTML = (ex ? "<p class='muted small'>Worked example: " + esc(ex.note) + "</p>" +
        (ex.caveat ? "<p class='small'><b>Caveat:</b> " + esc(ex.caveat) + "</p>" : "") : "") + renderAnswers() +
        (fu ? "<p><button class='chip next' data-go='" + fu.n + "'>Next view on this board: " + esc(fu.title) + " \u2192</button></p>" : "") +
        (back ? "<p><button class='chip next' data-go='" + back.n + "'>\u2190 Back to the first view</button></p>" : "");
      $("result").onclick = (e) => {
        const btn = e.target.closest("[data-go]"); if (!btn) return;
        const x = S.examples.find((y) => y.n === +btn.dataset.go); go(x.board, x.template);
      };
      renderCertificates();
    }
    renderBoard();
    renderTyped();
  }

  const VERDICT_TEXT = {
    ok: ["ok", "\u2713 checked by hand: value and split match the source"],
    missing: ["ok", "\u2713 checked by hand: value and split match; the paper also reports a better same-method test value that is not a record"],
    wrong_split: ["bad", "\u26a0 hand check: the source gives a different split"],
    wrong_value: ["bad", "\u26a0 hand check: this value belongs to a different benchmark or column"],
    unsure: ["unsure", "? hand check: the source is ambiguous about the split"],
  };
  function auditBadge(r) {
    const a = S.audit && S.audit.get(S.board.id + "#" + r.rid);
    if (!a) return "";
    const [cls, txt] = VERDICT_TEXT[a.verdict] || ["unsure", "hand-checked"];
    const extra = a.verdict === "wrong_split" && a.split_per_source ? " (source: " + a.split_per_source + ")" : "";
    return "<span class='audit " + cls + "' title='" + esc((a.notes || "") + " [checked " + a.date + "]") + "'>" + esc(txt + extra) + "</span>";
  }
  function reportURL(r) {
    const p = r.proto || {};
    const view = location.origin + location.pathname + "#q=" + encodeURIComponent(S.tmpl) + "&b=" + encodeURIComponent(S.board.id);
    const title = "Label error: " + S.board.dataset + " / " + S.board.metric + ": " + r.method + " " + val(r.value);
    const body = [
      "**Board:** `" + S.board.id + "` (" + S.board.dataset + " / " + S.board.metric + ")",
      "**Record:** " + r.method + ", value " + val(r.value) + " (record id " + r.rid + ")",
      "**Paper:** https://arxiv.org/abs/" + (r.arxiv_id || "?"),
      "**Pointer:** `" + (r.source_location || "none recorded") + "` (" + pointer(r.source_location).replace(/&[^;]+;/g, "\"") + ")",
      "**Stored protocol:** split = " + (p.split == null ? "not recorded" : p.split) + "; metric surface = " +
        (p.metric_surface == null ? "not recorded" : p.metric_surface) + "; unit = " + (p.unit == null ? "not recorded" : p.unit),
      "**Demo view:** " + view, "",
      "**What the source says** (split, value, table/section and page):", "",
    ].join("\n");
    return S.meta.demo_repo_url + "/issues/new?labels=label-error&title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
  }
  const reportLink = (r) => "<a class='report' href='" + esc(reportURL(r)) + "' target='_blank' rel='noopener' title='Opens a pre-filled GitHub issue'>Report a label error</a>";

  function recordBlock(r, opts) {
    opts = opts || {};
    return "<div class='big'>" + val(r.value) + "</div>" +
      "<div class='method'>" + esc(r.method) + "</div>" +
      "<ul class='facts'>" +
      "<li><span class='k'>protocol</span>" + protoChips(r.proto) + "</li>" +
      "<li><span class='k'>source</span>" + paperLink(r) + ", " + pointer(r.source_location) + "</li>" +
      (opts.extra || "") +
      "<li><span class='k'>audit</span>" + (auditBadge(r) || "<span class='muted'>not hand-checked</span>") + " \u00b7 " + reportLink(r) + "</li></ul>";
  }

  function naivePanel() {
    const a = S.board.answers.Q_any, r = rec(a.winner_rid);
    return "<div class='panel naive'><h3>Naive answer <span class='mono'>Q_any</span></h3>" +
      "<p class='sub'>Best raw number among all " + a.n_records + " entries, any protocol (" + dirWord() + ").</p>" +
      recordBlock(r) + "</div>";
  }

  function renderAnswers() {
    const A = S.board.answers, t = S.tmpl, naive = rec(A.Q_any.winner_rid);
    let qual = "", qualName = null;
    if (t === "Q_any") {
      qual = "<div class='panel qual'><h3>Same question, no protocol <span class='mono'>Q_any</span></h3>" +
        "<p class='sub'>With no facet required to agree there is a single comparison set, so this reading is " + statusChip("robust") +
        " by construction. It cannot report uncertainty, which is why the qualified templates exist.</p>" + recordBlock(naive) + "</div>";
      qualName = naive.method;
    } else if (t === "Q_official") {
      const o = A.Q_official;
      let body;
      if (o.status === "robust") {
        const r = rec(o.winner_rid), set = o.sets[0];
        qualName = r.method;
        const tie = tiedWith(set.rids, o.winner_rid);
        body = (tie.length ? "<p class='note'>Tie: " + esc(r.method) + " shares the best value with " + tie.map(esc).join(", ") + ".</p>" : "") +
          "<p class='sub'>Best entry among the " + set.rids.length + " that report the test split and share metric surface “" + esc(set.key.metric_surface) +
          "” and unit “" + esc(set.key.unit || "") + "”.</p>" + recordBlock(r, { extra: excludedLine(o) });
      } else if (o.status === "conditional") {
        body = "<p class='sub'>" + esc(o.reason) + "</p><ul class='setlist'>" + o.sets.map((s) => {
          const w = rec(s.winner_rid);
          return "<li><b>" + val(w.value) + "</b> " + esc(w.method) + "<br>" + protoChips(w.proto) + " <span class='muted small'>(" + s.rids.length + " records)</span></li>";
        }).join("") + "</ul>" + (spellingOnly(o.sets.map((x) => Object.assign({ split: "test" }, x.key))) ? SPELLING_NOTE : "") +
          "<ul class='facts'>" + excludedLine(o) + "</ul>";
      } else {
        body = abstention(o.reason, excludedLine(o));
      }
      qual = "<div class='panel qual'><h3>Protocol-qualified answer <span class='mono'>Q_official</span>" + statusChip(o.status) + "</h3>" + body + "</div>";
    } else if (t === "Q_trend") {
      qual = "<div class='panel qual'><h3>Protocol-qualified trend <span class='mono'>Q_trend</span>" + statusChip(A.Q_trend.status) + "</h3>" + trendBody(A.Q_trend) + "</div>";
    } else if (t === "Q_threshold") {
      const q = A.Q_threshold;
      if (q.champion_rid != null && q.status !== "insufficient") qualName = rec(q.champion_rid).method;
      qual = "<div class='panel qual'><h3>Margin under protocol conditioning <span class='mono'>Q_threshold</span>" + statusChip(q.status) + "</h3>" + thresholdBody(q) + "</div>";
    }
    let flag = "";
    if (t === "Q_official" || t === "Q_threshold") {
      const exb = S.examples.find((e) => e.n === S.exampleN);
      if (qualName && qualName !== naive.method) flag = "<div class='flag'>\u26a0 " + esc(exb && exb.banner ? exb.banner : "Winner changes: the naive leader is not the protocol-qualified answer.") + "</div>";
      else if (qualName) flag = "<div class='flag same'>The naive and qualified answers name the same method.</div>";
      else flag = "<div class='flag same'>No single qualified winner, so there is nothing to compare with the naive leader.</div>";
    }
    return flag + "<div class='panels'>" + naivePanel() + qual + "</div>";
  }

  function excludedLine(o) {
    const e = o.excluded;
    return "<li><span class='k'>left out</span>" + e.other_split + " on another split, " + e.split_not_reported + " with no split identified in the extracted record" +
      (e.isolated_test_records ? ", " + e.isolated_test_records + " test record(s) with no peer sharing metric and unit" : "") + "</li>";
  }

  function abstention(reason, extra) {
    return "<div class='abstain'><div class='big'>Insufficient qualified evidence</div>" +
      "<p>The system abstains. This is an answer, not an error: under this question no two extracted records are comparable.</p>" +
      "<p class='small'>" + esc(reason || "") + "</p>" + (extra ? "<ul class='facts'>" + extra + "</ul>" : "") + "</div>";
  }

  function trendBody(tr) {
    if (tr.status === "insufficient") return abstention(tr.reason);
    const rows = tr.years.map((y) => y.sets.map((s, i) => {
      const w = rec(s.winner_rid);
      return "<tr><td>" + (i === 0 ? "<b>" + y.year + "</b>" + (y.agree ? "" : " " + statusChip("conditional")) : "") + "</td><td class='num'>" + val(w.value) +
        "</td><td>" + esc(w.method) + tieNote(tiedWith(s.rids, s.winner_rid)) + "</td><td>" + protoShort(w.proto) + "</td><td class='num'>" + s.rids.length + "</td></tr>";
    }).join("")).join("");
    return "<p class='sub'>Winner per source-preprint year (the first-submission year of the arXiv paper that reports the number) within each set that shares split, metric surface and unit. This groups records by preprint year; it is not a historical performance frontier." +
      (tr.reason ? " " + esc(tr.reason) : " Every year has one winner in every set.") + "</p>" +
      "<div class='tbl-scroll'><table><thead><tr><th>Year</th><th class='num'>Value</th><th>Winner</th><th>Protocol</th><th class='num'>n</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function thresholdBody(q) {
    if (q.champion_rid == null) return abstention(q.reason);
    const c = rec(q.champion_rid), tr = rec(q.tau_rid);
    let html = "<p class='sub'>The official champion and the bar τ (best competitor) come from the largest official comparison set. " +
      "The champion must beat τ in every full-protocol group where it meets a peer.</p>" +
      "<ul class='facts'><li><span class='k'>champion</span><b>" + esc(c.method) + "</b> " + val(c.value) + " " + protoChips(c.proto) + "</li>" +
      "<li><span class='k'>bar τ</span>" + val(q.tau) + " (" + esc(tr.method) + ", " + paperLink(tr) + ")</li></ul>";
    if (q.status === "insufficient") return html + abstention(q.reason + " (" + (q.groups.length) + " group).");
    html += "<div class='tbl-scroll'><table><thead><tr><th>Protocol group</th><th class='num'>Champion</th><th>Clears τ?</th><th class='num'>n</th></tr></thead><tbody>" +
      q.groups.map((g) => "<tr><td>" + protoShort(g.key) + "</td><td class='num'>" + val(rec(g.champion_rid).value) + "</td><td>" +
        (g.clears ? "<span class='rel-same'>yes</span>" : "<span class='rel-diff'>no</span>") + "</td><td class='num'>" + g.rids.length + "</td></tr>").join("") +
      "</tbody></table></div>" + (spellingOnly(q.groups.map((g) => g.key)) ? SPELLING_NOTE : "");
    return html;
  }

  // ------------------------------------------------------------------ certificates
  function certFor(a, b) {
    const C = S.board.certificates;
    if (C[a + "-" + b]) return { c: C[a + "-" + b], l: a, r: b };
    if (C[b + "-" + a]) return { c: C[b + "-" + a], l: b, r: a };
    return null;
  }
  function missingReason(a, b) {
    const ra = rec(a), rb = rec(b), scope = new Set(S.board.certificate_scope_rids);
    if (ra.cluster == null || rb.cluster == null)
      return "One of the two entries is comparability-unknown: its split, metric surface or unit is not all observed. Such entries are flagged and never certified.";
    if (!S.board.multi_cluster)
      return "This board has a single protocol cluster. Leaderboard-pair certificates cover only boards with two or more clusters.";
    if (!scope.has(a) || !scope.has(b))
      return "At least one entry is outside the certificate scope: certificates cover the top 10 entries of each multi-protocol board.";
    return "No certificate is stored for this pair.";
  }

  function certSlots() {
    const A = S.board.answers, t = S.tmpl, slots = [];
    const naive = A.Q_any.winner_rid;
    const runnerUp = (rids, w) => { const r = ranked(rids).find((x) => x.rid !== w); return r ? r.rid : null; };
    if (t === "Q_official" && A.Q_official.status === "robust") {
      const o = A.Q_official, w = o.winner_rid;
      if (rec(w).method !== rec(naive).method) slots.push({ title: "Qualified answer vs naive leader", a: w, b: naive });
      const ru = runnerUp(o.sets[0].rids, w);
      if (ru != null) slots.push({ title: "Qualified answer vs its runner-up", a: w, b: ru });
    } else if (t === "Q_official" && A.Q_official.status === "conditional") {
      const s = A.Q_official.sets;
      for (let i = 1; i < s.length; i++) slots.push({ title: "Set 1 winner vs set " + (i + 1) + " winner", a: s[0].winner_rid, b: s[i].winner_rid });
    } else if (t === "Q_threshold" && A.Q_threshold.champion_rid != null) {
      const q = A.Q_threshold;
      slots.push({ title: "Champion vs bar τ", a: q.champion_rid, b: q.tau_rid });
      q.groups.forEach((g, i) => { if (g.champion_rid !== q.champion_rid) slots.push({ title: "Champion vs its group " + (i + 1) + " result", a: q.champion_rid, b: g.champion_rid }); });
      if (rec(q.champion_rid).method !== rec(naive).method) slots.push({ title: "Champion vs naive leader", a: q.champion_rid, b: naive });
    } else if (t === "Q_trend" && A.Q_trend.status !== "insufficient") {
      const ys = A.Q_trend.years, last = ys[ys.length - 1];
      ys.filter((y) => !y.agree).forEach((y) => y.sets.slice(1).forEach((s, i) =>
        slots.push({ title: y.year + ": set 1 winner vs set " + (i + 2) + " winner", a: y.sets[0].winner_rid, b: s.winner_rid, first: true })));
      last.sets.forEach((s, i) => { const ru = runnerUp(s.rids, s.winner_rid); if (ru != null) slots.push({ title: last.year + " winner vs runner-up" + (last.sets.length > 1 ? " (set " + (i + 1) + ")" : ""), a: s.winner_rid, b: ru }); });
      if (ys.length > 1) slots.push({ title: ys[0].year + " winner vs " + last.year + " winner", a: ys[0].sets[0].winner_rid, b: last.sets[0].winner_rid });
    }
    const out = slots.filter((s) => s.a !== s.b);
    // slots that carry a stored certificate first; order is otherwise kept
    const rank = (s) => (s.first ? 2 : 0) + (certFor(s.a, s.b) ? 1 : 0);
    out.sort((x, y) => rank(y) - rank(x));
    if (S.picks.length === 2) out.unshift({ title: "Your selected pair", a: S.picks[0], b: S.picks[1], picked: true });
    return out;
  }

  function renderCertificates() {
    const slots = certSlots();
    $("certSection").hidden = false;
    if (!slots.length) {
      $("certIntro").textContent = "";
      $("certSlots").innerHTML = "";
      $("certBody").innerHTML = "<div class='missing-cert'><b>No qualified answer, so no certificate is attached.</b> " +
        "Select any two records in the board view below to inspect the certificate for that pair.</div>";
      return;
    }
    if (S.slot >= slots.length) S.slot = 0;
    $("certIntro").textContent = "A certificate is a machine-readable record of one comparability decision between two reported results. It lists every facet inspected, how the two sides relate on it, and the status that follows.";
    $("certSlots").innerHTML = slots.map((s, i) => "<button class='chip" + (i === S.slot ? " active" : "") + "' data-i='" + i + "'>" + esc(s.title) + "</button>").join("");
    $("certSlots").onclick = (e) => { const b = e.target.closest(".chip"); if (!b) return; S.slot = +b.dataset.i; renderCertificates(); };
    const s = slots[S.slot];
    const c = certFor(s.a, s.b);
    $("certBody").innerHTML = c ? certHTML(c) : missingHTML(s.a, s.b);
  }

  function relCls(r) { return r === "observed-same" ? "rel-same" : r === "observed-different" ? "rel-diff" : "rel-miss"; }

  function certHTML(hit) {
    const c = hit.c, L = c.left, R = c.right;
    const side = (lbl, x, rid) => {
      const r = rec(rid), nm = r.method;
      return "<div class='cert-rec'><h4>" + lbl + "</h4><div class='method'>" + esc(nm) + "</div>" +
        "<div><b>" + val(x.value) + "</b> " + protoChips(x.protocol) + "</div>" +
        "<div class='small'>" + paperLink(r) + ", " + pointer(x.source_location) + "</div>" +
        "<div class='small'>" + (auditBadge(r) ? auditBadge(r) + " \u00b7 " : "") + reportLink(r) + "</div></div>";
    };
    const shared = (S.board.shared_certificate_ids || {})[c.certificate_id];
    const u = c.uncertainty || {};
    const noise = u.beyond_noise == null
      ? "<b>Not evaluated for this pair.</b> The noise-band rule was applied to census pairs only. Rule: " + esc(S.templates.noise_rule.text)
      : (u.beyond_noise ? "Beyond noise" : "Within noise") + " (dispersion: " + esc(u.dispersion_source) + "). Rule: " + esc(S.templates.noise_rule.text);
    return "<div class='cert-grid'>" + side("Left record", L, hit.l) + side("Right record", R, hit.r) + "</div>" +
      "<div class='verdict'><span>Status</span><span class='v " + esc(c.status) + "'>" + esc(c.status) + "</span>" +
      "<span>Typed outcome</span><span class='mono'>" + esc(c.typed_outcome) + "</span></div>" +
      "<div class='tbl-scroll'><table><thead><tr><th>Facet</th><th>Left</th><th>Right</th><th>Relation</th><th>Source</th></tr></thead><tbody>" +
      c.per_facet.map((f) => "<tr><td class='mono'>" + esc(f.facet) + "</td><td>" + (f.left == null ? "<span class='rel-miss'>not observed</span>" : esc(f.left)) +
        "</td><td>" + (f.right == null ? "<span class='rel-miss'>not observed</span>" : esc(f.right)) + "</td><td class='" + relCls(f.relation) + "'>" + esc(f.relation) +
        "</td><td>" + esc(f.source) + "</td></tr>").join("") + "</tbody></table></div>" +
      "<dl class='kv'>" +
      "<dt>certificate_id</dt><dd class='mono'>" + esc(c.certificate_id) + (shared ? "<div class='note warn'>This identifier is shared by " + shared + " certificates in the release (two methods from one paper with the same value). The demo keys certificates by board and both records instead. Listed in KNOWN_ISSUES.md.</div>" : "") + "</dd>" +
      "<dt>query.template</dt><dd><span class='mono'>" + esc(c.query.template) + "</span> (must agree: " + esc(c.query.must_agree_facets.join(", ")) + ")" +
      "<div class='note'>“unconditional” means this certificate compares the pair on all three observed facets, whatever question you asked.</div></dd>" +
      "<dt>cell</dt><dd>" + esc(c.cell.dataset) + " · " + esc(c.cell.metric) + " · " + esc(c.cell.metric_direction) + "</dd>" +
      "<dt>compatible_dimensions</dt><dd>" + (esc(c.compatible_dimensions.join(", ")) || "none") + "</dd>" +
      "<dt>incompatible_dimensions</dt><dd>" + (esc(c.incompatible_dimensions.join(", ")) || "none") + "</dd>" +
      "<dt>missing_dimensions</dt><dd>" + (esc(c.missing_dimensions.join(", ")) || "none") + "</dd>" +
      "<dt>normalizations_applied</dt><dd>" + (c.normalizations_applied.length ? esc(JSON.stringify(c.normalizations_applied)) : "none") + "</dd>" +
      "<dt>typed_outcome_rule</dt><dd>" + esc(c.typed_outcome_rule || "") + "</dd>" +
      "<dt>typed_outcome_requires</dt><dd>" + esc(c.typed_outcome_requires || "") + "</dd>" +
      "<dt>implied_status / self_consistent</dt><dd>" + esc(c.implied_status) + " / " + esc(c.self_consistent) + "</dd>" +
      "<dt>judge_cause</dt><dd>" + (c.judge_cause == null ? "none (deterministic facet decision)" : esc(c.judge_cause)) + "</dd>" +
      "<dt>noise band</dt><dd>" + noise + "</dd>" +
      "<dt>provenance_only</dt><dd>" + esc(c.provenance_only) + "; evidence_text_redistributed: " + esc(c.evidence_text_redistributed) + "</dd>" +
      "</dl><details><summary>Raw certificate JSON</summary><pre class='json'>" + esc(JSON.stringify(c, null, 2)) + "</pre></details>";
  }

  function missingHTML(a, b) {
    const ra = rec(a), rb = rec(b);
    const facets = ["split", "metric_surface", "unit"].map((f) => {
      const x = ra.proto[f], y = rb.proto[f];
      const rel = x == null || y == null ? "missing" : x === y ? "observed-same" : "observed-different";
      return "<tr><td class='mono'>" + f + "</td><td>" + (x == null ? "<span class='rel-miss'>not observed</span>" : esc(x)) + "</td><td>" +
        (y == null ? "<span class='rel-miss'>not observed</span>" : esc(y)) + "</td><td class='" + relCls(rel) + "'>" + rel + "</td></tr>";
    }).join("");
    return "<div class='missing-cert'><p><b>No certificate covers this pair.</b> " + esc(missingReason(a, b)) + "</p>" +
      "<div class='cert-grid'><div class='cert-rec'><h4>Left record</h4>" + recordBlock(ra) + "</div><div class='cert-rec'><h4>Right record</h4>" + recordBlock(rb) + "</div></div>" +
      "<p class='small muted'>Facets from the leaderboard record, not a certificate:</p>" +
      "<div class='tbl-scroll'><table><thead><tr><th>Facet</th><th>Left</th><th>Right</th><th>Relation</th></tr></thead><tbody>" + facets + "</tbody></table></div></div>";
  }

  // ------------------------------------------------------------------ board view
  function selectedClusters() {
    const A = S.board.answers; if (!A) return new Set();
    const sel = new Set(), t = S.tmpl;
    const add = (rids) => { const r = rec(rids[0]); if (r.cluster != null) sel.add(r.cluster); };
    if (t === "Q_official") A.Q_official.sets.forEach((s) => add(s.rids));
    if (t === "Q_threshold" && A.Q_threshold.reference_set) add(A.Q_threshold.reference_set.rids);
    return sel;
  }

  function renderBoard() {
    const b = S.board, sel = selectedClusters();
    const naive = b.answers ? b.answers.Q_any.winner_rid : null;
    let qual = null;
    if (b.answers) {
      if (S.tmpl === "Q_official") qual = b.answers.Q_official.winner_rid;
      if (S.tmpl === "Q_threshold") qual = b.answers.Q_threshold.status !== "insufficient" ? b.answers.Q_threshold.champion_rid : null;
    }
    const row = (r, i) => "<tr class='pick" + (S.picks.includes(r.rid) ? " chosen" : "") + "' data-rid='" + r.rid + "'><td class='num'>" + (i == null ? "" : i + 1) +
      "</td><td>" + esc(r.method) + (r.rid === naive ? "<span class='mark n' title='naive leader'>N</span>" : "") + (r.rid === qual ? "<span class='mark q' title='qualified answer'>Q</span>" : "") +
      "</td><td class='num'>" + val(r.value) + "</td><td>" + paperLink(r) + "<div class='small muted'>" + pointer(r.source_location) + "</div>" +
      (auditBadge(r) ? "<div class='small'>" + auditBadge(r) + "</div>" : "") + "<div class='small'>" + reportLink(r) + "</div></td></tr>";
    const table = (rs, numbered, id) => {
      const LIM = 10, open = S.open && S.open[id];
      const shown = open ? rs : rs.slice(0, LIM);
      return "<div class='tbl-scroll'><table><thead><tr><th class='num'>#</th><th>Method</th><th class='num'>Value</th><th>Source</th></tr></thead><tbody>" +
        shown.map((r, i) => row(r, numbered ? i : null)).join("") + "</tbody></table></div>" +
        (rs.length > LIM ? "<button class='more' data-open='" + id + "'>" + (open ? "Show fewer" : "Show all " + rs.length) + "</button>" : "");
    };
    const boardNote = spellingOnly(b.clusters.map((c) => c.protocol)) ? SPELLING_NOTE : "";
    let html = "<p class='small'><b>" + esc(b.dataset) + " · " + esc(b.metric) + "</b> · " + b.n_entries + " entries · " + b.clusters.length +
      " comparable sub-board(s) · " + b.unknown_rids.length + " comparability-unknown · " + dirWord() + " · identity grade <span class='mono'>" + esc(b.grade) + "</span></p>" +
      "<p class='small muted'>N marks the naive leader, Q the qualified answer. " + (S.picks.length === 1 ? "One record selected; select another." : "") + "</p>" + boardNote + "<div class='subboards'>";
    b.clusters.forEach((c, i) => {
      const isSel = sel.has(i);
      const labels = [];
      if (i === b.principal_cluster) labels.push("<span class='sb-label'>largest comparable cluster</span>");
      if (isSel) labels.push("<span class='sb-label sel'>selected by " + esc(S.tmpl) + "</span>");
      html += "<div class='sb" + (isSel ? " selected" : "") + "'><div class='sb-head'>" + protoChips(c.protocol) + "<span>" + labels.join(" · ") + "</span></div>" +
        table(ranked(c.rids), true, "c" + i) + "</div>";
    });
    if (b.unknown_rids.length) {
      html += "<div class='sb unknown'><div class='sb-head'><span class='sb-label'>Comparability unknown: flagged, not ranked</span></div>" +
        "<p class='small muted'>Split, metric surface or unit not all observed. Shown in descending order of value for reference only.</p>" +
        table(ranked(b.unknown_rids), false, "u") + "</div>";
    }
    html += "</div>";
    $("boardSection").hidden = false;
    $("boardBody").innerHTML = html;
    $("boardBody").onclick = (e) => {
      const more = e.target.closest(".more");
      if (more) { S.open = S.open || {}; S.open[more.dataset.open] = !S.open[more.dataset.open]; renderBoard(); return; }
      const tr = e.target.closest("tr.pick"); if (!tr || e.target.closest("a")) return;
      const rid = +tr.dataset.rid;
      if (S.picks.includes(rid)) S.picks = S.picks.filter((x) => x !== rid);
      else S.picks = S.picks.length >= 2 ? [rid] : S.picks.concat(rid);
      if (S.picks.length === 2) S.slot = 0;
      renderBoard();
      if (S.board.scored) renderCertificates(); else renderPickOnly();
      if (S.picks.length === 2) $("certSection").scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  function renderPickOnly() {
    $("certSection").hidden = S.picks.length !== 2;
    if (S.picks.length !== 2) return;
    $("certIntro").textContent = "";
    $("certSlots").innerHTML = "";
    const c = certFor(S.picks[0], S.picks[1]);
    $("certBody").innerHTML = c ? certHTML(c) : missingHTML(S.picks[0], S.picks[1]);
  }

  // ------------------------------------------------------------------ typed questions
  function renderTyped() {
    const T = S.board.typed_questions || [];
    $("typedSection").hidden = !T.length;
    if (!T.length) return;
    const prov = (p) => p.map((x) => esc(x.method) + " " + val(x.value) + " (" + paperLink(x) + ", " + pointer(x.source_location) + ")").join("; ");
    $("typedBody").innerHTML = T.map((q) => {
      const conds = (q.conditions || []).map((c) => "<li>" + protoChips(c.protocol) + " " +
        (c.verdict ? "verdict: <b>" + esc(c.verdict) + "</b>" : "leader and every method within its noise band: " + esc((c.winners || []).join(", "))) +
        (c.provenance && c.provenance.length ? "<details><summary>" + c.provenance.length + " record pointer(s)</summary>" + prov(c.provenance) + "</details>" : "") + "</li>").join("");
      return "<div class='typed-item'><div><b>" + esc(q.question) + "</b></div>" +
        "<div class='small'><span class='atype'>" + esc(q.answer_type.replace("_", " ")) + "</span>" +
        (q.answer != null ? " answer: <b>" + esc(q.answer) + "</b>" : "") + (q.abstention_warranted ? " · abstention warranted" : "") + "</div>" +
        "<div class='small muted'>" + esc(q.rationale) + "</div>" +
        (conds ? "<ul class='small'>" + conds + "</ul>" : "") +
        (q.provenance && q.provenance.length ? "<div class='small'>Records: " + prov(q.provenance) + "</div>" : "") + "</div>";
    }).join("");
  }

  init().catch((e) => {
    $("result").innerHTML = "<div class='card'>Could not load the precomputed data (" + esc(e.message) + "). If you opened this file directly, serve the folder over HTTP instead.</div>";
  });
})();
