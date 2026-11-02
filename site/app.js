/* Leaderboard Check. Static, no backend: every answer is precomputed by build/precompute.py
   from frozen data and only read here. */
(function () {
  "use strict";

  const TEMPLATES = ["Q_official", "Q_trend", "Q_threshold"];
  const PLAIN_TEMPLATE = { Q_official: "test set only", Q_trend: "by year", Q_threshold: "does the lead hold?", Q_any: "the leaderboard says" };
  const QUESTION_TEXT = { Q_any: "Which method reports the top value, whatever the setup?", Q_official: "Which method has the best value on the official test split?", Q_trend: "How does the best value change by year of the reporting paper?", Q_threshold: "Does the best test record stay ahead of its nearest competitor in every setup where both appear?" };
  const FACET_PLAIN = { split: "split", metric_surface: "metric name", unit: "unit" };
  /* Frozen data files keep their released wording; this maps it to the site's fixed terms for display. */
  const plainTerms = (s) => String(s == null ? "" : s)
    .replace(/ \(default per the honesty rule\)/g, "")
    .replace(/metric[_ -]surface/g, "metric name").replace(/\bsurface=/g, "metric=")
    .replace(/protocol cluster\(s\)/g, "valid comparison set(s)").replace(/unknown protocol/g, "unknown setup")
    .replace(/official comparison sets/g, "valid comparison sets").replace(/\bprotocol\b/g, "evaluation setup")
    .replace(/\bfacet/g, "field");
  const STATUS_LABEL = { robust: "holds in every group", conditional: "depends on the group", insufficient: "not enough evidence" };

  const S = { meta: null, templates: null, index: [], examples: [], shards: {}, board: null, tmpl: "Q_official", picks: [], slot: 0, exampleN: null, T: 0, speed: 1 };

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
      return "<span class='" + cls + "' title='" + (k === "metric_surface" ? "metric name as written" : label) + "'>" + label + ": " + esc(v) + "</span>";
    };
    return "<span class='proto'>" + f("split", "split") + f("metric_surface", "metric name") + f("unit", "unit") + "</span>";
  }
  function protoShort(p) {
    const sp = p && p.split != null ? p.split : null;
    const cls = sp == null ? "pchip missing" : sp === "test" ? "pchip split-test" : "pchip split-other";
    const rest = [p && p.metric_surface, p && p.unit].map((x) => (x == null ? "?" : esc(x))).join(" \u00b7 ");
    return "<span class='nowrap'><span class='" + cls + "'>" + (sp == null ? "split ?" : esc(sp)) + "</span> <span class='mono small'>" + rest + "</span></span>";
  }
  const ABBREV = { acc: "accuracy", top1acc: "top1accuracy", f1score: "f1", fscore: "f1", fmeasure: "f1", dsc: "dice", meaniou: "miou" };
  const canonLabel = (s) => { const c = String(s || "").toLowerCase().replace(/\(\s*%\s*\)/g, "").replace(/[^a-z0-9@]+/g, ""); return ABBREV[c] || c; };
  /* Interface note (not part of any comparability determination): two setup groups whose split and unit agree and whose
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
      "**Stored evaluation setup:** split = " + (p.split == null ? "not recorded" : p.split) + "; metric name = " +
        (p.metric_surface == null ? "not recorded" : p.metric_surface) + "; unit = " + (p.unit == null ? "not recorded" : p.unit),
      "**Demo view:** " + view, "",
      "**What the source says** (split, value, table/section and page):", "",
    ].join("\n");
    return S.meta.demo_repo_url + "/issues/new?labels=label-error&title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
  }
  const reportLink = (r) => "<a class='report' href='" + esc(reportURL(r)) + "' target='_blank' rel='noopener' title='Opens a pre-filled GitHub issue'>Report a label error</a>";

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
      return "One of the two result records has an unknown setup: its split, metric name or unit is not all recorded. Such records get no comparability determination.";
    if (!S.board.multi_cluster)
      return "This leaderboard has a single setup group. Comparability determinations cover only leaderboards with two or more groups.";
    if (!scope.has(a) || !scope.has(b))
      return "At least one record is outside the released set: comparability determinations cover the top 10 records of each leaderboard with two or more groups.";
    return "No comparability determination is stored for this pair.";
  }

  function certSlots() {
    const A = S.board.answers, t = S.tmpl, slots = [];
    const naive = A.Q_any.winner_rid;
    const runnerUp = (rids, w) => { const r = ranked(rids).find((x) => x.rid !== w); return r ? r.rid : null; };
    if (t === "Q_official" && A.Q_official.status === "robust") {
      const o = A.Q_official, w = o.winner_rid;
      if (rec(w).method !== rec(naive).method) slots.push({ title: "Fair answer vs the leaderboard\u2019s top number", a: w, b: naive });
      const ru = runnerUp(o.sets[0].rids, w);
      if (ru != null) slots.push({ title: "Fair answer vs the next record", a: w, b: ru });
    } else if (t === "Q_official" && A.Q_official.status === "conditional") {
      const s = A.Q_official.sets;
      for (let i = 1; i < s.length; i++) slots.push({ title: "Set 1 winner vs set " + (i + 1) + " winner", a: s[0].winner_rid, b: s[i].winner_rid });
    } else if (t === "Q_threshold" && A.Q_threshold.champion_rid != null) {
      const q = A.Q_threshold;
      slots.push({ title: "Test-set leader vs the bar", a: q.champion_rid, b: q.tau_rid });
      q.groups.forEach((g, i) => { if (g.champion_rid !== q.champion_rid) slots.push({ title: "Test-set leader vs its record in group " + (i + 1), a: q.champion_rid, b: g.champion_rid }); });
      if (rec(q.champion_rid).method !== rec(naive).method) slots.push({ title: "Test-set leader vs the leaderboard\u2019s top number", a: q.champion_rid, b: naive });
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
      $("certBody").innerHTML = "<div class='missing-cert'><b>No fair answer, so no comparability determination is attached.</b> " +
        "Pick any two records in \u201cAll records\u201d to see the comparability determination for that pair.</div>";
      return;
    }
    if (S.slot >= slots.length) S.slot = 0;
    $("certIntro").textContent = "A comparability determination records one decision about two result records. It marks the split, metric name and unit of the pair as equal, different or missing, and gives the status that follows.";
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
      "<div class='tbl-scroll'><table><thead><tr><th>Field</th><th>Left</th><th>Right</th><th>Relation</th><th>Source</th></tr></thead><tbody>" +
      c.per_facet.map((f) => "<tr><td>" + esc(FACET_PLAIN[f.facet] || f.facet) + "</td><td>" + (f.left == null ? "<span class='rel-miss'>not observed</span>" : esc(f.left)) +
        "</td><td>" + (f.right == null ? "<span class='rel-miss'>not observed</span>" : esc(f.right)) + "</td><td class='" + relCls(f.relation) + "'>" + esc(f.relation) +
        "</td><td>" + esc(f.source) + "</td></tr>").join("") + "</tbody></table></div>" +
      "<dl class='kv'>" +
      "<dt>identifier</dt><dd class='mono'>" + esc(c.certificate_id) + (shared ? "<div class='note warn'>This identifier is shared by " + shared + " comparability determinations in the release (two methods from one paper with the same value). The demo keys them by board and both records instead. Listed in KNOWN_ISSUES.md.</div>" : "") + "</dd>" +
      "<dt>query.template</dt><dd><span class='mono'>" + esc(c.query.template) + "</span> (must agree: " + esc(c.query.must_agree_facets.map((f) => FACET_PLAIN[f] || f).join(", ")) + ")" +
      "<div class='note'>“unconditional” means this comparability determination compares the pair on split, metric name and unit, whatever question you asked.</div></dd>" +
      "<dt>leaderboard</dt><dd>" + esc(c.cell.dataset) + " · " + esc(c.cell.metric) + " · " + esc(c.cell.metric_direction) + "</dd>" +
      "<dt>compatible_dimensions</dt><dd>" + (esc(c.compatible_dimensions.map((f) => FACET_PLAIN[f] || f).join(", ")) || "none") + "</dd>" +
      "<dt>incompatible_dimensions</dt><dd>" + (esc(c.incompatible_dimensions.map((f) => FACET_PLAIN[f] || f).join(", ")) || "none") + "</dd>" +
      "<dt>missing_dimensions</dt><dd>" + (esc(c.missing_dimensions.map((f) => FACET_PLAIN[f] || f).join(", ")) || "none") + "</dd>" +
      "<dt>normalizations_applied</dt><dd>" + (c.normalizations_applied.length ? esc(plainTerms(JSON.stringify(c.normalizations_applied))) : "none") + "</dd>" +
      "<dt>typed_outcome_rule</dt><dd>" + esc(plainTerms(c.typed_outcome_rule)) + "</dd>" +
      "<dt>typed_outcome_requires</dt><dd>" + esc(plainTerms(c.typed_outcome_requires)) + "</dd>" +
      "<dt>implied_status / self_consistent</dt><dd>" + esc(c.implied_status) + " / " + esc(c.self_consistent) + "</dd>" +
      "<dt>judge_cause</dt><dd>" + (c.judge_cause == null ? "none (decided by fixed rules)" : esc(c.judge_cause)) + "</dd>" +
      "<dt>noise band</dt><dd>" + noise + "</dd>" +
      "<dt>provenance_only</dt><dd>" + esc(c.provenance_only) + "; evidence_text_redistributed: " + esc(c.evidence_text_redistributed) + "</dd>" +
      "</dl><details><summary>Raw JSON (field names as released)</summary><pre class='json'>" + esc(JSON.stringify(c, null, 2)) + "</pre></details>";
  }

  function missingHTML(a, b) {
    const ra = rec(a), rb = rec(b);
    const facets = ["split", "metric_surface", "unit"].map((f) => {
      const x = ra.proto[f], y = rb.proto[f];
      const rel = x == null || y == null ? "missing" : x === y ? "observed-same" : "observed-different";
      return "<tr><td>" + FACET_PLAIN[f] + "</td><td>" + (x == null ? "<span class='rel-miss'>not observed</span>" : esc(x)) + "</td><td>" +
        (y == null ? "<span class='rel-miss'>not observed</span>" : esc(y)) + "</td><td class='" + relCls(rel) + "'>" + rel + "</td></tr>";
    }).join("");
    return "<div class='missing-cert'><p><b>No comparability determination covers this pair.</b> " + esc(missingReason(a, b)) + "</p>" +
      "<div class='cert-grid'><div class='cert-rec'><h4>Left record</h4>" + recordBlock(ra) + "</div><div class='cert-rec'><h4>Right record</h4>" + recordBlock(rb) + "</div></div>" +
      "<p class='small muted'>Fields from the two result records. No comparability determination is stored:</p>" +
      "<div class='tbl-scroll'><table><thead><tr><th>Field</th><th>Left</th><th>Right</th><th>Relation</th></tr></thead><tbody>" + facets + "</tbody></table></div></div>";
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

  // ------------------------------------------------------------------ small display helpers
  const SPLIT_WORD = { val: "validation set", test: "test set", train: "training set" };
  const splitWord = (p) => (!p || p.split == null ? "split not recorded" : SPLIT_WORD[p.split] || p.split + " split");
  const splitCls = (p) => (!p || p.split == null ? "n" : p.split === "test" ? "g" : "w");
  const auditOf = (r) => (S.audit ? S.audit.get(S.board.id + "#" + r.rid) : null);
  const setupLine = (p) => [splitWord(p), p && p.metric_surface, p && p.unit].filter(Boolean).map(esc).join(" · ");
  function namesLine(rids, n) {
    const rs = ranked(rids), shown = rs.slice(0, n).map((r) => esc(r.method) + " " + val(r.value)).join(", ");
    return shown + (rs.length > n ? " …" : "");
  }
  function recordBlock(r) {
    return "<div class='method'>" + esc(r.method) + " <b>" + val(r.value) + "</b></div><div class='small'>" + protoChips(r.proto) + "</div>" +
      "<div class='small'>" + paperLink(r) + ", " + pointer(r.source_location) + "</div>" +
      "<div class='small'>" + (auditBadge(r) ? auditBadge(r) + " · " : "") + reportLink(r) + "</div>";
  }
  function auditPill(r, positive) {
    const a = auditOf(r);
    if (!a) return "";
    if (a.verdict === "wrong_split") return "<span class='pill w' title='" + esc(a.notes) + "'>⚠ hand check: source says " + esc(SPLIT_WORD[a.split_per_source] || a.split_per_source) + "</span>";
    if (a.verdict === "wrong_value") return "<span class='pill w' title='" + esc(a.notes) + "'>⚠ hand check: wrong benchmark or column</span>";
    if (a.verdict === "unsure") return "<span class='pill q' title='" + esc(a.notes) + "'>? hand check: source unclear</span>";
    return positive ? "<span class='pill g' title='" + esc(a.notes) + "'>✓ checked by hand</span>" : "";
  }
  const pillRow = (r, positive) => "<div class='pills'><span class='pill " + splitCls(r.proto) + "'>" + esc(splitWord(r.proto)) + "</span>" + auditPill(r, positive) + "</div>";
  const scrollTable = (head, rows) => "<div class='tbl-scroll tall'><table><thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>";

  // ------------------------------------------------------------------ routing
  async function init() {
    const [meta, templates, index, examples] = await Promise.all([
      getJSON("data/meta.json"), getJSON("data/templates.json"), getJSON("data/index.json"), getJSON("data/examples.json"),
    ]);
    Object.assign(S, { meta, templates, index, examples });
    S.audit = new Map();
    S.auditBoards = new Map();
    try {
      const au = await getJSON("data/audit/hand_audit.json");
      au.records.forEach((r) => {
        S.audit.set(r.board + "#" + r.rid, r);
        const level = r.verdict === "wrong_split" || r.verdict === "wrong_value" ? 2 : r.verdict === "unsure" ? 1 : 0;
        S.auditBoards.set(r.board, Math.max(S.auditBoards.get(r.board) || 0, level));
      });
    } catch (e) { /* the audit file is optional; badges simply do not show */ }
    S.byId = new Map(index.map((r) => [r.id, r]));
    renderStatic();
    window.addEventListener("hashchange", route);
    await route();
  }

  async function route() {
    if (location.hash === "#browse") { stopTimeline(); showBrowse(); return; }
    const h = new URLSearchParams(location.hash.slice(1));
    let id = h.get("b"), t = h.get("q");
    if (!id) { id = S.examples[0].board; t = S.examples[0].template; }
    if (!TEMPLATES.includes(t)) t = "Q_official";   // Q_any is always the left card
    const row = S.byId.get(id);
    if (!row) { $("boardView").hidden = true; $("browseView").hidden = false; $("browseView").innerHTML = "<p>Leaderboard not found: " + esc(id) + "</p>"; return; }
    if (!S.shards[row.shard]) S.shards[row.shard] = await getJSON("data/boards/" + row.shard + ".json");
    S.board = S.shards[row.shard][id];
    S.tmpl = t; S.picks = []; S.slot = 0; S.open = {}; S.stage = 0;
    const ex = S.examples.find((e) => e.board === id && e.template === t);
    S.exampleN = ex ? ex.n : null;
    $("browseView").hidden = true; $("boardView").hidden = false;
    renderBoardPage();
    window.scrollTo(0, 0);
  }
  const go = (id, t) => { location.hash = "#q=" + encodeURIComponent(t) + "&b=" + encodeURIComponent(id); };

  // ------------------------------------------------------------------ static parts
  function renderStatic() {
    const st = S.meta.stats;
    const chips = S.examples.filter((e) => e.chip !== false).map((e) => {
      const sc = SCENARIO[e.n] || {};
      return "<button data-n='" + e.n + "' title='" + esc(CHIP_PLAIN[e.board] || e.label) + "'>" + esc(sc.title || e.label) + "</button>";
    }).join("");
    $("chips").innerHTML = chips;
    $("chips").onclick = (e) => {
      const btn = e.target.closest("button"); if (!btn) return;
      const ex = S.examples.find((x) => x.n === +btn.dataset.n); go(ex.board, ex.template);
    };
    $("tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) setTab(b.dataset.tab); };
    TAB_IDS.forEach((id) => $(id).addEventListener("toggle", syncTabs));
    $("pPlay").onclick = togglePlay;
    $("pBack").onclick = () => seek(Math.max(0, Math.ceil(S.T) - 1));
    $("pNext").onclick = () => seek(Math.min(5, Math.floor(S.T) + 1));
    $("pEnd").onclick = () => seek(5);
    $("pSpeed").oninput = (e) => { S.speed = +e.target.value; $("pSpeedOut").textContent = S.speed + "x"; };
    $("lbList").addEventListener("mouseover", (e) => { const r = e.target.closest(".lb-row"); if (r && !S.pinned) showInspect(+r.dataset.rid, r, false); });
    $("lbList").addEventListener("mouseleave", () => { if (!S.pinned) $("inspect").hidden = true; });
    $("lbList").addEventListener("click", (e) => { const r = e.target.closest(".lb-row"); if (r) showInspect(+r.dataset.rid, r, true); });
    $("inspect").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeInspect(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeInspect(); });
    $("topLinks").innerHTML = "<a class='altview' href='https://harishsiravuri.github.io/ml-result-comparability-demo-v3/' title='Open the advanced view of this demo (design by Apoorv)'>Advanced View</a><a href='#browse'>Browse all</a><a href='" + esc(S.meta.repo_url) + "' target='_blank' rel='noopener'>Dataset</a><a href='" + esc(S.meta.demo_repo_url) + "' target='_blank' rel='noopener'>Source code</a><a href='" + esc(S.meta.demo_repo_url) + "/issues/new?labels=label-error' target='_blank' rel='noopener'>Report a label error</a>";
    $("modeSwitch").onclick = (e) => { const b = e.target.closest("button"); if (b && S.board) go(S.board.id, b.dataset.t); };

    $("templateHelp").innerHTML = S.templates.templates.map((t) =>
      "<div title='" + esc(t.name) + "'><b>" + esc(PLAIN_TEMPLATE[t.name]) + "</b><br>" + esc(QUESTION_TEXT[t.name] || "") + "<br><span class='muted small'>Must match: " +
      (t.must_agree_facets.length ? esc(t.must_agree_facets.map((f) => FACET_PLAIN[f] || f).join(", ")) : "nothing") +
      (t.restrictions.length && t.restrictions[0].op === "equals" ? "; test set only" : "") +
      (t.restrictions.length && t.restrictions[0].op === "partition_by" ? "; grouped by preprint year" : "") + "</span></div>").join("");
    $("auditText").innerHTML = "Split, metric and unit labels were extracted automatically from the papers. Using the same pointers shown here, one person checked 56 displayed records against their papers and found 14 errors: " +
      "6 development values stored as test, 3 values read from a neighbouring column or row, and 5 records whose paper states a split that the record gives wrongly or leaves out. A further record was unclear. " +
      "These 56 were drawn from boards with differing answers or too little evidence, so this is not an error rate for all the data. " +
      "The worked examples show only records that passed. Elsewhere, read a fair comparison as the best <i>recorded</i> value for that question, and follow the pointer to confirm it.";
    $("downloads").innerHTML = "Download: <a href='data/release/comparability_certificates.jsonl'>comparability determinations</a> (" + fmt(st.certificates) + "), " +
      "<a href='data/release/comparability_certificate.schema.json'>schema</a>, <a href='data/release/query_templates.json'>question templates</a>, " +
      "<a href='data/release/query_conditioned_by_leaderboard.jsonl'>saved answers</a>, <a href='data/release/SHA256SUMS'>checksums</a>, " +
      "hand audit (<a href='data/audit/hand_audit.json'>JSON</a>, <a href='data/audit/hand_audit.csv'>CSV</a>).";
    $("licence").innerHTML = "Data: <a href='https://creativecommons.org/licenses/by-sa/4.0/' target='_blank' rel='noopener'>CC BY-SA 4.0</a>. Evidence is given as pointers only (arXiv id, abstract URL, source location); no paper text is redistributed. " +
      "All data are frozen and precomputed; this page makes no model or server calls.";
    $("footStats").textContent = fmt(st.boards) + " leaderboards · " + fmt(st.entries) + " result records · " + fmt(st.certificates) + " comparability determinations";
    $("footLinks").innerHTML = "Frozen Papers with Code archive (" + esc(S.meta.snapshot.replace(/.*frozen /, "")) + ") · DOI <a href='https://doi.org/" + esc(S.meta.doi_version) + "' target='_blank' rel='noopener'>" + esc(S.meta.doi_version) + "</a> · CC BY-SA 4.0";
  }

  // ------------------------------------------------------------------ board page
  function renderBoardPage() {
    const b = S.board, ex = S.examples.find((e) => e.n === S.exampleN);
    let parent = ex;
    if (ex && ex.chip === false) parent = S.examples.find((x) => x.board === ex.board && x.chip !== false);
    [...$("chips").querySelectorAll("button")].forEach((c) => c.classList.toggle("on", !!parent && +c.dataset.n === parent.n));
    $("ask").innerHTML = askText();
    const task = TASK_GLOSS[b.id];
    $("gloss").textContent = (task ? task + " " : "") + (b.scored ? dirWord().replace(/^./, (c) => c.toUpperCase()) + "." : "");
    $("modeSwitch").hidden = !b.scored;
    $("modeSwitch").innerHTML = "<span class='small muted'>Ask:</span>" + TEMPLATES.map((t) =>
      "<button class='" + (t === S.tmpl ? "on" : "") + "' data-t='" + t + "' title='" + t + "'>" + esc(PLAIN_TEMPLATE[t]) + "</button>").join("");
    renderCards();
    $("why").innerHTML = b.scored ? (ex && ex.why ? ex.why : whyText()) : "This leaderboard has no answer: the data do not record whether higher or lower is better on this metric, so there is no “best” to report.";
    $("caveat").hidden = !(ex && ex.caveat);
    if (ex && ex.caveat) $("caveat").innerHTML = "<details><summary>Caveat</summary>" + esc(ex.caveat) + "</details>";
    renderPipeline();
    renderFlow();
    buildLeaderboard();
    startTimeline();
    ["certSection", "boardSection", "thresholdSection", "typedSection", "readSection"].forEach((id) => { $(id).open = false; });
    if (b.scored) { $("certSection").hidden = false; renderCertificates(); } else { $("certSection").hidden = true; }
    renderBoard();
    renderThreshold();
    renderTyped();
    syncTabs();
  }

  const TAB_IDS = ["certSection", "boardSection", "thresholdSection", "readSection"];
  function syncTabs() {
    const open = TAB_IDS.find((id) => !$(id).hidden && $(id).open) || "peek";
    $("peek").hidden = open !== "peek";
    [...$("tabs").children].forEach((b) => {
      const t = b.dataset.tab;
      b.hidden = t !== "peek" && $(t).hidden;
      b.classList.toggle("on", t === open);
      b.setAttribute("aria-selected", t === open);
    });
  }
  function setTab(t) {
    if (t === "peek") TAB_IDS.forEach((id) => { $(id).open = false; });
    else $(t).open = true;
    syncTabs();
    $("peek").parentNode.scrollTop = 0;
  }

  // plain description of the worked examples; other boards show only the score direction
  const TASK_GLOSS = {
    "hash:fb3db959fa006931|metric:average-map": "A benchmark for finding actions in videos. Average mAP is an accuracy score.",
    "pwc-dataset:mot17|hash:4dde914d469e1478": "A benchmark for tracking people across video frames.",
    "pwc-dataset:gopro|metric:psnr": "A benchmark for removing motion blur from images.",
    "pwc-dataset:csl-daily|metric:wer": "A benchmark for recognising Chinese Sign Language in videos.",
    "hash:2b958adf44f0cb1f|metric:bleu": "A benchmark for translating English into French.",
  };

  const SCENARIO = {
    1: { title: "A validation score sits on top" },
    3: { title: "One tracker, two splits" },
    4: { title: "The top score has no recorded split" },
    5: { title: "The winner depends on the setup" },
    6: { title: "Too little evidence to answer" },
  };

  const CHIP_PLAIN = {
    "hash:fb3db959fa006931|metric:average-map": "Finding actions in videos",
    "pwc-dataset:mot17|hash:4dde914d469e1478": "Tracking people in video",
    "pwc-dataset:gopro|metric:psnr": "Removing image blur",
    "pwc-dataset:csl-daily|metric:wer": "Sign language, by year",
    "hash:2b958adf44f0cb1f|metric:bleu": "English to French (not enough evidence)",
  };

  function askText() {
    const b = S.board, ds = esc(b.dataset), m = esc(b.metric);
    if (S.tmpl === "Q_trend" && b.scored) return "How does the best " + m + " on " + ds + " change by preprint year?";
    if (S.tmpl === "Q_threshold" && b.scored) return "On " + ds + " (" + m + "), does the test-set leader stay ahead?";
    return "What is the best " + m + " on " + ds + "?";
  }

  function renderCards() {
    const b = S.board;
    if (!b.scored) {
      $("cards").innerHTML = "<div class='card none'><div class='lab'>No answer</div><div class='numtext'>Metric direction unknown</div></div>";
      return;
    }
    const A = b.answers, n = rec(A.Q_any.winner_rid);
    const left = "<div class='card naive' title='Q_any'><div class='lab'>The leaderboard says</div><div class='num'>" + val(n.value) + "</div><div class='meth'>" + esc(n.method) + "</div>" + pillRow(n, false) + "</div>";
    let lab, body;
    if (S.tmpl === "Q_official") {
      const o = A.Q_official; lab = "Fair comparison (test set only)";
      if (o.status === "robust") {
        const r = rec(o.winner_rid);
        body = "<div class='num'>" + val(r.value) + "</div><div class='meth'>" + esc(r.method) + tieNote(tiedWith(o.sets[0].rids, r.rid)) + "</div>" + pillRow(r, true);
      } else if (o.status === "conditional") {
        body = "<div class='numtext'>It depends on the group</div><ul class='minilist'>" + o.sets.slice(0, 5).map((s) => {
          const w = rec(s.winner_rid);
          return "<li><b>" + val(w.value) + "</b> " + esc(w.method) + " <span class='muted small'>" + esc(s.key.metric_surface) + "</span></li>"; }).join("") + "</ul>" +
          (spellingOnly(o.sets.map((x) => Object.assign({ split: "test" }, x.key))) ? SPELLING_NOTE : "");
      } else body = "<div class='numtext'>Not enough evidence</div><p class='small muted'>No answer is given.</p>";
    } else if (S.tmpl === "Q_trend") {
      const tr = A.Q_trend; lab = "Fair comparison (by preprint year)";
      if (tr.status === "insufficient") body = "<div class='numtext'>Not enough evidence</div><p class='small muted'>No answer is given.</p>";
      else body = "<div class='tbl-scroll tall short'><table><tbody>" + tr.years.map((y) => y.sets.map((s, i) => {
        const w = rec(s.winner_rid);
        return "<tr><td>" + (i === 0 ? "<b>" + y.year + "</b>" : "") + "</td><td class='num'>" + val(w.value) + "</td><td>" + esc(w.method) + tieNote(tiedWith(s.rids, s.winner_rid)) + "</td><td><span class='pill tiny " + splitCls(w.proto) + "'>" + esc(splitWord(w.proto)) + "</span></td></tr>";
      }).join("")).join("") + "</tbody></table></div>";
    } else {
      const q = A.Q_threshold; lab = "Does the lead hold?";
      if (q.status === "insufficient" || q.champion_rid == null) body = "<div class='numtext'>Not enough evidence</div><p class='small muted'>" + esc(plainTerms(q.reason)) + "</p>";
      else {
        const c = rec(q.champion_rid), k = q.groups.filter((g) => g.clears).length;
        body = "<div class='numtext'>Holds in " + k + " of " + q.groups.length + " groups</div><div class='meth'>" + esc(c.method) + " " + val(c.value) + "</div><p class='small muted' title='threshold τ'>The bar is " + val(q.tau) + ", the next test-set record.</p>" + pillRow(c, true);
      }
    }
    $("cards").innerHTML = left + "<div class='card qual' title='" + S.tmpl + "'><div class='lab'>" + esc(lab) + "</div>" + body + "</div>";
  }

  function whyText() {
    const A = S.board.answers, n = rec(A.Q_any.winner_rid);
    if (S.tmpl === "Q_official") {
      const o = A.Q_official, e = o.excluded;
      if (o.status === "insufficient") return "<b>No two records can be fairly compared</b> on the test set: " + o.n_official_records + " carry a test-set label, " + e.split_not_reported + " have no split identified in the extracted record, and " + e.other_split + " are on another split.";
      if (o.status === "conditional") return "<b>The test-set groups disagree</b>: each has its own winner, so there is no single fair answer.";
      const q = rec(o.winner_rid);
      if (q.rid === n.rid) return "The top number is also the best comparable test-set record.";
      if (q.method === n.method) return "Both answers name " + esc(q.method) + ", but from different records.";
      if (n.proto.split == null || n.proto.metric_surface == null) return "The top number has <b>no recorded setup</b>, so it cannot be compared with test-set records.";
      if (n.proto.split !== "test") return "The top number was measured on the <b>" + esc(splitWord(n.proto)) + "</b>, so it does not compete with test-set records.";
      return "The top number is on the test set, but under <b>a different metric name</b>, so it sits in its own group.";
    }
    if (S.tmpl === "Q_trend") {
      const tr = A.Q_trend;
      if (tr.status === "insufficient") return "<b>No preprint year</b> has two records with the same recorded setup.";
      if (tr.status === "conditional") return "<b>In some years the groups disagree</b>, so the winner depends on the setup. This groups records by preprint year; it is not a historical record of progress.";
      return "Each preprint year has one winner across its groups. This groups records by preprint year; it is not a historical record of progress.";
    }
    const q = A.Q_threshold;
    if (q.status === "insufficient") return "<b>The lead cannot be tested</b>: the test-set leader meets a rival under only one setup, or there is no test-set group.";
    if (q.status === "conditional") return "The test-set leader stays ahead of the bar in some groups <b>but not all</b>.";
    return "The test-set leader stays ahead of the bar in <b>every group</b> where it meets a rival.";
  }

  // ------------------------------------------------------------------ pipeline ("How this answer was made")
  function pipelineModel() {
    const b = S.board, n = b.records.length, tagged = b.records.filter((r) => r.cluster != null).length, g = b.clusters.length, u = b.unknown_rids.length;
    const m = {
      stages: [
        { t: "Extract", d: "Collect result records from papers" },
        { t: "Tag setup", d: "Note each record's split, metric name and unit" },
        { t: "Group", d: "Put records with the same setup together" },
        { t: "Apply question", d: "" },
        { t: "Pick", d: "", fin: true, out: "" },
      ],
      arrows: [n + " result records", tagged === n ? n + " tagged" : tagged + " of " + n + " tagged", g + (g === 1 ? " group" : " groups") + (u ? " + " + u + " unknown" : ""), ""],
    };
    const [, , , s4, s5] = m.stages;
    if (!b.scored) {
      s4.d = "No question applied: higher or lower is not recorded"; m.arrows[3] = "0 kept"; s5.d = "Nothing to pick"; s5.out = "no answer"; return m;
    }
    const A = b.answers;
    if (S.tmpl === "Q_official") {
      const o = A.Q_official, kept = o.sets.reduce((a, s) => a + s.rids.length, 0);
      s4.d = o.sets.length === 0 ? "“Test set only” keeps no group" : "“Test set only” keeps " + (o.sets.length === 1 ? "one group" : o.sets.length + " groups");
      m.arrows[3] = kept + " kept";
      if (o.status === "robust") { const r = rec(o.winner_rid); s5.d = "Take the best kept record"; s5.out = r.method + " " + val(r.value); }
      else if (o.status === "conditional") { s5.d = "Each kept group has its own winner"; s5.out = "no single winner"; }
      else { s5.d = "Nothing to compare"; s5.out = "not enough evidence"; }
    } else if (S.tmpl === "Q_trend") {
      const tr = A.Q_trend, y = tr.years.length;
      s4.d = "“By year” splits each group by preprint year"; m.arrows[3] = y + (y === 1 ? " year" : " years");
      if (y) { s5.d = "Best per year within each group"; s5.out = tr.years.reduce((a, x) => a + x.sets.length, 0) + " yearly winners"; }
      else { s5.d = "Nothing to compare"; s5.out = "not enough evidence"; }
    } else {
      const q = A.Q_threshold, k = q.groups.filter((x) => x.clears).length;
      s4.d = "Fix the test-set leader and the bar, then test each group"; m.arrows[3] = q.groups.length + (q.groups.length === 1 ? " group tested" : " groups tested");
      s5.d = "Does the leader beat the bar in every group?";
      s5.out = q.status === "insufficient" ? "not enough evidence" : "holds in " + k + " of " + q.groups.length;
    }
    return m;
  }

  function renderPipeline() {
    const m = pipelineModel(), peek = $("peek");
    let html = "";
    m.stages.forEach((s, i) => {
      html += "<button type='button' class='stg" + (i === S.stage ? " on" : i < S.stage ? " done" : "") + "' data-s='" + i + "' aria-pressed='" + (i === S.stage) + "' title='" + esc(s.d) + "'>" +
        "<span class='stg-t'>" + (i + 1) + " · " + esc(s.t) + "</span>" +
        (s.out && S.stage === 4 ? "<span class='io out'>" + esc(s.out) + "</span>" : "") + "</button>";
    });
    $("pipe").innerHTML = html;
    [...$("pipe").querySelectorAll(".stg")].forEach((el) => { el.onclick = () => seek(+el.dataset.s + 1); });
    peek.innerHTML = "<div>" + stagePanel(S.stage, m) + "</div>" + stageCode(S.stage);
    peek.onclick = (e) => { const b = e.target.closest("[data-opencert]"); if (b) { $("certSection").open = true; $("certSection").scrollIntoView({ behavior: "smooth", block: "start" }); } };
  }

  /* One real record followed through the stages: the leaderboard's top record. Each stage adds its fields. */
  function stageCode(i) {
    const b = S.board, r = b.scored ? rec(b.answers.Q_any.winner_rid) : b.records[0];
    if (!r) return "";
    const fields = [
      [["method", r.method], ["value", r.value], ["arxiv_id", r.arxiv_id], ["source", r.source_location || null]],
      [["split", r.proto.split], ["metric_name", r.proto.metric_surface], ["unit", r.proto.unit]],
      [["group", r.cluster == null ? "unknown setup" : r.cluster + 1]],
    ];
    if (b.scored) {
      const { kept, why } = leftOut(), M = lbModel();
      fields.push(kept.has(r.rid) ? [["kept", true]] : [["kept", false], ["reason", why.get(r.rid)]]);
      fields.push([["rank_before", M.before.get(r.rid)], ["answer", M.single && M.after.has(r.rid) ? "rank " + M.after.get(r.rid) : kept.has(r.rid) ? "in the answer" : "not in the answer"]]);
    }
    const lines = fields.slice(0, i + 1).flatMap((set, k) => set.map(([key, v]) => {
      const t = esc(JSON.stringify(key)) + ": " + esc(JSON.stringify(v));
      return "  " + (k === i ? "<i>" + t + "</i>" : t);
    }));
    return "<div><div class='code-h'>The top record at this stage</div><pre class='code'>{\n" + lines.join(",\n") + "\n}</pre></div>";
  }

  function leftOut() {
    // why each record is outside what the question keeps; counts stored records only
    const b = S.board, A = b.answers, kept = new Set(), why = new Map();
    if (!b.scored) return { kept, why };
    if (S.tmpl === "Q_official") {
      A.Q_official.sets.forEach((s) => s.rids.forEach((i) => kept.add(i)));
      b.records.forEach((r) => { if (kept.has(r.rid)) return;
        why.set(r.rid, r.proto.split == null ? "no split identified in the extracted record" : r.proto.split !== "test" ? "on the " + splitWord(r.proto) : "test set, but no other record shares its metric name and unit"); });
    } else if (S.tmpl === "Q_trend") {
      A.Q_trend.years.forEach((y) => y.sets.forEach((s) => s.rids.forEach((i) => kept.add(i))));
      b.records.forEach((r) => { if (!kept.has(r.rid)) why.set(r.rid, r.cluster == null ? "unknown setup" : "no other record with the same setup and preprint year"); });
    } else {
      A.Q_threshold.groups.forEach((g) => g.rids.forEach((i) => kept.add(i)));
      b.records.forEach((r) => { if (!kept.has(r.rid)) why.set(r.rid, r.cluster == null ? "unknown setup" : "in a group where the test-set leader has no rival"); });
    }
    return { kept, why };
  }

  function stagePanel(i, m) {
    const b = S.board, n = b.records.length;
    const head = (io) => "<div class='peek-h'><b>Stage " + (i + 1) + " · " + esc(m.stages[i].t) + "</b> <span class='muted'>" + io + "</span></div>";
    if (i === 0) return head("input: source papers → output: " + n + " result records") +
      scrollTable("<th>Method</th><th class='num'>Value</th><th>Source</th>", ranked(b.records.map((r) => r.rid)).map((r) =>
        "<tr><td>" + esc(r.method) + "</td><td class='num'>" + val(r.value) + "</td><td>" + paperLink(r) + ", " + pointer(r.source_location) + (auditBadge(r) ? "<div class='small'>" + auditBadge(r) + "</div>" : "") + "<div class='small'>" + reportLink(r) + "</div></td></tr>").join(""));
    if (i === 1) return head("input: " + n + " records → output: split, metric name and unit, where recorded") +
      scrollTable("<th>Method</th><th class='num'>Value</th><th title='split'>Split</th><th title='metric name as written'>Metric name</th><th>Unit</th>", ranked(b.records.map((r) => r.rid)).map((r) => {
        const c = (v) => (v == null ? "<span class='rel-miss'>not recorded</span>" : esc(v));
        return "<tr><td>" + esc(r.method) + "</td><td class='num'>" + val(r.value) + "</td><td>" + c(r.proto.split) + "</td><td>" + c(r.proto.metric_surface) + "</td><td>" + c(r.proto.unit) + "</td></tr>"; }).join(""));
    if (i === 2) {
      const g = b.clusters.map((c) => "<div class='g " + (c.protocol.split === "test" ? "g1" : "g2") + "'><span>" + setupLine(c.protocol) + "</span><b>" + c.rids.length + (c.rids.length === 1 ? " record" : " records") + "</b> " + namesLine(c.rids, 3) + "</div>").join("");
      const u = b.unknown_rids.length ? "<div class='g g3'><span>unknown setup</span><b>" + b.unknown_rids.length + (b.unknown_rids.length === 1 ? " record" : " records") + "</b> " + namesLine(b.unknown_rids, 3) + "</div>" : "";
      return head("input: " + n + " records → output: groups") + "<div class='grp'>" + g + u + "</div>";
    }
    if (!b.scored) return head("") + "<p>" + (i === 3 ? "No question was applied, because the data do not record whether higher or lower is better on this metric." : "There is nothing to pick.") + "</p>";
    const A = b.answers;
    if (i === 3) {
      const { kept, why } = leftOut();
      let keptHtml;
      if (S.tmpl === "Q_official") keptHtml = A.Q_official.sets.length ? A.Q_official.sets.map((s) => "<li><b>" + setupLine(Object.assign({ split: "test" }, s.key)) + "</b>: " + s.rids.length + " records</li>").join("") : "<li>No group holds two records, so <b>0 are kept</b>.</li>";
      else if (S.tmpl === "Q_trend") keptHtml = A.Q_trend.years.length ? A.Q_trend.years.map((y) => "<li><b>" + y.year + "</b>: " + y.sets.map((s) => setupLine(s.key) + " (" + s.rids.length + ")").join("; ") + "</li>").join("") : "<li>No year: <b>0 kept</b>. " + esc(plainTerms(A.Q_trend.reason)) + "</li>";
      else keptHtml = A.Q_threshold.groups.length ? A.Q_threshold.groups.map((g) => "<li><b>" + setupLine(g.key) + "</b>: " + g.rids.length + " records</li>").join("") : "<li>No group tested. " + esc(plainTerms(A.Q_threshold.reason)) + "</li>";
      const rows = ranked([...why.keys()]).map((r) => "<tr><td>" + esc(r.method) + "</td><td class='num'>" + val(r.value) + "</td><td>" + esc(why.get(r.rid)) + "</td></tr>").join("");
      return head("input: " + n + " records → output: " + kept.size + " kept") + "<p class='peek-sub'>Kept</p><ul class='minilist'>" + keptHtml + "</ul>" +
        (rows ? "<p class='peek-sub'>Left out (" + why.size + ")</p>" + scrollTable("<th>Method</th><th class='num'>Value</th><th>Why</th>", rows) : "");
    }
    // stage 5
    let body;
    if (S.tmpl === "Q_official") {
      const o = A.Q_official;
      if (o.status === "robust") { const r = rec(o.winner_rid); body = "<p>Best kept record: <b>" + esc(r.method) + " " + val(r.value) + "</b> (" + setupLine(r.proto) + ").</p>"; }
      else if (o.status === "conditional") body = "<ul class='minilist'>" + o.sets.map((s) => { const w = rec(s.winner_rid); return "<li>" + setupLine(s.key.split ? s.key : Object.assign({ split: "test" }, s.key)) + ": <b>" + esc(w.method) + " " + val(w.value) + "</b></li>"; }).join("") + "</ul>";
      else body = "<p><b>Not enough evidence.</b> No group holds two comparable records, so nothing is picked.</p>";
    } else if (S.tmpl === "Q_trend") {
      const tr = A.Q_trend;
      body = tr.years.length ? "<ul class='minilist'>" + tr.years.map((y) => "<li><b>" + y.year + "</b>: " + y.sets.map((s) => { const w = rec(s.winner_rid); return esc(w.method) + " " + val(w.value) + " (" + esc(splitWord(w.proto)) + ")"; }).join("; ") + (y.agree ? "" : " <span class='muted small'>groups disagree</span>") + "</li>").join("") + "</ul>" : "<p><b>Not enough evidence.</b> " + esc(plainTerms(tr.reason)) + "</p>";
    } else {
      const q = A.Q_threshold;
      body = q.status === "insufficient" || q.champion_rid == null ? "<p><b>Not enough evidence.</b> " + esc(plainTerms(q.reason)) + "</p>" :
        "<p>Leader: <b>" + esc(rec(q.champion_rid).method) + " " + val(rec(q.champion_rid).value) + "</b>; bar: " + val(q.tau) + " (" + esc(rec(q.tau_rid).method) + ").</p><ul class='minilist'>" +
        q.groups.map((g) => "<li>" + setupLine(g.key) + ": " + val(rec(g.champion_rid).value) + " → " + (g.clears ? "<span class='rel-same'>beats the bar</span>" : "<span class='rel-diff'>does not beat the bar</span>") + "</li>").join("") + "</ul>";
    }
    const slot = certSlots()[0], hit = slot ? certFor(slot.a, slot.b) : null;
    const cert = hit ? "<p class='small'>Comparability determination (" + esc(slot.title) + "): status <b>" + esc(hit.c.status) + "</b>, outcome <span class='mono'>" + esc(hit.c.typed_outcome) + "</span>" + (hit.c.incompatible_dimensions.length ? ", differs on " + esc(hit.c.incompatible_dimensions.join(", ")) : "") + ". <button class='linkish' data-opencert='1'>Open the comparability determination</button></p>"
      : slot ? "<p class='small'>No comparability determination covers this pair. " + esc(missingReason(slot.a, slot.b)) + "</p>" : "<p class='small muted'>No answer, so no comparability determination is attached.</p>";
    return head("input: kept records → output: the answer") + body + cert;
  }

  // ------------------------------------------------------------------ flow diagram
  /* Each dot is one saved record. Dots leave their paper, pass the tag collar (where they take
     their split colour), branch into setup groups, meet the question's gate, and the kept ones
     reach the answer. Positions are layout only; every count is a count of stored records. */
  const SVGNS = "http://www.w3.org/2000/svg";
  const FW = 940, FH = 256, MID = 134, GATE_X = 656;   // five 188-wide columns, one under each stage card
  const NODE = { x0: 764, x1: 928, y0: 78, y1: 222 };
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(SVGNS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    if (parent) parent.appendChild(e);
    return e;
  };
  const svgText = (parent, x, y, text, cls, anchor) => {
    const t = svgEl("text", { x, y, class: "fl-txt " + (cls || ""), "text-anchor": anchor || "start" }, parent);
    t.textContent = text;
    return t;
  };
  const cubic = (a, b, t) => {   // horizontal-tangent S-curve between two points
    const mx = (a[0] + b[0]) / 2, u = 1 - t;
    const x = u * u * u * a[0] + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * b[0];
    const y = u * u * u * a[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * b[1];
    return [x, y];
  };
  const flowClass = (p) => (!p || p.split == null ? "unk" : p.split === "test" ? "test" : "other");
  const SHORT_SPLIT = { val: "validation", test: "test", train: "training" };

  function heldReason(rids) {
    const r = rec(rids[0]);
    if (S.tmpl === "Q_official") return r.proto.split == null ? "split not recorded" : r.proto.split !== "test" ? "not test set" : "no matching peer";
    return r.proto.split == null ? "unknown setup" : "no matching peer";
  }

  function flowModel() {
    const b = S.board, kept = b.scored ? leftOut().kept : new Set(), n = b.records.length;
    const winners = new Set();
    const A = b.answers;
    if (b.scored) {
      if (S.tmpl === "Q_official") A.Q_official.sets.forEach((s) => winners.add(s.winner_rid));
      else if (S.tmpl === "Q_trend") A.Q_trend.years.forEach((y) => y.sets.forEach((s) => winners.add(s.winner_rid)));
      else if (A.Q_threshold.status !== "insufficient") A.Q_threshold.groups.forEach((g) => winners.add(g.champion_rid));
    }
    // lanes: groups that reach the answer first, then by size; at most 5, the rest share one lane
    let lanes = b.clusters.map((c) => ({ rids: c.rids.slice(), cls: flowClass(c.protocol), label: setupLine(c.protocol), hit: c.rids.filter((i) => kept.has(i)).length }));
    lanes.sort((x, y) => (y.hit > 0) - (x.hit > 0) || y.rids.length - x.rids.length);
    if (lanes.length > 5) {
      const rest = lanes.splice(4);
      lanes.push({ rids: rest.flatMap((l) => l.rids), cls: "other", label: rest.length + " more groups", hit: rest.reduce((a, l) => a + l.hit, 0) });
    }
    if (b.unknown_rids.length) lanes.push({ rids: b.unknown_rids.slice(), cls: "unk", label: "unknown setup", hit: 0 });
    const top = 44, room = FH - top - 12, gap = 6, minH = 30;
    let hs = lanes.map((l) => Math.max(minH, (room - gap * (lanes.length - 1)) * l.rids.length / n));
    const k = (room - gap * (lanes.length - 1)) / hs.reduce((a, h) => a + h, 0);
    hs = hs.map((h) => h * Math.min(1, k));
    const tube = Math.min(48, 16 + n * 1.2);
    let y = top, cum = 0;
    lanes.forEach((l, i) => {
      l.h = hs[i]; l.y = y + hs[i] / 2; y += hs[i] + gap;
      l.b0 = MID - tube / 2 + tube * cum / n; cum += l.rids.length; l.b1 = MID - tube / 2 + tube * cum / n;
      l.bandY = (l.b0 + l.b1) / 2; l.bandH = l.b1 - l.b0;
    });
    const r = n <= 30 ? 4 : n <= 90 ? 3 : 2.2, dots = [];
    const laneOf = (rid) => lanes.find((l) => l.rids.includes(rid));

    // held dots pile up at the gate, best record nearest the gate
    lanes.forEach((l) => {
      const stopped = ranked(l.rids.filter((i) => !kept.has(i))).map((x) => x.rid);
      const cols = Math.max(1, Math.ceil(Math.sqrt(stopped.length * 3.2))), rows = Math.ceil(stopped.length / cols);
      const dx = Math.min(2 * r + 2, 90 / cols), dy = rows > 1 ? Math.min(2 * r + 2, (l.h - 14 - 2 * r) / (rows - 1)) : 0;
      stopped.forEach((rid, i) => {
        dots.push({ rid, lane: l, rest: [GATE_X - 8 - (i % cols) * dx, l.y + 6 + (Math.floor(i / cols) - (rows - 1) / 2) * dy], kept: false });
      });
      if (stopped.length) l.held = { n: stopped.length, why: heldReason(stopped) };
    });

    // the answer box is a small chart: y is the real value, best at the top
    const plot = { marks: [], ticks: [] };
    if (b.scored && kept.size) {
      const naive = rec(A.Q_any.winner_rid), q = S.tmpl === "Q_threshold" ? A.Q_threshold : null;
      const vals = [...kept].map((i) => rec(i).value).concat(kept.has(naive.rid) ? [] : [naive.value], q && q.tau != null ? [q.tau] : []);
      const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
      const yOf = (v) => { const t = (v - lo) / span; return b.direction === "higher" ? NODE.y1 - t * (NODE.y1 - NODE.y0) : NODE.y0 + t * (NODE.y1 - NODE.y0); };
      plot.ticks = [[hi, yOf(hi)], [lo, yOf(lo)]];
      const add = (rid, x) => dots.push({ rid, lane: laneOf(rid), rest: [x, yOf(rec(rid).value)], kept: true, win: winners.has(rid) });
      if (S.tmpl === "Q_trend") {
        const ys = A.Q_trend.years, xOf = (yr) => NODE.x0 + 42 + (ys.length > 1 ? (ys.findIndex((v) => v.year === yr)) * (NODE.x1 - NODE.x0 - 56) / (ys.length - 1) : 60);
        ys.forEach((yy) => { const seen = new Set(); yy.sets.forEach((s) => s.rids.forEach((rid) => { if (!seen.has(rid)) { seen.add(rid); add(rid, xOf(yy.year)); } })); });
        plot.xlabels = ys.length > 1 ? [[xOf(ys[0].year), ys[0].year], [xOf(ys[ys.length - 1].year), ys[ys.length - 1].year]] : [[xOf(ys[0].year), ys[0].year]];
      } else if (q) {
        const xOf = (i) => NODE.x0 + 44 + (q.groups.length > 1 ? i * 90 / (q.groups.length - 1) : 40);
        q.groups.forEach((g, i) => g.rids.forEach((rid, j) => add(rid, xOf(i) + (rid === g.champion_rid ? 0 : ((j % 5) - 2) * 4))));
        plot.xlabels = q.groups.map((g, i) => [xOf(i), SHORT_SPLIT[g.key.split] || g.key.split]);
        plot.bar = { y: yOf(q.tau), label: "bar " + val(q.tau) };
      } else {
        const rs = ranked([...kept]).map((x) => x.rid).filter((i) => !winners.has(i));
        [...winners].forEach((rid) => { add(rid, NODE.x0 + 40); plot.marks.push({ rid, y: yOf(rec(rid).value), text: val(rec(rid).value), cls: "win" }); });
        rs.forEach((rid, i) => add(rid, NODE.x0 + 58 + (i % 7) * 9));
      }
      if (!kept.has(naive.rid)) plot.naive = { x: NODE.x0 + 40, y: yOf(naive.value), text: "top " + val(naive.value) };
    }

    const papers = {};
    b.records.forEach((x) => { const id = x.arxiv_id || "?"; papers[id] = (papers[id] || 0) + 1; });
    const plist = Object.entries(papers).sort((p, q) => q[1] - p[1]);
    const pStep = plist.length > 1 ? (FH - 60) / (plist.length - 1) : 0;
    const pY = {}; plist.forEach(([id], i) => { pY[id] = plist.length > 1 ? 46 + i * pStep : MID; });
    dots.forEach((d) => {
      const rec0 = rec(d.rid);
      d.src = [18, pY[rec0.arxiv_id || "?"]];
      d.off = (((d.rid * 7) % 11) / 10 - 0.5);
      d.cls = flowClass(rec0.proto); d.rec = rec0;
      d.r = d.win ? r + 2.5 : r;
    });
    dots.sort((x, y) => (x.rid * 2654435761 % 997) - (y.rid * 2654435761 % 997));
    return { lanes, dots, plist, pY, r, kept, n, tube, plot };
  }

  function dotAt(d, p, tube) {
    const o = d.off * tube, ly = d.lane.y + d.off * Math.max(d.lane.h - 8, 0), b = d.lane.bandY + d.off * Math.max(d.lane.bandH - 4, 0);
    if (p < 0.18) return cubic(d.src, [188, MID + o], p / 0.18);
    if (p < 0.3) { const t = (p - 0.18) / 0.12; return [188 + t * 94, MID + o]; }
    if (p < 0.42) { const t = (p - 0.3) / 0.12; return [282 + t * 94, MID + o + (b - MID - o) * t]; }
    if (p < 0.55) return cubic([376, b], [470, ly], (p - 0.42) / 0.13);
    if (p < 0.62) return [470 + 70 * (p - 0.55) / 0.07, ly];
    const gate = d.kept ? [GATE_X + 6, ly] : d.rest;
    if (p < 0.8) { const t = (p - 0.62) / 0.18; return [540 + (gate[0] - 540) * t, ly + (gate[1] - ly) * t]; }
    return d.kept ? cubic(gate, d.rest, (p - 0.8) / 0.2) : d.rest;
  }

  /* Timeline: T runs from 0 to 5, one unit per stage. A dot's path is split at STAGE_P, and the stagger
     spreads dots within a stage while every dot still arrives by the stage's end. */
  const STAGE_P = [0, 0.18, 0.42, 0.62, 0.8, 1], STAGE_MS = 2200, HOLD_MS = 500, SEEK_MS = 260;
  function dotProgress(T, stag) {
    if (T >= 5) return 1;
    const k = Math.floor(T), u = Math.min(1, Math.max(0, (T - k) * 1.6 - stag * 0.6)), e = u * u * (3 - 2 * u);
    return STAGE_P[k] + (STAGE_P[k + 1] - STAGE_P[k]) * e;
  }

  function renderFlow() {
    const host = $("flow"), m = flowModel(), mp = pipelineModel(), tube = m.tube, rev = [];
    host.innerHTML = "";
    const rv = (el, r) => { el.classList.add("fl-rev"); rev.push({ el, r, on: true }); return el; };
    const svg = svgEl("svg", { viewBox: "0 0 " + FW + " " + FH, role: "img", "aria-label": m.n + " result records moving through five stages" }, host);
    const bands = [];
    for (let i = 0; i < 5; i++) bands.push(svgEl("rect", { x: i * FW / 5, y: 0, width: FW / 5, height: FH, class: "fl-band" }, svg));
    for (let i = 1; i < 5; i++) svgEl("line", { x1: i * FW / 5, x2: i * FW / 5, y1: 0, y2: FH, class: "fl-sep" }, svg);
    const g = svgEl("g", {}, svg);

    // stage 1: bars show how many records each paper gave
    const maxP = m.plist[0][1];
    m.plist.forEach(([id, c]) => {
      const y = m.pY[id], h = Math.min(9, Math.max(1.5, (FH - 60) / m.plist.length - 1));
      if (m.plist.length <= 40) svgEl("path", { d: "M18 " + y + " C 103 " + y + ", 103 " + MID + ", 188 " + MID, class: "fl-feed" }, g);
      svgEl("rect", { x: 4, y: y - h / 2, width: 8 + 46 * c / maxP, height: h, class: "fl-paper" }, g);
    });

    // stage 2: past the collar the pipe shows the split mix
    svgEl("rect", { x: 188, y: MID - tube / 2, width: 94, height: tube, class: "fl-pipe" }, g);
    m.lanes.forEach((l) => rv(svgEl("rect", { x: 282, y: l.b0, width: 94, height: Math.max(0.5, l.bandH), class: "fl-pipe fl-" + l.cls }, g), 1));
    svgEl("rect", { x: 279, y: MID - tube / 2 - 5, width: 6, height: tube + 10, class: "fl-collar" }, g);

    // stage 3 and 4: tapered flows, then a gate that says what it did
    let keptCum = 0;
    const keptTotal = m.lanes.reduce((a, l) => a + l.hit, 0) || 1, inH = Math.min(70, 16 + m.kept.size * 2.4), inTop = MID + 6 - inH / 2;
    m.lanes.forEach((l) => {
      const lt = l.y - (l.h - 2) / 2, lb = l.y + (l.h - 2) / 2;
      rv(svgEl("path", { d: "M376 " + l.b0 + " C 423 " + l.b0 + ", 423 " + lt + ", 470 " + lt + " H" + GATE_X + " V" + lb + " H470 C 423 " + lb + ", 423 " + l.b1 + ", 376 " + l.b1 + " Z", class: "fl-pipe fl-" + l.cls }, g), 2);
      if (l.hit) {
        const f0 = inTop + inH * keptCum / keptTotal, f1 = f0 + inH * l.hit / keptTotal;
        keptCum += l.hit;
        rv(svgEl("path", { d: "M" + GATE_X + " " + lt + " C 706 " + lt + ", 706 " + f0 + ", 756 " + f0 + " V" + f1 + " C 706 " + f1 + ", 706 " + lb + ", " + GATE_X + " " + lb + " Z", class: "fl-pipe fl-" + l.cls }, g), 3.6);
      }
      const name = l.label.replace(" set ·", " ·");
      rv(svgText(g, 476, l.y - l.h / 2 + 13, (name.length > 26 ? name.slice(0, 25) + "…" : name) + " · " + l.rids.length, "fl-lane"), 2);
      rv(svgEl("rect", { x: GATE_X, y: l.y - (l.h - 2) / 2 - 2, width: 4, height: l.h + 2, class: "fl-gate" + (l.hit ? " open" : "") }, g), 3);
      if (l.hit) rv(svgText(g, GATE_X + 9, l.y - 2, l.hit + " kept", "fl-gatetxt ok"), 3.9);
      if (l.held) {
        const yy = l.hit ? l.y + 10 : l.y + 3;
        rv(svgText(g, GATE_X + 9, yy - (l.hit ? 0 : 5), l.held.n + " held", "fl-gatetxt"), 3.9);
        rv(svgText(g, GATE_X + 9, yy + (l.hit ? 11 : 7), l.held.why, "fl-gatetxt why"), 3.9);
      }
    });

    // stage 5: the answer box is a chart on the real value scale
    const box = svgEl("g", {}, g);
    rv(box, 4);
    svgEl("rect", { x: 756, y: 44, width: 180, height: 204, class: "fl-node" + (m.kept.size ? "" : " empty") }, box);
    const P = m.plot;
    if (P.ticks.length) {
      svgEl("line", { x1: NODE.x0 + 30, x2: NODE.x0 + 30, y1: NODE.y0 - 4, y2: NODE.y1 + 4, class: "fl-axis" }, box);
      P.ticks.forEach(([v, y]) => svgText(box, NODE.x0 + 27, y + 3, val(v), "fl-tick", "end"));
      (P.xlabels || []).forEach(([x, t]) => svgText(box, x, NODE.y1 + 14, t, "fl-tick", "middle"));
      if (P.bar) {
        svgEl("line", { x1: NODE.x0 + 30, x2: NODE.x1, y1: P.bar.y, y2: P.bar.y, class: "fl-bar" }, box);
        svgText(box, NODE.x1 + 2, P.bar.y - 3, P.bar.label, "fl-tick", "end");
      }
      P.marks.forEach((k) => rv(svgText(box, NODE.x1 + 2, k.y + 3, k.text, "fl-mark", "end"), 4.9));
      if (P.naive) {
        svgEl("circle", { cx: P.naive.x, cy: P.naive.y, r: 5, class: "fl-top" }, box);
        svgText(box, NODE.x1 + 2, P.naive.y + 3, P.naive.text, "fl-mark top", "end");
      }
    } else {
      svgText(box, 846, 142, "nothing reached the answer", "fl-tick", "middle");
    }
    rv(svgText(g, 846, 60, mp.stages[4].out, "fl-out", "middle"), 4.9);
    // each count is what its stage produced, centred under that stage's card
    const nP = m.plist.length;
    mp.arrows.forEach((a, i) => rv(svgText(g, (i + 0.5) * FW / 5, 20, i === 0 ? m.n + " records · " + nP + (nP === 1 ? " paper" : " papers") : a, "fl-count", "middle"), i + 0.9));

    // one circle per saved record; applyT places them all on every frame
    const layer = svgEl("g", {}, svg);
    m.dots.forEach((d) => {
      d.el = svgEl("circle", { r: d.kept ? m.r : d.r, cx: 0, cy: 0, class: "fl-dot raw" }, layer);
      svgEl("title", {}, d.el).textContent = d.rec.method + " " + val(d.rec.value) + " · " + splitWord(d.rec.proto) + (d.rec.arxiv_id ? " · arXiv:" + d.rec.arxiv_id : "");
      d.stag = ((d.rid * 2654435761) % 1000) / 1000;
      d.state = "";
    });
    S.flow = { m, rev, bands, tubeIn: tube - 8 };
  }

  function applyT() {
    const T = S.T, f = S.flow;
    f.m.dots.forEach((d) => {
      const p = dotProgress(T, d.stag), [x, y] = dotAt(d, p, f.tubeIn);
      d.el.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")");
      const state = (p < 0.3 ? "raw" : d.cls) + (T >= 3.9 && !d.kept ? " held" : "") + (T >= 4.9 && d.win ? " win" : "");
      if (state !== d.state) { d.state = state; d.el.setAttribute("class", "fl-dot " + state); d.el.setAttribute("r", T >= 4.9 && d.win ? d.r : Math.min(d.r, f.m.r)); }
    });
    f.rev.forEach((e) => { const on = T >= e.r; if (on !== e.on) { e.on = on; e.el.classList.toggle("off", !on); } });
    const stage = Math.max(0, Math.min(4, Math.ceil(T) - 1));
    if (stage !== S.stage) { S.stage = stage; renderPipeline(); }
    f.bands.forEach((b, i) => b.classList.toggle("on", i === S.stage));
    syncLeaderboard();
    $("pPlay").textContent = S.playing ? "Pause" : T >= 5 ? "Replay" : "Play";
  }

  function tick(now) {
    const dt = Math.min(64, now - S.last); S.last = now;
    if (S.seekTo != null) {
      const d = S.seekTo - S.T, step = dt / SEEK_MS;
      S.T = Math.abs(d) <= step ? S.seekTo : S.T + Math.sign(d) * step;
      if (S.T === S.seekTo) S.seekTo = null;
    } else if (S.playing) {
      if (S.hold > 0) S.hold -= dt * S.speed;
      else {
        const next = Math.floor(S.T) + 1;
        S.T += dt * S.speed / STAGE_MS;
        if (S.T >= next) { S.T = next; S.hold = HOLD_MS; }
        if (S.T >= 5) { S.T = 5; S.playing = false; }
      }
    }
    applyT();
    if (S.playing || S.seekTo != null) S.raf = requestAnimationFrame(tick);
    else S.raf = null;
  }
  const wake = () => { if (!S.raf) { S.last = performance.now(); S.raf = requestAnimationFrame(tick); } };
  function seek(T) { S.playing = false; S.seekTo = T; S.hold = 0; wake(); }
  function togglePlay() {
    if (S.playing) { S.playing = false; applyT(); return; }
    if (S.T >= 5) S.T = 0;
    S.seekTo = null; S.hold = 0; S.playing = true; wake();
  }
  function stopTimeline() { cancelAnimationFrame(S.raf); S.raf = null; S.playing = false; S.seekTo = null; closeInspect(); }
  function startTimeline() {
    stopTimeline();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || /[?&]still\b/.test(location.search);
    S.T = still ? 5 : 0; S.hold = HOLD_MS; S.lbPhase = null;
    S.flow.rev.forEach((e) => { e.on = true; });
    S.stage = -1;
    applyT();
    if (!still) { S.playing = true; wake(); }
  }

  // ------------------------------------------------------------------ leaderboard panel
  /* Before: every record by value. After: only the records the question keeps. Ranks move because
     records are set aside by their stored labels; no value is ever changed. */
  function rankMap(rs) {
    const m = new Map();
    rs.forEach((r, i) => m.set(r.rid, i && rs[i - 1].value === r.value ? m.get(rs[i - 1].rid) : i + 1));
    return m;
  }
  function lbModel() {
    const b = S.board, all = ranked(b.records.map((r) => r.rid)), before = rankMap(all), sections = [], { why } = leftOut();
    if (b.scored) {
      const A = b.answers, keyLine = (k) => setupLine(k.split ? k : Object.assign({ split: "test" }, k));
      if (S.tmpl === "Q_official") A.Q_official.sets.forEach((s) => sections.push({ title: A.Q_official.sets.length > 1 ? keyLine(s.key) : null, rids: s.rids, win: [s.winner_rid] }));
      else if (S.tmpl === "Q_trend") A.Q_trend.years.forEach((y) => y.sets.forEach((s) => sections.push({ title: y.year + " · " + keyLine(s.key), rids: s.rids, win: [s.winner_rid] })));
      else A.Q_threshold.groups.forEach((g) => sections.push({ title: keyLine(g.key) + (g.clears ? " · beats the bar" : " · does not beat the bar"), rids: g.rids, win: [g.champion_rid] }));
    }
    const single = S.tmpl === "Q_official" && sections.length === 1, after = single ? rankMap(ranked(sections[0].rids)) : new Map();
    return { all, before, sections, why, single, after };
  }

  function buildLeaderboard() {
    const M = lbModel(), b = S.board, CAP = 30;
    // long boards show the head of each ranking; every record stays listed under "All records"
    let show = new Set(M.all.map((r) => r.rid));
    if (b.records.length > 2 * CAP) {
      show = new Set(M.all.slice(0, CAP).map((r) => r.rid));
      M.sections.forEach((s) => { ranked(s.rids).slice(0, CAP).forEach((r) => show.add(r.rid)); s.win.forEach((w) => show.add(w)); });
    }
    const list = $("lbList"), rows = new Map();
    list.textContent = "";
    show.forEach((rid) => {
      const r = rec(rid), el = document.createElement("div"), bad = auditOf(r) && /wrong/.test(auditOf(r).verdict);
      el.dataset.rid = rid;
      el.innerHTML = "<span class='lb-r'></span><span class='lb-m'></span><span class='lb-v'></span><span class='lb-t'></span><span class='lb-x'></span>";
      el.children[1].textContent = r.method + (bad ? " \u26a0" : "");
      el.children[1].title = r.method;
      el.children[2].textContent = val(r.value);
      rows.set(rid, el);
    });
    S.lb = { M, rows, show };
    $("lbNote").textContent = b.records.length > show.size ? "showing " + show.size + " of " + b.records.length + " records" : "hover a row for its data";
    $("lbFoot").textContent = !b.scored ? "This metric's direction is not recorded, so these records have no ranking."
      : "Ranks change because records are set aside by their stored labels. No value is changed.";
  }

  function syncLeaderboard() {
    const T = S.T, phase = T >= 5 ? 3 : T >= 4 ? 2 : T >= 2 ? 1 : 0, was = S.lbPhase;
    if (phase === was) return;
    S.lbPhase = phase;
    const { M, rows, show } = S.lb, b = S.board, list = $("lbList"), naive = b.scored ? b.answers.Q_any.winner_rid : null;
    const first = new Map(); rows.forEach((el, rid) => { if (el.isConnected) first.set(rid, el.getBoundingClientRect().top); });
    const tag = (r) => (r.proto.split == null ? "?" : String(r.proto.split).slice(0, 5));
    const paint = (rid, rank, x, xc, cls) => {
      const el = rows.get(rid), r = rec(rid);
      el.className = "lb-row " + (phase ? (r.proto.split === "test" ? "t-test " : "") : "") + (rid === naive ? "top " : "") + (S.pinned === rid ? "pinned " : "") + cls;
      el.children[0].textContent = b.scored ? rank : "";
      el.children[3].textContent = phase ? "[" + tag(r) + "]" : "";
      el.children[4].textContent = x; el.children[4].className = "lb-x " + xc;
      list.appendChild(el);
    };
    const section = (t) => { const h = document.createElement("div"); h.className = "lb-sec"; h.textContent = t; list.appendChild(h); };
    list.textContent = "";
    if (phase < 2 || !b.scored) {
      M.all.filter((r) => show.has(r.rid)).forEach((r) => paint(r.rid, M.before.get(r.rid), "", "", ""));
      $("lbTitle").textContent = "All records";
    } else {
      const placed = new Set(), going = was != null && phase > was;
      M.sections.forEach((s) => {
        if (s.title) section(s.title);
        const rk = rankMap(ranked(s.rids));
        ranked(s.rids).forEach((r) => {
          if (!show.has(r.rid) || placed.has(r.rid)) return;
          placed.add(r.rid);
          const win = phase === 3 && s.win.includes(r.rid), bf = M.before.get(r.rid), af = M.after.get(r.rid);
          let x = "", xc = "";
          if (M.single) { const d = bf - af; x = "#" + bf + " \u2192 #" + af + (d ? " (+" + d + ")" : " (=)"); xc = d ? "up" : "same"; }
          paint(r.rid, rk.get(r.rid), x, xc, (win ? "win " : "") + (going && ((phase === 2 && xc === "up") || (phase === 3 && win)) ? "flash-up" : ""));
        });
      });
      const out = M.all.filter((r) => show.has(r.rid) && !placed.has(r.rid));
      if (out.length) section("Left out (" + M.why.size + ")");
      out.forEach((r) => paint(r.rid, "\u2013", M.why.get(r.rid) || "", "down", "out " + (going && phase === 2 ? "flash-down" : "")));
      $("lbTitle").textContent = S.tmpl === "Q_official" ? "Comparable records only" : S.tmpl === "Q_trend" ? "Records by preprint year" : "Records by group";
      if (!M.sections.length) { const p = document.createElement("div"); p.className = "lb-sec"; list.prepend(p); p.textContent = "No ranking: not enough evidence."; }
    }
    // rows glide from where they were to where they now belong
    const ms = 620 / (S.speed || 1);
    if (was != null) rows.forEach((el, rid) => {
      const y0 = first.get(rid); if (y0 == null || !el.isConnected) return;
      const dy = y0 - el.getBoundingClientRect().top;
      if (dy) el.animate([{ transform: "translateY(" + dy + "px)" }, { transform: "none" }], { duration: ms, easing: "cubic-bezier(.2,.7,.2,1)" });
    });
  }

  function showInspect(rid, row, pin) {
    const r = rec(rid), box = $("inspect"), q = row.getBoundingClientRect();
    if (S.pinnedEl) S.pinnedEl.classList.remove("pinned");
    S.pinned = pin ? rid : null; S.pinnedEl = pin ? row : null;
    if (pin) row.classList.add("pinned");
    box.className = "inspect" + (pin ? " pinned" : "");
    box.innerHTML = "<div class='inspect-h'><span>" + esc(r.method) + "</span>" + (pin ? "<button data-close='1'>Close</button>" : "") + "</div>" +
      "<div class='small'>" + paperLink(r) + ", " + pointer(r.source_location) + "</div>" + (auditBadge(r) ? "<div class='small'>" + auditBadge(r) + "</div>" : "") +
      "<pre class='code'>" + esc(JSON.stringify(r, null, 2)) + "</pre><div class='small muted'>The stored record; field names as released.</div>" +
      (pin ? "<div class='small'>" + reportLink(r) + "</div>" : "<div class='small muted'>Click the row to keep this open and follow the source.</div>");
    box.hidden = false;
    box.style.left = Math.max(8, q.left - box.offsetWidth - 8) + "px";
    box.style.top = Math.max(8, Math.min(q.top, window.innerHeight - box.offsetHeight - 8)) + "px";
  }
  function closeInspect() {
    if (S.pinnedEl) S.pinnedEl.classList.remove("pinned");
    S.pinned = null; S.pinnedEl = null; $("inspect").hidden = true;
  }

  // ------------------------------------------------------------------ closed sections
  function renderBoard() {
    const b = S.board, sel = selectedClusters();
    $("boardSummary").innerHTML = "All " + b.records.length + " records, grouped by setup";
    const naive = b.answers ? b.answers.Q_any.winner_rid : null;
    let qual = null;
    if (b.answers) {
      if (S.tmpl === "Q_official") qual = b.answers.Q_official.winner_rid;
      if (S.tmpl === "Q_threshold") qual = b.answers.Q_threshold.status !== "insufficient" ? b.answers.Q_threshold.champion_rid : null;
    }
    const row = (r, i) => "<tr class='pick" + (S.picks.includes(r.rid) ? " chosen" : "") + "' data-rid='" + r.rid + "'><td class='num'>" + (i == null ? "" : i + 1) +
      "</td><td>" + esc(r.method) + (r.rid === naive ? "<span class='mark n' title='the top number on the leaderboard'>top</span>" : "") + (r.rid === qual ? "<span class='mark q' title='the fair-comparison answer'>fair</span>" : "") +
      "</td><td class='num'>" + val(r.value) + "</td><td>" + paperLink(r) + "<div class='small muted'>" + pointer(r.source_location) + "</div>" +
      (auditBadge(r) ? "<div class='small'>" + auditBadge(r) + "</div>" : "") + "<div class='small'>" + reportLink(r) + "</div></td></tr>";
    const table = (rs, numbered, id) => {
      const LIM = 10, open = S.open[id], shown = open ? rs : rs.slice(0, LIM);
      return "<div class='tbl-scroll'><table><thead><tr><th class='num'>#</th><th>Method</th><th class='num'>Value</th><th>Source</th></tr></thead><tbody>" +
        shown.map((r, i) => row(r, numbered ? i : null)).join("") + "</tbody></table></div>" +
        (rs.length > LIM ? "<button class='linkish' data-open='" + id + "'>" + (open ? "Show fewer" : "Show all " + rs.length) + "</button>" : "");
    };
    let html = "<p class='small'>" + dirWord() + " · identity grade <span class='mono' title='how confidently the board identity resolves to the source data'>" + esc(b.grade) + "</span>. Pick any two records to open their comparability determination." +
      (S.picks.length === 1 ? " One record picked; pick another." : "") + "</p>" + (spellingOnly(b.clusters.map((c) => c.protocol)) ? SPELLING_NOTE : "") + "<div class='subboards'>";
    b.clusters.forEach((c, i) => {
      const labels = [];
      if (i === b.principal_cluster) labels.push("<span class='sb-label'>largest comparable group</span>");
      if (sel.has(i)) labels.push("<span class='sb-label sel'>used by this question</span>");
      html += "<div class='sb" + (sel.has(i) ? " selected" : "") + "'><div class='sb-head'>" + protoChips(c.protocol) + "<span>" + labels.join(" · ") + "</span></div>" + table(ranked(c.rids), true, "c" + i) + "</div>";
    });
    if (b.unknown_rids.length) html += "<div class='sb unknown'><div class='sb-head'><span class='sb-label'>Unknown setup: flagged, not ranked</span></div>" +
      "<p class='small muted'>Split, metric name or unit not all recorded. Listed by value for reference only.</p>" + table(ranked(b.unknown_rids), false, "u") + "</div>";
    $("boardBody").innerHTML = html + "</div>";
    $("boardBody").onclick = (e) => {
      const more = e.target.closest("[data-open]");
      if (more) { S.open[more.dataset.open] = !S.open[more.dataset.open]; renderBoard(); return; }
      const tr = e.target.closest("tr.pick"); if (!tr || e.target.closest("a")) return;
      const rid = +tr.dataset.rid;
      if (S.picks.includes(rid)) S.picks = S.picks.filter((x) => x !== rid);
      else S.picks = S.picks.length >= 2 ? [rid] : S.picks.concat(rid);
      if (S.picks.length === 2) S.slot = 0;
      renderBoard();
      if (S.board.scored) renderCertificates(); else renderPickOnly();
      if (S.picks.length === 2) { $("certSection").open = true; $("certSection").scrollIntoView({ behavior: "smooth", block: "start" }); }
    };
  }

  function renderPickOnly() {
    $("certSection").hidden = S.picks.length !== 2;
    if (S.picks.length !== 2) return;
    $("certIntro").textContent = ""; $("certSlots").innerHTML = "";
    const c = certFor(S.picks[0], S.picks[1]);
    $("certBody").innerHTML = c ? certHTML(c) : missingHTML(S.picks[0], S.picks[1]);
  }

  function renderThreshold() {
    const b = S.board, sec = $("thresholdSection");
    sec.hidden = !b.scored || S.tmpl !== "Q_threshold";
    if (sec.hidden) return;
    const q = b.answers.Q_threshold, name = q.champion_rid != null ? rec(q.champion_rid).method + "’s" : "the test-set";
    $("thresholdSummary").innerHTML = "Does " + esc(name) + " lead hold under other setups?";
    if (q.champion_rid == null) { $("thresholdBody").innerHTML = "<p>Not enough evidence. " + esc(plainTerms(q.reason)) + "</p>"; return; }
    const c = rec(q.champion_rid), tr = rec(q.tau_rid);
    let html = "<p class='small'>The test-set leader and the bar (the next test-set record) come from the largest test-set group. The leader must beat the bar in every group where it meets a rival.</p>" +
      "<ul class='minilist'><li>Leader: <b>" + esc(c.method) + " " + val(c.value) + "</b></li><li>Bar: " + val(q.tau) + " (" + esc(tr.method) + ", " + paperLink(tr) + ")</li></ul>";
    if (q.status === "insufficient") html += "<p><b>Not enough evidence.</b> " + esc(plainTerms(q.reason)) + "</p>";
    else html += "<div class='tbl-scroll'><table><thead><tr><th>Group</th><th class='num'>Leader</th><th>Beats the bar?</th><th class='num'>n</th></tr></thead><tbody>" +
      q.groups.map((g) => "<tr><td>" + protoShort(g.key) + "</td><td class='num'>" + val(rec(g.champion_rid).value) + "</td><td>" + (g.clears ? "<span class='rel-same'>yes</span>" : "<span class='rel-diff'>no</span>") + "</td><td class='num'>" + g.rids.length + "</td></tr>").join("") +
      "</tbody></table></div>" + (spellingOnly(q.groups.map((g) => g.key)) ? SPELLING_NOTE : "");
    $("thresholdBody").innerHTML = html;
  }

  function renderTyped() {
    const T = S.board.typed_questions || [];
    $("typedSection").hidden = !T.length;
    if (!T.length) return;
    $("typedSummary").innerHTML = "Typed comparative questions on this leaderboard <span>· " + T.length + " development record" + (T.length === 1 ? "" : "s") + "</span>";
    const prov = (p) => p.map((x) => esc(x.method) + " " + val(x.value) + " (" + paperLink(x) + ", " + pointer(x.source_location) + ")").join("; ");
    $("typedBody").innerHTML = T.map((q) => {
      const conds = (q.conditions || []).map((c) => "<li>" + protoChips(c.protocol) + " " +
        (c.verdict ? "verdict: <b>" + esc(c.verdict) + "</b>" : "leader and every method within its noise band: " + esc((c.winners || []).join(", "))) +
        (c.provenance && c.provenance.length ? "<details><summary>" + c.provenance.length + " record pointer(s)</summary>" + prov(c.provenance) + "</details>" : "") + "</li>").join("");
      return "<div class='typed-item'><div><b>" + esc(q.question) + "</b></div><div class='small'><span class='atype'>" + esc(q.answer_type.replace("_", " ")) + "</span>" +
        (q.answer != null ? " answer: <b>" + esc(q.answer) + "</b>" : "") + (q.abstention_warranted ? " · abstention warranted" : "") + "</div>" +
        "<div class='small muted'>" + esc(plainTerms(q.rationale)) + "</div>" + (conds ? "<ul class='small'>" + conds + "</ul>" : "") +
        (q.provenance && q.provenance.length ? "<div class='small'>Records: " + prov(q.provenance) + "</div>" : "") + "</div>";
    }).join("");
  }

  // ------------------------------------------------------------------ browse page
  const OUTCOME = {
    differ: ["w", "answers differ"], same: ["g", "same answer"], none: ["n", "not enough evidence"],
    depends: ["q", "depends on the group"], noanswer: ["n", "no answer · metric direction unknown"],
  };
  function outcomeOf(r) {
    if (!r.scored) return "noanswer";
    const s = r.st.Q_official;
    return s === "i" ? "none" : s === "c" ? "depends" : r.flip ? "differ" : "same";
  }
  const PAGE = 100;
  function prepareBrowse() {
    if (S.browse) return;
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const rows = S.index.map((r) => ({ r, key: norm(r.dataset + " " + r.metric), oc: outcomeOf(r), hand: S.auditBoards.has(r.id), bad: S.auditBoards.get(r.id) }));
    const rank = (x) => (x.hand ? 0 : x.oc === "differ" ? 1 : 2);
    rows.sort((a, b) => rank(a) - rank(b) || b.r.n - a.r.n || a.key.localeCompare(b.key));
    S.browse = { rows, q: "", f: "all", shown: PAGE, list: rows, norm };
  }
  function filterBrowse() {
    const B = S.browse, toks = B.norm(B.q).split(" ").filter(Boolean);
    B.list = B.rows.filter((x) => (B.f === "all" || (B.f === "hand" ? x.hand : x.oc === B.f)) && toks.every((t) => x.key.includes(t)));
    B.shown = PAGE;
    drawRows();
  }
  function drawRows() {
    const B = S.browse;
    $("browseRows").innerHTML = B.list.slice(0, B.shown).map((x) => {
      const r = x.r, [cls, txt] = OUTCOME[x.oc];
      const check = !x.hand ? "" : x.bad === 2 ? " <span class='chk bad'>\u26a0 checked, errors found</span>" : x.bad === 1 ? " <span class='chk unsure'>? checked, one label unclear</span>" : " <span class='chk'>\u2713 checked</span>";
      return "<tr data-id='" + esc(r.id) + "'><td><a href='#q=Q_official&b=" + encodeURIComponent(r.id) + "'>" + esc(r.dataset) + "</a>" + check + "</td><td>" + esc(r.metric) + "</td><td class='num'>" + r.n + "</td><td><span class='pill tiny " + cls + "'>" + esc(txt) + "</span></td></tr>";
    }).join("");
    $("browseCount").textContent = "Showing " + fmt(Math.min(B.shown, B.list.length)) + " of " + fmt(B.list.length) + (B.list.length === B.rows.length ? "" : " matching") + " leaderboards.";
    $("browseMore").hidden = B.shown >= B.list.length;
  }
  function showBrowse() {
    prepareBrowse();
    const B = S.browse;
    $("boardView").hidden = true; $("browseView").hidden = false;
    if (!$("browseRows")) {
      const n = (f) => fmt(B.rows.filter((x) => (f === "hand" ? x.hand : x.oc === f)).length);
      $("browseView").innerHTML = "<h2 class='ask'>Browse all " + fmt(B.rows.length) + " saved leaderboards</h2>" +
        "<p class='muted'>Answers were computed once, offline, from a frozen Papers with Code archive. Pick a leaderboard to see both answers and how they were made.</p>" +
        "<div class='bfilters'><input id='browseQ' type='text' placeholder='Filter by dataset or metric' aria-label='Filter by dataset or metric' autocomplete='off' spellcheck='false'>" +
        "<div class='chips' id='browseF'>" + [["all", "All"], ["differ", "Answers differ (" + n("differ") + ")"], ["same", "Same answer (" + n("same") + ")"], ["none", "Not enough evidence (" + n("none") + ")"], ["hand", "✓ Checked by hand (" + n("hand") + ")"]]
          .map(([f, t]) => "<button class='chip" + (f === "all" ? " on" : "") + "' data-f='" + f + "'>" + esc(t) + "</button>").join("") + "</div></div>" +
        "<div class='btable'><table><thead><tr><th>Dataset</th><th>Metric</th><th class='num'>Result records</th><th>Outcome</th></tr></thead><tbody id='browseRows'></tbody></table></div>" +
        "<p class='small muted' id='browseCount'></p><p><button class='linkish' id='browseMore'>Show more</button></p><div id='browseEnd'></div>";
      $("browseQ").oninput = (e) => { B.q = e.target.value; filterBrowse(); };
      $("browseF").onclick = (e) => {
        const c = e.target.closest("button"); if (!c) return;
        B.f = c.dataset.f; [...$("browseF").children].forEach((x) => x.classList.toggle("on", x === c)); filterBrowse();
      };
      const more = () => { if (B.shown < B.list.length) { B.shown += PAGE; drawRows(); } };
      $("browseMore").onclick = more;
      $("browseRows").onclick = (e) => { const tr = e.target.closest("tr[data-id]"); if (tr && !e.target.closest("a")) go(tr.dataset.id, "Q_official"); };
      if ("IntersectionObserver" in window) new IntersectionObserver((es) => { if (es[0].isIntersecting && !$("browseView").hidden) more(); }, { rootMargin: "300px" }).observe($("browseEnd"));
      drawRows();
    }
    window.scrollTo(0, 0);
    $("browseQ").focus({ preventScroll: true });
  }

  init().catch((e) => {
    $("ask").textContent = "Could not load the saved data (" + e.message + "). If you opened this file directly, serve the folder over HTTP instead.";
  });
})();
