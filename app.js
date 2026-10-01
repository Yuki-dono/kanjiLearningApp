const LEVELS = ["N5","N4","N3","N2","N1"];
let KANJI = [];   // {character, level, onyomi[], kunyomi[], meanings[], strokes, freq}
let VOCAB = [];   // {word, reading, meanings[], level}
let kanjiMap = new Map();
let libPage = 1;
let libFocus = null;       // character shown in the library preview rail
const LIB_PAGE_SIZE = 24;
let compShown = 60;

// ---------- load ----------
async function loadData() {
  const kPromises = LEVELS.map(l => fetch(`data/kanji-${l.toLowerCase()}.json`).then(r => r.json()));
  const vPromises = LEVELS.map(l => fetch(`data/vocab-${l.toLowerCase()}.json`).then(r => r.json()));
  const kAll = await Promise.all(kPromises);
  const vAll = await Promise.all(vPromises);
  KANJI = kAll.flat();
  VOCAB = vAll.flat();
  KANJI.forEach(k => kanjiMap.set(k.character, k));
  buildReadingIndex();
  renderLibrary();
  renderCurated();
  renderCompounds();
  renderBest();
  initDaily();
  paintFeatureAnatomy();
  paintCompRules();
  paintRelated();
  supaInit();
}

// ---------- inline icon set ----------
const ICONS = {
  sun:   '<path d="M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4L7 17M17 7l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
  book:  '<path d="M4 5.5A2.5 2.5 0 016.5 3H19v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M4 20.5A2.5 2.5 0 016.5 18H19v3H6.5"/><path d="M9 7h6"/>',
  check: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 3.2V5M15 3.2V5"/><path d="M8.5 13l2.5 2.5 4.5-5.5"/>',
  layers:'<path d="M12 3l8.5 4.5L12 12 3.5 7.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 17L12 21.5 20.5 17"/>',
  kbd:   '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9.5h.01M10 9.5h.01M14 9.5h.01M18 9.5h.01M8 15h8"/>',
  moon:  '<path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z"/>',
  menu:  '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
  bulb:  '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.5.4.8 1 .8 1.6v.5h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0012 3z"/>',
  play:  '<path d="M7 4.5l12 7.5-12 7.5z"/>',
  eye:   '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
};
function icon(name, size = 16) {
  const d = ICONS[name] || "";
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
function paintIcons(root = document) {
  root.querySelectorAll("[data-ico]").forEach(el => {
    if (el.dataset.painted) return;
    el.innerHTML = icon(el.dataset.ico, Number(el.dataset.icoSize) || 16);
    el.style.display = "inline-flex";
    el.dataset.painted = "1";
  });
}

// ---------- tabs ----------
document.querySelectorAll(".tabs button").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tabs button").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    document.getElementById("app").classList.remove("nav-open");
    // reshuffle compounds every time the tab is opened
    if (btn.dataset.tab === "compounds" && KANJI.length) {
      shuffleCompounds();
    }
  };
});

// ---------- sidebar (mobile drawer + prefs) ----------
function closeNav() { document.getElementById("app").classList.remove("nav-open"); }
document.getElementById("menu-btn").onclick = () => document.getElementById("app").classList.toggle("nav-open");
document.getElementById("nav-scrim").onclick = closeNav;
document.getElementById("side-shortcuts").onclick = () => {
  document.getElementById("help-modal").classList.remove("hidden");
  closeNav();
};
document.getElementById("help-close").onclick = () =>
  document.getElementById("help-modal").classList.add("hidden");
document.getElementById("side-theme").onclick = toggleTheme;
document.getElementById("comp-goal-btn").onclick = () => {
  document.querySelector("[data-tab='daily']").click();
};
// scrollIntoView isn't implemented in every environment (and is a no-op when the
// element is already in view) — guard so a missing impl can't break a click handler
function scrollTo(el, opts) {
  try { el?.scrollIntoView?.(opts); } catch {}
}

function toggleTheme() {
  const dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  try { localStorage.setItem("kanji-theme", dark ? "dark" : "light"); } catch {}
  paintTheme();
  closeNav();
}

// ---------- library ----------
function libFilters() {
  const levels = [...document.querySelectorAll("#lib-levels input:checked")].map(i => i.value);
  const q = document.getElementById("lib-search").value.trim().toLowerCase();
  const sort = document.getElementById("lib-sort").value;
  let list = KANJI.filter(k => levels.includes(k.level));
  if (q) {
    list = list.filter(k =>
      k.character.includes(q) ||
      k.meanings.join(" ").toLowerCase().includes(q) ||
      (k.onyomi||[]).join(" ").toLowerCase().includes(q) ||
      (k.kunyomi||[]).join(" ").toLowerCase().includes(q)
    );
  }
  if (sort === "freq") list.sort((a,b) => (a.freq||9999)-(b.freq||9999));
  if (sort === "strokes") list.sort((a,b) => (a.strokes||99)-(b.strokes||99));
  if (sort === "level") list.sort((a,b) => LEVELS.indexOf(a.level)-LEVELS.indexOf(b.level));
  return list;
}

function renderLibrary() {
  const list = libFilters();
  const pages = Math.max(1, Math.ceil(list.length / LIB_PAGE_SIZE));
  libPage = Math.min(Math.max(1, libPage), pages);
  const from = list.length ? (libPage - 1) * LIB_PAGE_SIZE + 1 : 0;
  const to = Math.min(libPage * LIB_PAGE_SIZE, list.length);
  document.getElementById("lib-stats").textContent =
    `Showing ${from}–${to} of ${list.length.toLocaleString()} characters`;
  const grid = document.getElementById("lib-grid");
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = '<p class="sub" style="grid-column:1/-1">No kanji match this filter — try another level or search term.</p>';
  }
  list.slice((libPage - 1) * LIB_PAGE_SIZE, libPage * LIB_PAGE_SIZE).forEach(k => {
    const d = document.createElement("div");
    d.className = "card tile" + (libFocus === k.character ? " is-focus" : "");
    let dot = "";
    try {
      const st = srsStatus(k.character);
      if (st === "new") dot = '<span class="dot new" title="new today"></span>';
      else if (st === "due") dot = '<span class="dot due" title="review due"></span>';
      else if (st === "learned") dot = '<span class="dot learned" title="mastered"></span>';
    } catch {}
    d.innerHTML = `<div class="tile-top"><span class="badge">${k.level}</span>${dot}</div>
      <div class="k">${k.character}</div>
      <div class="m">${esc(k.meanings.slice(0,2).join(", "))}</div>
      <div class="r">${esc((k.onyomi||[]).slice(0,2).join("・")||"—")} · ${esc((k.kunyomi||[]).slice(0,2).join("・")||"—")}</div>
      <div class="strokes">${k.strokes ?? "—"} strokes</div>
      <span class="tile-go" aria-hidden="true">${icon("eye",14)}</span>`;
    d.onclick = () => { libFocus = k.character; paintLibPreview(k.character); renderLibrary(); };
    grid.appendChild(d);
  });
  renderLibPager(pages);
}

function renderLibPager(pages) {
  const box = document.getElementById("lib-pager");
  box.innerHTML = "";
  const go = (p, label, disabled) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.disabled = !!disabled;
    if (p === libPage) b.classList.add("cur");
    b.onclick = () => {
      libPage = Math.min(Math.max(1, p), pages);
      renderLibrary();
      scrollTo(document.getElementById("lib-grid"), { block: "start" });
    };
    box.appendChild(b);
  };
  go(libPage - 1, "← Prev", libPage <= 1);
  const nums = [...new Set([1, pages, libPage - 1, libPage, libPage + 1])]
    .filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) {
      const s = document.createElement("span");
      s.textContent = "…";
      s.className = "gap";
      box.appendChild(s);
    }
    go(n, String(n), false);
    prev = n;
  }
  go(libPage + 1, "Next →", libPage >= pages);
}

// right-rail preview: full character dossier, no modal needed
function paintLibPreview(ch) {
  const box = document.getElementById("lib-preview");
  if (!box) return;
  const k = kanjiMap.get(ch);
  if (!k) {
    box.innerHTML = '<p class="sub">Pick a kanji from the grid to inspect its readings and vocabulary.</p>';
    return;
  }
  const words = VOCAB.filter(v => v.word.includes(ch)).slice(0, 6);
  let st = "", dot = "";
  try {
    st = srsStatus(ch);
    if (st === "learned") dot = '<span class="dot learned"></span>';
    else if (st === "due") dot = '<span class="dot due"></span>';
    else if (st === "new") dot = '<span class="dot new"></span>';
  } catch {}
  const lvStat = ` JLPT ${esc(k.level)}`;
  box.innerHTML = `
    <div class="pv-kanji">${esc(ch)}</div>
    <div class="pv-sub">
      <span class="chip chip-brand">${lvStat}</span>
      ${dot ? `<span class="chip chip-quiet">${esc(st === "learned" ? "Mastered" : st === "due" ? "In learning" : "Unseen")}</span>` : ""}
      <span class="chip chip-quiet">${k.strokes ?? "—"} strokes</span>
    </div>
    <p class="pv-meaning">${esc(k.meanings.join(", "))}</p>
    <div class="pv-fam">
      <div class="fam"><p class="eyebrow">On'yomi · 音読み</p><div class="val">${esc((k.onyomi||[]).join("・")||"—")}</div></div>
      <div class="fam"><p class="eyebrow">Kun'yomi · 訓読み</p><div class="val">${esc((k.kunyomi||[]).join("・")||"—")}</div></div>
    </div>
    <div class="pv-compounds">
      <p class="eyebrow" style="margin-bottom:7px">Frequent compounds</p>
      ${words.map(v => `<button class="cv" data-w="${esc(v.word)}">
          <span class="w">${esc(v.word)}</span>
          <span class="r">${esc(v.reading)}</span>
          <span class="m">${esc(v.meanings.slice(0,2).join(", "))}</span>
          <span class="tag">${esc(v.level)}</span>
        </button>`).join("") || '<p class="sub">No vocabulary entries reference this kanji yet.</p>'}
    </div>
    <div class="btn-row">
      <button class="btn btn-primary btn-sm" id="pv-practice">${icon("play",12)} Practice this kanji</button>
      <button class="btn btn-ghost btn-sm" id="pv-open">Full details</button>
    </div>`;
  box.querySelectorAll(".cv").forEach(b => b.onclick = () => {
    const [wordChar] = [b.dataset.w].flat();
    const target = [...wordChar].find(c => kanjiMap.has(c));
    if (target) { libFocus = target; paintLibPreview(target); renderLibrary(); }
  });
  const pr = box.querySelector("#pv-practice");
  if (pr) pr.onclick = () => {
    document.querySelector("[data-tab='quiz']").click();
    setQuizLevels([k.level]);
    document.getElementById("quiz-mode").value = "kanji-reading";
    document.getElementById("quiz-count").value = "10";
    document.getElementById("quiz-start").click();
  };
  const op = box.querySelector("#pv-open");
  if (op) op.onclick = () => showDetail(ch);
}

// full-detail modal (kept for the Compounds tab + full details button)
function showDetail(ch) {
  const k = kanjiMap.get(ch);
  if (!k) return;
  const examples = VOCAB.filter(v => v.word.includes(ch)).slice(0, 8);
  document.getElementById("detail-body").innerHTML = `
    <h2>${esc(ch)} <span class="badge">${esc(k.level)}</span></h2>
    <p><b>Meaning</b> ${esc(k.meanings.join(", "))}</p>
    <p><b>On'yomi</b> ${esc((k.onyomi||[]).join("、")||"—")}</p>
    <p><b>Kun'yomi</b> ${esc((k.kunyomi||[]).join("、")||"—")}</p>
    <p><b>Strokes</b> ${k.strokes ?? "—"}</p>
    <h4>Example words</h4>
    <ul>${examples.map(v => `<li><b>${esc(v.word)}</b> (${esc(v.reading)}) — ${esc(v.meanings.join(", "))} [${esc(v.level)}]</li>`).join("") || "<li>—</li>"}</ul>`;
  document.getElementById("kanji-detail").classList.remove("hidden");
}

document.getElementById("detail-close").onclick = () =>
  document.getElementById("kanji-detail").classList.add("hidden");
document.getElementById("kanji-detail").onclick = (e) => {
  if (e.target.id === "kanji-detail") e.currentTarget.classList.add("hidden");
};
document.getElementById("lib-search").oninput = () => { libPage = 1; renderLibrary(); };
document.getElementById("lib-sort").onchange = renderLibrary;
document.querySelectorAll("#lib-levels input").forEach(i => i.onchange = () => { libPage = 1; renderLibrary(); });

// ---------- quiz ----------
let quiz = { items: [], idx: 0, score: 0, mode: "kanji-reading", answers: [] };
let quizTimer = null, quizStartAt = 0, examTick = null;

function shuffle(a) { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function sample(arr, n, exclude) {
  const pool = arr.filter(x => x !== exclude);
  shuffle(pool);
  return pool.slice(0, n);
}
// unique, non-blank distractors (fixes blank/duplicate quiz buttons)
function pickDistractors(poolArr, answer, n) {
  const seen = new Set([answer]);
  const out = [];
  const pool = [...poolArr];
  shuffle(pool);
  for (const x of pool) {
    if (out.length >= n) break;
    const s = String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// edit distance for kana strings (short strings — cheap DP)
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
        prev[j - 1] + ([...a][i - 1] === [...b][j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// confusing-ness of a wrong option: same length + shared head/tail +
// near-identical shape (dakuten pairs てんき/でんき, きょ/きよ, おう/おお…)
function kanaSim(answer, cand) {
  const A = [...answer], C = [...cand];
  const maxLen = Math.max(A.length, C.length) || 1;
  let s = 1 - levenshtein(answer, cand) / maxLen;
  if (A.length === C.length) s += 0.35;
  else if (Math.abs(A.length - C.length) === 1) s += 0.1;
  if (A[0] !== undefined && A[0] === C[0]) s += 0.15; // same first kana
  if (A.length > 1 && A[A.length - 1] === C[C.length - 1]) s += 0.1; // same ending
  return s;
}

// distractors ranked most-confusing-first: the single closest decoy is always
// included, the rest sampled from the top slice so sets stay fresh
function pickConfusingDistractors(poolArr, answer, n) {
  const seen = new Set([answer]);
  const cands = [];
  for (const x of poolArr) {
    const s = String(x ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    cands.push({ s, sim: kanaSim(answer, s) });
  }
  if (!cands.length) return [];
  cands.sort((a, b) => b.sim - a.sim);
  const out = [cands[0].s];
  const rest = shuffle(cands.slice(1, Math.max(12, n * 5)));
  for (const c of rest) {
    if (out.length >= n) break;
    out.push(c.s);
  }
  for (let i = Math.max(12, n * 5); out.length < n && i < cands.length; i++) out.push(cands[i].s);
  return out;
}

document.getElementById("preset-n5n4").onclick = () => setQuizLevels(["N5","N4"]);
document.getElementById("preset-n3n1").onclick = () => setQuizLevels(["N3","N2","N1"]);
document.getElementById("preset-all").onclick = () => setQuizLevels(LEVELS);
function setQuizLevels(ls) {
  document.querySelectorAll("#quiz-levels input").forEach(i => i.checked = ls.includes(i.value));
}

function renderBest() {
  const el = document.getElementById("quiz-best");
  if (!el) return;
  try {
    const best = JSON.parse(localStorage.getItem("kanji-best") || "{}");
    // keys are the quiz scope string (e.g. "N5+N4" or "N5+N4+learned"),
    // so read the stored object rather than assuming single-level keys
    const pretty = (k) => k.replace(/\+/g, "·").replace("learned", "learned only");
    const txt = Object.entries(best)
      .sort((a, b) => LEVELS.indexOf(a[0][0]) - LEVELS.indexOf(b[0][0]))
      .map(([k, v]) => `${pretty(k)}: ${v}`)
      .join("  ·  ");
    el.textContent = txt ? "Best — " + txt : "";
  } catch { el.textContent = ""; }
}

document.getElementById("quiz-start").onclick = () => {
  const levels = [...document.querySelectorAll("#quiz-levels input:checked")].map(i => i.value);
  if (!levels.length) return alert("Pick at least one level scope (e.g. N5–N4).");
  const mode = document.getElementById("quiz-mode").value;
  const fam = quizFamily();
  const learnedOnly = document.getElementById("quiz-learned")?.checked || false;
  const count = parseInt(document.getElementById("quiz-count").value, 10);
  quiz = { items: [], idx: 0, score: 0, mode, answers: [],
    scope: levels.join("+") + (learnedOnly ? "+learned" : ""), levels, learnedOnly };
  if (mode === "compound-reading") {
    const poolW = quizPoolW(levels, learnedOnly);
    if (poolW.length < 4) return alert(learnedOnly
      ? "Not enough compound words from learned kanji — grade more cards in Daily first (need 4+)."
      : "Not enough compound words in scope — widen the levels.");
    // deal unique words (no repeats)
    for (const v of shuffle([...poolW])) {
      if (quiz.items.length >= count) break;
      const q = buildCompoundReading(poolW, v);
      if (q && q.opts.length >= 4) quiz.items.push(q);
    }
  } else {
    let poolK = KANJI.filter(k => levels.includes(k.level));
    if (learnedOnly) poolK = poolK.filter(k => daily.srs[k.character]);
    if (poolK.length < 4) return alert(learnedOnly
      ? "Not enough learned kanji in scope — grade some cards in Daily first (need 4+)."
      : "Not enough kanji in scope.");
    // deal unique kanji (no repeats)
    for (const k of shuffle([...poolK])) {
      if (quiz.items.length >= count) break;
      const q = mode === "reading-kanji"
        ? buildReadingKanji(poolK, fam, k) || buildKanjiReading(poolK, fam, k)
        : buildKanjiReading(poolK, fam, k) || buildReadingKanji(poolK, fam, k);
      if (q && q.opts.length >= 4) quiz.items.push(q);
    }
  }
  if (!quiz.items.length) return alert("Couldn't build questions for this setup.");
  document.getElementById("quiz-play").classList.remove("hidden");
  document.getElementById("quiz-result").classList.add("hidden");
  document.getElementById("quiz-active").classList.remove("hidden");
  scrollTo(document.querySelector(".page-head.compact"), { block: "start", behavior: "smooth" });
  startQuizTimer();
  examReset();
  showQuizQ();
};

function startQuizTimer() {
  clearInterval(quizTimer);
  quizStartAt = Date.now();
  const el = document.getElementById("exam-time");
  el.textContent = "00:00";
  document.getElementById("exam-live").textContent = "Live";
  quizTimer = setInterval(() => {
    const s = Math.floor((Date.now() - quizStartAt) / 1000);
    el.textContent = `${String(Math.floor(s / 60)).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;
  }, 1000);
}
function stopQuizTimer() {
  clearInterval(quizTimer); quizTimer = null;
}

// right-rail exam panel: score, progress, per-question navigator
function examReset() {
  const list = document.getElementById("exam-qs");
  if (!list) return;
  list.innerHTML = "";
  quiz.items.forEach((q, i) => {
    const li = document.createElement("li");
    li.id = "exam-q" + i;
    li.innerHTML = `<span class="qn">Q${i + 1}</span><span class="qt">${esc(q.prompt)}</span>
      <span class="qa"></span><span class="st"></span>`;
    list.appendChild(li);
  });
  document.getElementById("exam-qcount").textContent = `0 / ${quiz.items.length}`;
  document.getElementById("exam-bar").style.width = "0%";
  examPaint();
}
function examPaint() {
  const list = document.getElementById("exam-qs");
  if (!list) return;
  [...list.children].forEach((li, i) => {
    const a = quiz.answers[i];
    li.className = "";
    if (a) li.classList.add(a.correct ? "done" : "miss");
    else if (i === quiz.idx) li.classList.add("active");
    li.querySelector(".qa").textContent = a ? `→ ${a.q.answer}` : "";
    li.querySelector(".st").innerHTML = a
      ? `<span class="dot ${a.correct ? "learned" : "due"}"></span>`
      : (i === quiz.idx ? `<span class="chip chip-brand" style="padding:1px 6px;font-size:9px">Active</span>` : "");
  });
  document.getElementById("exam-score").textContent = quiz.score;
  document.getElementById("exam-sub").textContent = `+${quiz.answers.length} answered`;
  document.getElementById("exam-qcount").textContent = `${quiz.answers.length} / ${quiz.items.length}`;
  document.getElementById("exam-bar").style.width =
    (quiz.items.length ? quiz.answers.length / quiz.items.length * 100 : 0) + "%";
}

function updateQuizProgress() {
  document.getElementById("quiz-progress").textContent =
    `Question ${Math.min(quiz.idx + 1, quiz.items.length)} of ${quiz.items.length} · Score ${quiz.score} · Scope ${quiz.scope}`;
}

// compound pool: 2+ kanji words with hiragana readings (optionally only learned kanji)
// words with multiple readings (e.g. 二人 ふたり/ににん) are excluded —
// a second valid reading among the options would make two answers correct
const KANA_RE = /^[\u3040-\u309Fー]+$/;
let multiReadWords = null;
function getMultiReadWords() {
  if (!multiReadWords) {
    const byWord = new Map();
    for (const v of VOCAB) {
      const w = v.word, r = (v.reading || "").trim();
      if (!w || !r) continue;
      if (!byWord.has(w)) byWord.set(w, new Set());
      byWord.get(w).add(r);
    }
    multiReadWords = new Set([...byWord].filter(([, s]) => s.size > 1).map(([w]) => w));
  }
  return multiReadWords;
}
function quizPoolW(levels, learnedOnly) {
  const multi = getMultiReadWords();
  return VOCAB.filter(v => {
    if (!levels.includes(v.level)) return false;
    if (multi.has(v.word)) return false;
    if ([...v.word].filter(ch => kanjiMap.has(ch)).length < 2) return false;
    if (!KANA_RE.test((v.reading || "").trim())) return false;
    if (learnedOnly && ![...v.word].every(ch => !kanjiMap.has(ch) || daily.srs[ch])) return false;
    return true;
  });
}

// Word flashes big, meaning shown below; choices are hiragana readings only
function buildCompoundReading(poolW, fixedV) {
  const v = fixedV || poolW[Math.floor(Math.random() * poolW.length)];
  if (!v) return null;
  const ans = (v.reading || "").trim();
  if (!KANA_RE.test(ans)) return null;
  const pool = [...new Set(poolW.map(x => (x.reading || "").trim()).filter(s => s && s !== ans && KANA_RE.test(s)))];
  const opts = shuffle([ans, ...pickConfusingDistractors(pool, ans, 3)]);
  if (opts.length < 4) return null;
  return { kind: "compound-reading", prompt: v.word,
    sub: `${v.meanings.join(", ")} [${v.level}] — pick the reading`,
    answer: ans, opts, ch: null };
}

function makeQuestion(m, poolK) {
  const famSetting = quizFamily();
  if (m === "compound-reading") {
    const poolW = quizPoolW(quiz.levels?.length ? quiz.levels : LEVELS, !!quiz.learnedOnly);
    const q = buildCompoundReading(poolW);
    if (q) return q;
    return buildKanjiReading(poolK, famSetting) || buildKanjiReading(KANJI, "auto");
  }
  if (m === "reading-kanji") {
    const q = buildReadingKanji(poolK, famSetting) || buildKanjiReading(poolK, famSetting);
    if (q) return q;
    return buildKanjiReading(KANJI, "auto");
  }
  // kanji-reading (default)
  return buildKanjiReading(poolK, famSetting)
      || buildReadingKanji(poolK, famSetting)
      || buildKanjiReading(KANJI, "auto");
}

// strip okurigana markers (た.べる -> たべる, -び -> び) for clean kana choices
function cleanReading(s) {
  return String(s ?? "").replace(/[.・\-‐‑]/g, "").trim();
}

function quizFamily() {
  return document.getElementById("quiz-family")?.value || "auto";
}

// pick a random kanji that has a reading in the wanted family; returns {k, fam, list}
// (script-filtered: kun = hiragana only, on = katakana only — the data has
//  katakana loanword readings tucked into some kunyomi arrays)
const HIRA_RE = /^[\u3040-\u309F]+$/;
const KATA_RE = /^[\u30A0-\u30FFー]+$/;
function pickKanjiWith(poolK, fam, tries = 30, fixedK = null) {
  if (fixedK) {
    const on = (fixedK.onyomi || []).map(cleanReading).filter(s => s && KATA_RE.test(s));
    const kun = (fixedK.kunyomi || []).map(cleanReading).filter(s => s && HIRA_RE.test(s));
    let f = fam;
    if (f === "auto") {
      if (on.length && kun.length) f = Math.random() < 0.5 ? "on" : "kun";
      else f = on.length ? "on" : "kun";
    }
    const list = f === "on" ? on : kun;
    return list.length ? { k: fixedK, fam: f, list } : null;
  }
  for (let t = 0; t < tries; t++) {
    const k = poolK[Math.floor(Math.random() * poolK.length)];
    if (!k) return null;
    const on = (k.onyomi || []).map(cleanReading).filter(s => s && KATA_RE.test(s));
    const kun = (k.kunyomi || []).map(cleanReading).filter(s => s && HIRA_RE.test(s));
    let f = fam;
    if (f === "auto") {
      if (on.length && kun.length) f = Math.random() < 0.5 ? "on" : "kun";
      else f = on.length ? "on" : "kun";
    }
    const list = f === "on" ? on : kun;
    if (list.length) return { k, fam: f, list };
  }
  return null;
}

function familyTag(fam) {
  return fam === "on" ? "On'yomi 音読み" : "Kun'yomi 訓読み";
}

// Kanji flashes big, meaning shown below; choices are kana readings only (same script)
function buildKanjiReading(poolK, fam, fixedK = null) {
  for (let t = 0, tries = fixedK ? 1 : 10; t < tries; t++) {
    const pick = pickKanjiWith(poolK, fam, 30, fixedK);
    if (!pick) return null;
    const { k, fam: f, list } = pick;
    const ans = list[0];
    // exclude every reading of this kanji so no second-correct option sneaks in
    const mine = new Set([...(k.onyomi || []), ...(k.kunyomi || [])].map(cleanReading));
    const wantScript = f === "on" ? KATA_RE : HIRA_RE;
    const pool = [...new Set(poolK.flatMap(kk => {
      const arr = f === "on" ? (kk.onyomi || []) : (kk.kunyomi || []);
      return arr.map(cleanReading).filter(s => s && !mine.has(s) && wantScript.test(s));
    }))];
    const opts = shuffle([ans, ...pickConfusingDistractors(pool, ans, 3)]);
    if (opts.length >= 4) return { kind: "kanji-reading", prompt: k.character,
      sub: `${k.meanings.join(", ")} · ${familyTag(f)} [${k.level}]`,
      hint: "Identify the correct Japanese reading for this character",
      answer: ans, opts, ch: k.character };
  }
  return null;
}

// Kana reading shown big, meaning shown below (homophones exist!); choices are kanji only
function buildReadingKanji(poolK, fam, fixedK = null) {
  for (let t = 0, tries = fixedK ? 1 : 10; t < tries; t++) {
    const pick = pickKanjiWith(poolK, fam, 30, fixedK);
    if (!pick) return null;
    const { k, fam: f, list } = pick;
    const r = list[0];
    const hasReading = (kk) => [...(kk.onyomi || []), ...(kk.kunyomi || [])].map(cleanReading).includes(r);
    // distractors must NOT share the prompt reading, or two answers would be correct;
    // among the safe ones, prefer similar stroke counts (similar visual complexity)
    const target = k.strokes ?? 0;
    const safe = poolK.filter(kk => kk.character !== k.character && !hasReading(kk))
      .map(kk => ({ kk, diff: Math.abs((kk.strokes ?? 0) - target) }));
    safe.sort((a, b) => a.diff - b.diff);
    const top = shuffle(safe.slice(0, Math.max(12, 15)).map(x => x.kk));
    const chosen = top.slice(0, 3);
    for (let i = 15; chosen.length < 3 && i < safe.length; i++) chosen.push(safe[i].kk);
    if (chosen.length < 3) continue;
    const opts = shuffle([k.character, ...chosen.map(kk => kk.character)]);
    return { kind: "reading-kanji", prompt: r,
      sub: `${k.meanings.join(", ")} · ${familyTag(f)} [${k.level}]`,
      hint: "Pick the kanji that matches this reading",
      answer: k.character, opts, ch: k.character };
  }
  return null;
}

const KANJI_RE = /^[\u3400-\u9FFF]$/;
function showQuizQ() {
  let q = quiz.items[quiz.idx];
  // safety net: never render blank/duplicate options (regenerate the question if needed)
  q.opts = [...new Set((q.opts || []).map(o => String(o ?? "").trim()).filter(Boolean))];
  if (!q.answer || !q.opts.includes(String(q.answer).trim()) || q.opts.length < 4) {
    const levels = (quiz.levels?.length ? quiz.levels : (quiz.scope || "").split("+").filter(l => LEVELS.includes(l)));
    const poolK = KANJI.filter(k => !levels.length || levels.includes(k.level));
    const wantKind = q.kind === "reading-kanji" ? "reading-kanji" : q.kind === "compound-reading" ? "compound-reading" : "kanji-reading";
    for (let t = 0; t < 5 && q.opts.length < 4; t++) {
      const fresh = makeQuestion(wantKind, poolK.length >= 4 ? poolK : KANJI);
      if (fresh && fresh.opts.length >= 4) { q = fresh; quiz.items[quiz.idx] = q; break; }
    }
  }
  updateQuizProgress();
  const isKanji = KANJI_RE.test(String(q.prompt));
  const kInfo = q.ch ? kanjiMap.get(q.ch) : kanjiMap.get(q.prompt);
  const lvl = (q.sub || "").match(/\[(N\d)\]/)?.[1] || kInfo?.level;
  const modeTag = q.kind === "compound-reading" ? "Compound" : q.kind === "reading-kanji" ? "Reading → Kanji" : "Kanji → Reading";
  document.getElementById("quiz-q").innerHTML =
    `<div class="q-tags">
       <span class="chip chip-brand">${esc(modeTag)}</span>
       ${lvl ? `<span class="chip chip-quiet">JLPT ${esc(lvl)}</span>` : ""}
       ${kInfo && kInfo.strokes ? `<span class="chip chip-quiet">${kInfo.strokes} strokes</span>` : ""}
     </div>
     <div class="${isKanji ? "q-kanji" : "q-kana"}">${esc(q.prompt)}</div>
     <div class="q-mean">${esc((q.sub || "").split(" · ")[0].replace(/\s*\[N\d\].*$/, ""))}</div>
     <p class="q-hint">${esc(q.hint || "Pick the correct option")}</p>`;
  const box = document.getElementById("quiz-opts");
  box.innerHTML = "";
  document.getElementById("quiz-feedback").textContent = "";
  document.getElementById("quiz-feedback").className = "feedback";
  document.getElementById("quiz-next").classList.add("hidden");
  q.opts.forEach((opt, idx) => {
    const b = document.createElement("button");
    b.dataset.opt = opt;
    b.innerHTML = `<span class="opt-num">${idx + 1}</span><span class="opt-val">${esc(opt)}</span><span class="opt-check"></span>`;
    b.onclick = () => {
      const correct = opt === q.answer;
      if (correct) quiz.score++;
      quiz.answers.push({ q, picked: opt, correct });
      try { if (q.ch) srsQuizTouch(q.ch, correct); } catch {}
      [...box.children].forEach(x => {
        x.disabled = true;
        if (x.dataset.opt === q.answer) {
          x.classList.add("correct");
          x.querySelector(".opt-check").textContent = "✓";
        } else if (x === b && !correct) {
          x.classList.add("wrong");
          x.querySelector(".opt-check").textContent = "✕";
        }
      });
      const fb = document.getElementById("quiz-feedback");
      fb.className = "feedback " + (correct ? "ok" : "no");
      fb.textContent = correct ? "✓ Correct!" : `✕ Correct answer: ${q.answer}`;
      document.getElementById("quiz-next").classList.remove("hidden");
      updateQuizProgress(); // counter + score refresh the moment you answer
      examPaint();
    };
    box.appendChild(b);
  });
  examPaint();
}

document.getElementById("quiz-next").onclick = () => {
  quiz.idx++;
  if (quiz.idx >= quiz.items.length) return showResult();
  showQuizQ();
};

function showResult() {
  document.getElementById("quiz-play").classList.add("hidden");
  stopQuizTimer();
  const r = document.getElementById("quiz-result");
  r.classList.remove("hidden");
  document.getElementById("quiz-active").classList.add("hidden");
  document.getElementById("exam-live").textContent = "Done";
  const pct = Math.round(quiz.score / quiz.items.length * 100);
  const secs = Math.max(0, Math.round((Date.now() - quizStartAt) / 1000));
  r.innerHTML = `<h3>Result: ${quiz.score}/${quiz.items.length} — ${pct}% · ${Math.floor(secs/60)}m ${secs%60}s</h3>
    <ul>${quiz.answers.map((a,i) => `<li>Q${i+1} <span class="pk">${esc(a.q.prompt)}</span> → ${esc(a.q.answer)} — you: ${esc(a.picked)} ${a.correct?"✓":"✕"}</li>`).join("")}</ul>
    <div class="btn-row"><button class="btn btn-primary" id="quiz-retry">Retry</button></div>`;
  // bind via addEventListener, not an inline onclick attribute
  r.querySelector("#quiz-retry").onclick = () => document.getElementById("quiz-start").click();
  examPaint();
  try {
    const best = JSON.parse(localStorage.getItem("kanji-best") || "{}");
    const key = quiz.scope;
    if (!best[key] || pct > parseInt(best[key])) { best[key] = pct + "%"; localStorage.setItem("kanji-best", JSON.stringify(best)); }
    renderBest();
  } catch {}
}

// ---------- compounds ----------
const CURATED = [
  { word: "飲食", reading: "いんしょく", meaning: "food and drink", parts: "飲 (のむ drink) + 食 (たべる eat)", level: "N3" },
  { word: "洗濯機", reading: "せんたっき", meaning: "washing machine", parts: "洗 (あらう wash) + 濯 (すすぐ rinse) + 機 (はた machine)", level: "N4" },
  { word: "食事", reading: "しょくじ", meaning: "meal", parts: "食 (たべる eat) + 事 (こと matter)", level: "N5" },
  { word: "飲物", reading: "のみもの", meaning: "drink, beverage", parts: "飲 (のむ drink) + 物 (もの thing)", level: "N4" },
  { word: "食べ物", reading: "たべもの", meaning: "food", parts: "食 (たべる eat) + 物 (もの thing)", level: "N5" },
  { word: "読書", reading: "どくしょ", meaning: "reading (books)", parts: "読 (よむ read) + 書 (かく write)", level: "N4" },
  { word: "日本語", reading: "にほんご", meaning: "Japanese language", parts: "日 (ひ day/sun) + 本 (もと origin) + 語 (かたる speak)", level: "N5" },
  { word: "勉強", reading: "べんきょう", meaning: "study", parts: "勉 (つとめる exertion) + 強 (つよい strong)", level: "N5" },
  { word: "電車", reading: "でんしゃ", meaning: "train", parts: "電 (electricity) + 車 (くるま car)", level: "N5" },
];

function compFilters() {
  const levels = [...document.querySelectorAll("#comp-levels input:checked")].map(i => i.value);
  const q = document.getElementById("comp-search").value.trim().toLowerCase();
  const lenFilter = document.getElementById("comp-length")?.value || "all";
  let list = VOCAB.filter(v => {
    if (!levels.includes(v.level)) return false;
    const chars = [...v.word];
    const kanjiChars = chars.filter(ch => kanjiMap.has(ch));
    if (kanjiChars.length < 2) return false; // main list = 2+ kanji (allows 洗濯機, 食べ物, 日本語)
    if (lenFilter === "2") return chars.length === 2 && kanjiChars.length === 2;
    if (lenFilter === "3plus") return kanjiChars.length >= 3;
    if (lenFilter === "kana") return chars.length !== kanjiChars.length; // e.g. 食べ物, 飲物
    return true;
  });
  if (q) list = list.filter(v =>
    v.word.includes(q) || v.reading.toLowerCase().includes(q) || v.meanings.join(" ").toLowerCase().includes(q));
  return list;
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function findVocabEntry(word) {
  return VOCAB.find(x => x.word === word);
}

// ---------- auto-furigana for example sentences (offline, approximate) ----------
// Segments each sentence by longest-match against our own vocab readings, and
// annotates kanji tokens with <ruby>. The clicked word always matches itself,
// so its own reading is exact; single-kanji matches are skipped (too ambiguous:
// 人 = ひと/じん/にん depending on context). Unmatched kanji stay plain.
let READING_MAP = new Map();
let READ_MAXLEN = 1;
function buildReadingIndex() {
  READING_MAP = new Map();
  READ_MAXLEN = 1;
  for (const v of VOCAB) {
    const w = (v.word || "").trim();
    const r = (v.reading || "").trim();
    if (!w || !r || READING_MAP.has(w)) continue;
    READING_MAP.set(w, r);
    if ([...w].length > READ_MAXLEN) READ_MAXLEN = [...w].length;
  }
  // curated words missing from the dataset (e.g. 洗濯機) so they still read right
  for (const c of CURATED) {
    if (c.word && c.reading && !READING_MAP.has(c.word)) {
      READING_MAP.set(c.word, c.reading);
      if ([...c.word].length > READ_MAXLEN) READ_MAXLEN = [...c.word].length;
    }
  }
}

const hasKanji = (s) => [...s].some(ch => kanjiMap.has(ch));

function furiganaHTML(ja) {
  const chars = [...ja];
  let out = "";
  let i = 0;
  while (i < chars.length) {
    let hit = null;
    const max = Math.min(READ_MAXLEN, chars.length - i);
    for (let len = max; len >= 2; len--) {
      const surf = chars.slice(i, i + len).join("");
      const r = READING_MAP.get(surf);
      if (r !== undefined) { hit = { surf, r }; break; }
    }
    if (!hit) { out += esc(chars[i]); i++; continue; }
    if (hasKanji(hit.surf) && hit.r !== hit.surf) {
      out += `<ruby>${esc(hit.surf)}<rt>${esc(hit.r)}</rt></ruby>`;
    } else {
      out += esc(hit.surf);
    }
    i += [...hit.surf].length;
  }
  return out;
}

function compCard(v, partsHTML) {
  const d = document.createElement("div");
  d.className = "comp";
  const chars = [...v.word].map(ch => {
    const k = kanjiMap.get(ch);
    if (k) {
      const rd = ((k.kunyomi[0] || k.onyomi[0] || "").replace(/\./g, ""));
      return `<button class="link" data-ch="${esc(ch)}" title="${esc(k.meanings.join(", "))}">${esc(ch)}${rd ? `<i>${esc(rd)}</i>` : ""}</button>`;
    }
    return `<span class="kana">${esc(ch)}</span>`; // hiragana/katakana inside word, e.g. べ in 食べ物
  }).join("");
  // examples: prefer attached data, else look up full vocab entry (covers curated/custom words)
  const entry = v.examples ? v : findVocabEntry(v.word);
  const examples = (entry && entry.examples) ? entry.examples.slice(0, 3) : [];
  // bias the index to this card's own reading, so the studied word's ruby
  // matches its header (e.g. N1 中指 ちゅうし vs N2 中指 なかゆび)
  const dispRead = (v.reading || "").trim();
  const biasWord = dispRead && hasKanji(v.word);
  const hadBias = biasWord && READING_MAP.has(v.word);
  const prevBias = biasWord ? READING_MAP.get(v.word) : undefined;
  if (biasWord) READING_MAP.set(v.word, dispRead);
  const exHTML = examples.length
    ? `<ul>${examples.map(e => `<li><span class="ex-ja">${furiganaHTML(e.ja)}</span><br><span class="ex-en">${esc(e.en)}</span></li>`).join("")}</ul>
       <p class="furi-note">🔤 Small readings auto-made from our word list — usually right, occasionally off.</p>`
    : `<p class="no-ex">No example sentences in dataset yet — try another word or add your own.</p>`;
  if (biasWord) {
    if (hadBias) READING_MAP.set(v.word, prevBias);
    else READING_MAP.delete(v.word);
  }
  d.innerHTML = `<div class="comp-top">
      <span class="badge">${esc(v.level)}</span>
      <span class="mini">
        <button class="mini-eye" title="Show usage examples" aria-label="Show usage examples">${icon("eye",12)}</button>
      </span>
    </div>
    <div><button class="wordlink" title="Show usage examples">${esc(v.word)}</button><span class="reading">${esc(v.reading) || "—"}</span></div>
    <div class="comp-meaning">${esc(v.meanings.join(", "))}</div>
    <div class="anat-tag">Compound anatomy</div>
    <div class="parts">${chars}${partsHTML ? `<span class="sub" style="font-size:11px">· ${esc(partsHTML)}</span>` : ""}</div>
    <div class="examples hidden">
      <div class="ex-title">📌 Usage · ${examples.length || "no"} example${examples.length === 1 ? "" : "s"}</div>
      ${exHTML}
    </div>`;
  d.querySelectorAll("button.link").forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    showDetail(b.dataset.ch); // popup in place — no tab switch, no reshuffle
  });
  const wBtn = d.querySelector("button.wordlink");
  const eyeBtn = d.querySelector(".mini-eye");
  const exBox = d.querySelector(".examples");
  const toggleEx = () => exBox.classList.toggle("hidden");
  wBtn.onclick = toggleEx;
  if (eyeBtn) eyeBtn.onclick = toggleEx;
  return d;
}

function renderCurated() {
  const box = document.getElementById("curated-list");
  box.innerHTML = "";
  shuffle([...CURATED]).forEach(c => box.appendChild(compCard(
    { word: c.word, reading: c.reading, meanings: [c.meaning], level: c.level }, c.parts)));
}

// "Featured Anatomy" hero: a curated word broken into its parts + a phonics note
function paintFeatureAnatomy() {
  const box = document.getElementById("comp-feature-body");
  if (!box) return;
  if (!CURATED.length) { box.innerHTML = ""; return; }
  const c = CURATED[3] || CURATED[0];
  const chars = [...c.word].map(ch => kanjiMap.get(ch)).filter(Boolean);
  const pairs = (chars.length ? chars : [{ character: c.word, kunyomi: [c.reading] }]).map((k, i) => {
    const rd = ((k.kunyomi?.[0] || k.onyomi?.[0] || "").replace(/\./g, ""));
    return `<span class="pair"><span class="ch">${esc(k.character)}</span>
      <span class="rd">${esc(rd || (i === 0 ? c.reading : "—"))}</span></span>`;
  }).join(`<span class="op">+</span>`);
  document.getElementById("comp-feature-tag").textContent = `${c.level} · ${c.meaning}`;
  box.innerHTML = `
    <div class="anat">${pairs}<span class="op">=</span>
      <span class="res"><span class="ch">${esc(c.word)}</span><span class="rd">${esc(c.reading)}</span></span>
    </div>
    <div class="phonic">
      <span class="ic">${icon("bulb",16)}</span>
      <div>
        <b>Phonetic Morph (Semantic → Sound) Effect</b>
        ${esc(c.parts)} — the same secondary reading じしょく attaches across the pair, so the word reads as
        “food &amp; drink” rather than two unrelated nouns.
      </div>
    </div>`;
}

// static right-rail formation guide
function paintCompRules() {
  const box = document.getElementById("comp-rules");
  if (!box) return;
  box.innerHTML = [
    ["On'yomi + On'yomi · 音＋音", "Most common compounds. Both kanji keep their Sino-Japanese reading — e.g. 鉄 (てつ) + 道 (どう) → 鉄道 (てつどう)."],
    ["Kun'yomi Voicing · 訓+/ Rinpaku", "Stem changes when a voiced mark follows — te↔de, ki↔gi — e.g. 風 (かぜ) + 鈴 (りん) → 風鈴 (ふうりん)."],
    ["Oyakusoko &amp; Hyōgai · 親子・表記", "Kanji pairs are used interchangeably in compounds. A written form may appear where the standard spelling keeps hiragana."],
  ].map(([b, t]) => `<li><b>${b}</b>${t}</li>`).join("");
}

// quiz right-rail "related lessons"
function paintRelated() {
  const box = document.getElementById("quiz-related");
  if (!box) return;
  const items = [
    ["P", "Nature &amp; Foliage Radicals", "N3 Grammar · 08:40"],
    ["P", "Homophones of 付 (ふ)", "Pronunciation · 08:15"],
    ["P", "Radical Secrets: Water vs Ice", "N3 Grammar · 06:20"],
  ];
  box.innerHTML = items.map(([ic, t, s]) =>
    `<li><span class="ic">${icon("play",12)}</span>
      <span class="tx"><b>${t}</b><small>${s}</small></span>
      <span class="sub">›</span></li>`).join("");
}

let compPool = []; // shuffled pool for current filter; stable across "Show more"

function shuffleCompounds() {
  compShown = 60;
  const list = compFilters();
  // shuffle a copy so "Show more" keeps the same random order
  compPool = shuffle([...list]);
  renderCompoundsFromPool();
}

function renderCompounds() {
  // called on filter/search change: rebuild pool only if filter changed.
  // If user is just typing a search, keep dataset order for relevance;
  // otherwise use a fresh random pool.
  const q = document.getElementById("comp-search").value.trim().toLowerCase();
  if (q) {
    compPool = compFilters(); // no shuffle while searching
    renderCompoundsFromPool();
  } else {
    shuffleCompounds();
  }
}

function renderCompoundsFromPool() {
  const list = compPool.length ? compPool : compFilters();
  document.getElementById("comp-stats").textContent = `${list.length.toLocaleString()} compounds in scope · random order`;
  const box = document.getElementById("comp-list");
  box.innerHTML = "";
  list.slice(0, compShown).forEach(v => {
    const parts = [...v.word].map(ch => {
      const k = kanjiMap.get(ch);
      if (!k) return null; // kana, e.g. べ — already rendered as .kana chip
      return `${ch} ${esc(k.meanings[0])}`;
    }).filter(Boolean).join(" + ");
    box.appendChild(compCard(v, parts));
  });
  renderCustom();
}

function renderCustom() {
  let custom = [];
  try { custom = JSON.parse(localStorage.getItem("kanji-custom") || "[]"); } catch {}
  const box = document.getElementById("custom-list");
  box.innerHTML = "";
  custom.forEach(c => box.appendChild(compCard(
    { word: c.word, reading: c.reading, meanings: [c.meaning], level: "mine" }, c.parts)));
}

document.querySelectorAll("#comp-levels input").forEach(i => i.onchange = () => { shuffleCompounds(); });
document.getElementById("comp-length").onchange = () => { shuffleCompounds(); };
document.getElementById("comp-search").oninput = () => {
  const q = document.getElementById("comp-search").value.trim().toLowerCase();
  if (q) {
    compPool = compFilters();
    renderCompoundsFromPool();
  } else {
    shuffleCompounds();
  }
};
document.getElementById("comp-more").onclick = () => { compShown += 100; renderCompoundsFromPool(); };
document.getElementById("comp-shuffle").onclick = () => { renderCurated(); shuffleCompounds(); };
document.getElementById("comp-furi").onchange = (e) => {
  document.getElementById("tab-compounds").classList.toggle("nofuri", !e.target.checked);
};
document.getElementById("custom-form").onsubmit = e => {
  e.preventDefault();
  const c = {
    word: document.getElementById("c-word").value.trim(),
    reading: document.getElementById("c-reading").value.trim(),
    meaning: document.getElementById("c-meaning").value.trim(),
    parts: document.getElementById("c-parts").value.trim(),
  };
  if (!c.word) return;
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem("kanji-custom") || "[]"); } catch {}
  arr.push(c);
  localStorage.setItem("kanji-custom", JSON.stringify(arr));
  e.target.reset();
  renderCustom();
};

// ---------- Word Lab Drill (compounds right rail) ----------
let drill = { q: null, score: 0, asked: 0, right: 0, startedAt: 0, timer: null };
function drillPool() {
  const levels = [...document.querySelectorAll("#comp-levels input:checked")].map(i => i.value);
  return quizPoolW(levels.length ? levels : LEVELS, false);
}
function drillPaint() {
  const body = document.getElementById("drill-body");
  if (!body || !drill.q) return;
  document.getElementById("drill-score").textContent = drill.score;
  document.getElementById("drill-sub").textContent = `${drill.right}/${drill.asked} correct`;
  body.innerHTML = `
    <div class="dq">${esc(drill.q.prompt)}</div>
    <p class="sub" style="text-align:center">${esc(drill.q.sub.replace(/\s*\[N\d\].*$/, ""))}</p>
    <div class="drill-opts"></div>`;
  const box = body.querySelector(".drill-opts");
  drill.q.opts.forEach((o) => {
    const b = document.createElement("button");
    b.dataset.opt = o;
    b.innerHTML = `<span>${esc(o)}</span>`;
    b.onclick = () => {
      const ok = o === drill.q.answer;
      drill.asked++;
      if (ok) { drill.score++; drill.right++; }
      // match on data-opt, not textContent — readings overlap by prefix
      // (かわ is a substring of かわき), so text matching picks the wrong button
      [...box.children].forEach(x => {
        x.disabled = true;
        if (x.dataset.opt === drill.q.answer) x.classList.add("correct");
        else if (x === b) x.classList.add("wrong");
      });
      document.getElementById("drill-tag").textContent = ok ? "Correct ✓" : `→ ${drill.q.answer}`;
      // refresh the score tiles now — don't wait for the next question
      document.getElementById("drill-score").textContent = drill.score;
      document.getElementById("drill-sub").textContent = `${drill.right}/${drill.asked} correct`;
      setTimeout(() => drillNext(), 800);
    };
    box.appendChild(b);
  });
}
function drillNext() {
  const pool = drillPool();
  if (pool.length < 4) {
    document.getElementById("drill-body").innerHTML =
      '<p class="sub">Not enough compound readings in the current level scope — widen the filter above.</p>';
    document.getElementById("drill-tag").textContent = "Idle";
    return;
  }
  drill.q = buildCompoundReading(pool);
  drillPaint();
}
function startDrill() {
  const pool = drillPool();
  if (pool.length < 4) return alert("Widen the compound level scope first — the drill needs at least 4 words.");
  drill = { q: null, score: 0, asked: 0, right: 0, startedAt: Date.now(), timer: null };
  document.getElementById("drill-tag").textContent = "Running";
  clearInterval(drill.timer);
  drill.timer = setInterval(() => {
    const s = Math.floor((Date.now() - drill.startedAt) / 1000);
    document.getElementById("drill-time").textContent =
      `${String(Math.floor(s / 60)).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;
  }, 1000);
  drillNext();
}
document.getElementById("drill-start").onclick = startDrill;

// ---------- daily learning v2: level-based lessons + SRS ----------
const DAILY_KEY = "kanji-daily-v2";
const GOAL_DEFAULTS = { N5: 5, N4: 5, N3: 7, N2: 8, N1: 10 };
let daily = loadDailyStore();
let todaySet = { date: null, newChars: [], revChars: [] };

function loadDailyStore() {
  try {
    const d = JSON.parse(localStorage.getItem(DAILY_KEY) || "null");
    if (d && d.settings && d.srs && d.days) {
      // migrate older saves: scope defaults to cumulative up to level (old behavior)
      if (!Array.isArray(d.settings.scope)) {
        const idx = LEVELS.indexOf(d.settings.level);
        d.settings.scope = LEVELS.slice(0, Math.max(0, idx) + 1);
      }
      d.settings.scope = d.settings.scope.filter(l => LEVELS.includes(l));
      if (!d.settings.scope.length) d.settings.scope = [d.settings.level];
      return d;
    }
  } catch {}
  return { settings: { level: "N4", goal: 5, scope: ["N5", "N4"] }, srs: {}, days: {}, streak: 0, lastActive: null };
}
function saveDailyStore() {
  stampDaily();
  writeDailyStore();
  markDirty();
}
function writeDailyStore() {
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(daily)); } catch {}
}
function stampDaily() {
  try { daily.clientUpdatedAt = new Date().toISOString(); } catch {}
}
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function addDays(key, n) {
  const d = new Date(key + "T12:00:00");
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
function studyLevels() {
  // explicit scope: only levels the user checked (lets them skip finished levels like N5/N4)
  const scope = (daily.settings.scope || []).filter(l => LEVELS.includes(l));
  if (scope.length) return [...new Set(scope)].sort((a,b) => LEVELS.indexOf(a)-LEVELS.indexOf(b));
  return [daily.settings.level];
}
function studyPool() {
  const lv = studyLevels();
  return KANJI.filter(k => lv.includes(k.level)).sort((a,b) => (a.freq||9999)-(b.freq||9999));
}
// ordered course: scope levels in order, kanji by frequency within each level.
// New cards always continue from the first unlearned position (1 → end),
// so progress persists across days and reloads — never back to day 0.
function courseOrder() {
  const lv = studyLevels();
  return KANJI.filter(k => lv.includes(k.level))
    .sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || (a.freq || 9999) - (b.freq || 9999))
    .map(k => k.character);
}
function courseProgress() {
  const order = courseOrder();
  const done = order.filter(ch => daily.srs[ch]).length;
  return { done, total: order.length };
}
function srsStatus(ch) {
  const e = daily.srs[ch];
  if (!e) return "unseen";
  const today = dayKey();
  if ((e.due || today) <= today) return e.reps > 0 ? "due" : "new";
  return "learned";
}

function buildTodaySet() {
  const today = dayKey();
  if (!daily.days[today]) daily.days[today] = { newChars: [], graded: {} };
  const day = daily.days[today];
  const learned = new Set(Object.keys(daily.srs));
  // keep already-assigned new chars (stable for the day); top up by walking
  // the course order 1 → end, so each day continues where the last left off
  day.newChars = (day.newChars || []).filter(ch => kanjiMap.has(ch));
  const gradedNew = Object.keys(day.graded || {}).filter(ch => day.newChars.includes(ch));
  const scopeSet = new Set(studyLevels());
  // drop ungraded cards that fell out of scope (e.g. user unchecked N5/N4 to skip them)
  day.newChars = day.newChars.filter(ch => {
    if (gradedNew.includes(ch)) return true;
    const k = kanjiMap.get(ch);
    return k && scopeSet.has(k.level);
  });
  if (day.newChars.length < daily.settings.goal) {
    for (const ch of courseOrder()) {
      if (day.newChars.length >= daily.settings.goal) break;
      if (!learned.has(ch) && !day.newChars.includes(ch)) day.newChars.push(ch);
    }
  }
  if (day.newChars.length > daily.settings.goal) {
    // shrinking goal: keep graded ones, trim ungraded
    const keep = new Set(gradedNew);
    day.newChars = [...day.newChars.filter(ch => keep.has(ch)), ...day.newChars.filter(ch => !keep.has(ch))]
      .slice(0, daily.settings.goal);
  }
  // reviews due today (excluding today's new), oldest due first — scope-filtered too
  todaySet.revChars = Object.entries(daily.srs)
    .filter(([ch, e]) => {
      if (day.newChars.includes(ch) || (e.due || today) > today || !kanjiMap.has(ch)) return false;
      return scopeSet.has(kanjiMap.get(ch).level);
    })
    .sort((a,b) => (a[1].due||"").localeCompare(b[1].due||""))
    .slice(0, 50).map(([ch]) => ch);
  todaySet.newChars = [...day.newChars];
  todaySet.date = today;
  saveDailyStore();
}

function gradeKanji(ch, grade) {
  const today = dayKey();
  const e = daily.srs[ch] || { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: today };
  if (grade === "again") {
    e.lapses = (e.lapses||0) + 1;
    e.reps = 0;
    e.interval = 0;
    e.due = addDays(today, 1);
    e.ease = Math.max(1.3, (e.ease||2.5) - 0.2);
  } else if (grade === "good") {
    e.reps = (e.reps||0) + 1;
    e.interval = e.reps <= 1 ? 1 : e.reps === 2 ? 3 : Math.round((e.interval||1) * (e.ease||2.5));
    e.due = addDays(today, Math.max(1, e.interval));
  } else { // easy
    e.reps = (e.reps||0) + 1;
    e.ease = (e.ease||2.5) + 0.1;
    e.interval = e.reps <= 1 ? 3 : Math.round((e.interval||1) * (e.ease||2.5) * 1.3);
    e.due = addDays(today, Math.max(2, e.interval));
  }
  daily.srs[ch] = e;
  if (!daily.days[today]) daily.days[today] = { newChars: [], graded: {} };
  daily.days[today].graded[ch] = grade;
  // streak: consecutive active days
  if (daily.lastActive !== today) {
    daily.streak = daily.lastActive === addDays(today, -1) ? (daily.streak||0) + 1 : 1;
    daily.lastActive = today;
  }
  saveDailyStore();
  buildTodaySet();
  renderDaily();
  try { renderLibrary(); } catch {}
}

// light-touch SRS update from quiz answers (correct = good, wrong = again but keep it gentle)
function srsQuizTouch(ch, correct) {
  if (!kanjiMap.has(ch)) return;
  const today = dayKey();
  const e = daily.srs[ch];
  if (!e) {
    daily.srs[ch] = correct
      ? { ease: 2.5, interval: 1, reps: 1, lapses: 0, due: addDays(today, 1) }
      : { ease: 2.3, interval: 0, reps: 0, lapses: 1, due: today };
  } else if (correct) {
    e.reps = (e.reps||0) + 1;
    e.interval = Math.max(1, Math.round((e.interval||1) * 1.5));
    e.due = addDays(today, e.interval);
  }
  if (!daily.days[today]) daily.days[today] = { newChars: [], graded: {} };
  saveDailyStore();
}

function flashCard(ch, kind) {
  const k = kanjiMap.get(ch);
  if (!k) return document.createTextNode("");
  const d = document.createElement("div");
  d.className = "card tile flash";
  const ex = VOCAB.filter(v => v.word.includes(ch)).slice(0, 2);
  const st = srsStatus(ch);
  const dot = st === "new" ? '<span class="dot new" title="new today"></span>'
    : st === "due" ? '<span class="dot due" title="review due"></span>' : "";
  d.innerHTML = `<div class="tile-top"><span class="badge">${esc(k.level)}</span>${dot}</div>
    <div class="k">${esc(ch)}</div>
    <button class="reveal-btn">Reveal</button>
    <div class="hidden-answer">
      <div class="m"><b>${esc(k.meanings.join(", "))}</b></div>
      <div class="r">音 ${esc((k.onyomi||[]).join("・")||"—")}<br>訓 ${esc((k.kunyomi||[]).join("・")||"—")}</div>
      ${ex.map(v => `<div class="r">${esc(v.word)} (${esc(v.reading)}) — ${esc(v.meanings.slice(0,2).join(", "))}</div>`).join("")}
      <div class="mem"><span>Memory Strength</span><span class="mem-dots">${[0,1,2,3].map(i =>
        `<i class="${((daily.srs[ch]?.reps || 0) + (((daily.days[dayKey()]?.graded || {})[ch]) ? 1 : 0)) > i ? "on" : ""}"></i>`).join("")}</span></div>
      <div class="grade-row">
        <button data-g="again">Again</button>
        <button data-g="good">Good</button>
        <button data-g="easy">Easy</button>
      </div>
    </div>`;
  d.querySelector(".reveal-btn").onclick = (e) => { e.stopPropagation(); d.classList.toggle("revealed"); };
  d.querySelectorAll(".grade-row button").forEach(b => b.onclick = (e) => { e.stopPropagation(); gradeKanji(ch, b.dataset.g); });
  const graded = (daily.days[dayKey()]?.graded || {})[ch];
  if (graded) { d.classList.add("revealed"); }
  return d;
}

function renderDaily() {
  if (!KANJI.length) return;
  buildTodaySetIfStale();
  const today = dayKey();
  const cp = courseProgress();
  const dayNo = Object.keys(daily.days).length;
  const lv = daily.settings.level;
  document.getElementById("daily-title").textContent =
    `Welcome back 👋 — Day ${dayNo} · ${lv}`;
  document.getElementById("daily-streak").innerHTML =
    `Keep your <b>${daily.streak||0}-day streak</b> alive with today's ${daily.settings.goal}-card spaced repetition session · course <b>${cp.done}/${cp.total}</b>.`;
  try { paintHdrStreak(); } catch {}
  const graded = daily.days[today]?.graded || {};
  const total = todaySet.newChars.length + todaySet.revChars.length;
  const done = [...todaySet.newChars, ...todaySet.revChars].filter(ch => graded[ch]).length;
  const pct = total ? Math.round(done/total*100) : 100;
  document.getElementById("daily-progress").textContent = `${done}/${total} done today (${pct}%)`;
  document.getElementById("daily-bar").style.width = pct + "%";
  document.getElementById("daily-new-count").textContent = `${todaySet.newChars.length} new`;
  document.getElementById("daily-rev-count").textContent = `${todaySet.revChars.length} due`;
  const nb = document.getElementById("daily-new");
  nb.innerHTML = "";
  if (!todaySet.newChars.length) nb.innerHTML = "<p class='sub'>No new kanji left in scope — you've seen them all. Raise your level or review! 🎉</p>";
  todaySet.newChars.forEach(ch => nb.appendChild(flashCard(ch, "new")));
  const rb = document.getElementById("daily-rev");
  rb.innerHTML = "";
  if (!todaySet.revChars.length) rb.innerHTML = "<p class='sub'>No reviews due. New cards you grade today return tomorrow.</p>";
  todaySet.revChars.slice(0, 24).forEach(ch => rb.appendChild(flashCard(ch, "rev")));
  const allDone = total > 0 && done >= total;
  document.getElementById("daily-done").classList.toggle("hidden", !allDone);
  if (allDone) document.getElementById("daily-summary").textContent =
    `Completed ${todaySet.newChars.length} new + ${todaySet.revChars.length} reviews. Come back tomorrow to keep the streak!`;
  renderDecks();
  renderRing(pct, done, total);
  renderWeekStrip();
  // overall per-level progress
  const learned = new Set(Object.keys(daily.srs));
  document.getElementById("daily-stats").textContent = `${learned.size} / ${KANJI.length} started`;
  const lvBox = document.getElementById("daily-levels");
  lvBox.innerHTML = "";
  LEVELS.forEach(l => {
    const tot = KANJI.filter(k => k.level === l).length;
    const n = KANJI.filter(k => k.level === l && learned.has(k.character)).length;
    const p = tot ? Math.round(n/tot*100) : 0;
    const row = document.createElement("div");
    row.className = "lvl-row";
    row.innerHTML = `<span class="lv">${l}</span><div class="progressbar"><div style="background:var(--brand);height:100%;width:${p}%;border-radius:999px"></div></div><span class="count">${n}/${tot} · ${p}%</span>`;
    lvBox.appendChild(row);
  });
  // library study-log rail mirror
  const log = document.getElementById("lib-log");
  if (log) log.innerHTML = `Course <b>${cp.done}/${cp.total}</b> characters graded · <b>${learned.size}</b> in memory · streak <b>${daily.streak||0}</b> day${(daily.streak||0)===1?"":"s"}.`;
}

const DECK_TONE = ["brand", "amber", "green", "", "brand"];
const DECK_GLYPH = ["語", "走", "食", "水", "話"];
function renderDecks() {
  const box = document.getElementById("daily-decks");
  if (!box) return;
  const learned = new Set(Object.keys(daily.srs));
  const scope = new Set(studyLevels());
  // always show three decks: the active scope first, then the next levels up
  const ordered = [...LEVELS.filter(l => scope.has(l)), ...LEVELS.filter(l => !scope.has(l))];
  const shown = ordered.slice(0, 3);
  box.innerHTML = shown.map((l, i) => {
    const pool = KANJI.filter(k => k.level === l);
    const n = pool.filter(k => learned.has(k.character)).length;
    const pct = pool.length ? Math.round(n / pool.length * 100) : 0;
    const due = pool.filter(k => srsStatus(k.character) === "due").length;
    const label = l === "N5" ? "Core 350 Kanji Characters" : l === "N4" ? "Everyday Verbs" : "Cultural Radicals & Dishes";
    const col = pct >= 66 ? "green" : pct >= 25 ? "amber" : "brand";
    return `<div class="deck ${DECK_TONE[i] || col}">
      <span class="deck-glyph">${DECK_GLYPH[i]}</span>
      <div class="deck-top"><span class="chip chip-brand">JLPT ${l}</span>${due ? `<span class="chip chip-quiet">${due} due</span>` : ""}</div>
      <h3>${esc(label)}</h3>
      <p class="deck-sub">${n} of ${pool.length} characters graded</p>
      <div class="progressbar"><div style="background:var(--brand);height:100%;width:${pct}%;border-radius:999px"></div></div>
      <div class="deck-foot"><span>Progress (${n}/${pool.length})</span><span class="pct">${pct}%</span></div>
    </div>`;
  }).join("");
}

function renderRing(pct, done, total) {
  const ring = document.getElementById("daily-ring");
  if (!ring) return;
  ring.style.setProperty("--p", pct);
  document.getElementById("ring-pct").textContent = pct + "%";
  document.getElementById("ring-goal").textContent = `Goal ${daily.settings.goal}/day`;
  const learned = new Set(Object.keys(daily.srs));
  document.getElementById("ring-stats").innerHTML = `
    <div class="row"><span>Done today</span><b>${done} / ${total}</b></div>
    <div class="row"><span>New cards</span><b>${todaySet.newChars.length}</b></div>
    <div class="row"><span>Reviews due</span><b>${todaySet.revChars.length}</b></div>
    <div class="row"><span>New Kanji</span><b>${learned.size}</b></div>
    <div class="row"><span>Streak</span><b>${daily.streak||0} days</b></div>`;
}

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
function renderWeekStrip() {
  const box = document.getElementById("week-strip");
  if (!box) return;
  const today = dayKey();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: dayKey(d), letter: DAY_LETTERS[d.getDay()], today: i === 0 });
  }
  box.innerHTML = days.map(d =>
    `<span class="day${d.today ? " today" : ""}"><i class="${daily.days[d.key] ? "on" : ""}">${daily.days[d.key] ? "✓" : ""}</i><span>${d.letter}</span></span>`
  ).join("");
}

function dailyScopeSignature() {
  return studyLevels().join("+");
}

function buildTodaySetIfStale() {
  const lvl = document.getElementById("daily-level")?.value;
  if (lvl && lvl !== daily.settings.level) return; // settings UI drives rebuild
  const boxes = [...document.querySelectorAll("#daily-scope input:checked")].map(i => i.value)
    .sort((a,b) => LEVELS.indexOf(a)-LEVELS.indexOf(b)).join("+");
  if (boxes && boxes !== dailyScopeSignature()) return; // scope UI drives rebuild
  if (todaySet.date !== dayKey()) buildTodaySet();
}

function initDaily() {
  const lvSel = document.getElementById("daily-level");
  const goalIn = document.getElementById("daily-goal");
  const scopeBoxes = [...document.querySelectorAll("#daily-scope input")];
  const paintScope = () => scopeBoxes.forEach(b => b.checked = (daily.settings.scope || []).includes(b.value));
  lvSel.value = daily.settings.level;
  goalIn.value = daily.settings.goal;
  paintScope();
  const setScope = (scope) => {
    daily.settings.scope = [...new Set(scope.filter(l => LEVELS.includes(l)))];
    if (!daily.settings.scope.length) daily.settings.scope = [daily.settings.level];
    paintScope();
    saveDailyStore();
    buildTodaySet();
    renderDaily();
    sessReset();
  };
  lvSel.onchange = () => {
    daily.settings.level = lvSel.value;
    daily.settings.goal = GOAL_DEFAULTS[lvSel.value] ?? 5;
    goalIn.value = daily.settings.goal;
    setScope([lvSel.value]); // new level -> focus only that level; user can re-check more
  };
  goalIn.onchange = () => {
    daily.settings.goal = Math.min(20, Math.max(3, parseInt(goalIn.value, 10) || 5));
    goalIn.value = daily.settings.goal;
    saveDailyStore();
    buildTodaySet();
    renderDaily();
    sessReset();
  };
  document.getElementById("daily-start").onclick = () => {
    buildTodaySet();
    renderDaily();
    sessReset();
    sessLearn();
    scrollTo(document.getElementById("sess-box"), { behavior: "smooth", block: "center" });
  };
  document.getElementById("daily-only").onclick = () => setScope([daily.settings.level]);
  document.getElementById("daily-below").onclick = () => {
    const idx = LEVELS.indexOf(daily.settings.level);
    setScope(LEVELS.slice(0, idx + 1));
  };
  scopeBoxes.forEach(b => b.onchange = () => {
    setScope(scopeBoxes.filter(x => x.checked).map(x => x.value));
  });
  document.getElementById("daily-reset").onclick = () => {
    if (!confirm("Reset all daily progress + SRS memory on this PC?")) return;
    daily = { settings: { level: lvSel.value, goal: parseInt(goalIn.value, 10) || 5, scope: [lvSel.value] }, srs: {}, days: {}, streak: 0, lastActive: null };
    paintScope();
    saveDailyStore();
    buildTodaySet();
    renderDaily();
    sessReset();
    try { renderLibrary(); } catch {}
  };
  document.getElementById("sess-learn").onclick = () => { buildTodaySet(); renderDaily(); sessLearn(); };
  document.getElementById("sess-next-2").onclick = () => {
    if (sess.phase !== "learn" || !todaySet.newChars.length) return;
    sess.learnIdx = (sess.learnIdx + 1) % todaySet.newChars.length;
    renderSess();
  };
  document.getElementById("sess-prev").onclick = () => {
    if (sess.phase !== "learn" || !todaySet.newChars.length) return;
    sess.learnIdx = (sess.learnIdx - 1 + todaySet.newChars.length) % todaySet.newChars.length;
    renderSess();
  };
  document.getElementById("daily-export").onclick = () => {
    const data = { app: "kanji-practice", v: 1, exported: dayKey(),
      daily: JSON.parse(localStorage.getItem(DAILY_KEY) || "null"),
      best: JSON.parse(localStorage.getItem("kanji-best") || "null"),
      custom: JSON.parse(localStorage.getItem("kanji-custom") || "null") };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kanji-progress-${dayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  document.getElementById("daily-import-btn").onclick = () => document.getElementById("daily-import").click();
  document.getElementById("daily-import").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        if (!data.daily?.settings || !data.daily?.srs || !data.daily?.days) throw new Error("bad file");
        daily = data.daily;
        if (data.best) localStorage.setItem("kanji-best", JSON.stringify(data.best));
        if (data.custom) localStorage.setItem("kanji-custom", JSON.stringify(data.custom));
        saveDailyStore();
        lvSel.value = daily.settings.level;
        goalIn.value = daily.settings.goal;
        paintScope();
        buildTodaySet();
        renderDaily();
        restoreSess();
        try { renderLibrary(); renderBest(); renderCompounds(); } catch {}
        alert("Progress imported ✅");
      } catch { alert("Couldn't import that file — is it a kanji-progress export?"); }
    };
    rd.readAsText(f);
    e.target.value = "";
  };
  buildTodaySet();
  renderDaily();
  restoreSess();
}

// ---------- guided daily session: Learn -> reveal ----------
let sess = { phase: "idle", learnIdx: 0, viewed: new Set(), quizPool: [], quizIdx: 0, checked: false, typed: "", meaningOk: null, perfect: 0, partial: 0, miss: 0, misses: [], round: 1 };

function sessReset() {
  sess = { phase: "idle", learnIdx: 0, viewed: new Set(), quizPool: [], quizIdx: 0, checked: false, typed: "", meaningOk: null, perfect: 0, partial: 0, miss: 0, misses: [], round: 1 };
  try { renderSess(); } catch {}
}

// persist guided-session state on every render, so a reload resumes
// mid-lesson (same card, same quiz position) instead of restarting at 0
function saveSess() {
  try {
    const today = dayKey();
    if (!daily.days[today]) daily.days[today] = { newChars: [], graded: {} };
    daily.days[today].sess = { phase: sess.phase, learnIdx: sess.learnIdx,
      viewed: [...sess.viewed], quizPool: sess.quizPool, quizIdx: sess.quizIdx,
      checked: sess.checked, typed: sess.typed, meaningOk: sess.meaningOk,
      perfect: sess.perfect, partial: sess.partial, miss: sess.miss,
      misses: sess.misses, round: sess.round };
    saveDailyStore();
  } catch {}
}
function restoreSess() {
  try {
    const s = daily.days[dayKey()]?.sess;
    if (s && s.phase === "learn") {
      sess = { phase: "learn", learnIdx: s.learnIdx || 0, viewed: new Set(s.viewed || []),
        quizPool: [], quizIdx: 0, checked: false, typed: "", meaningOk: null,
        perfect: 0, partial: 0, miss: 0, misses: [], round: 1 };
    } else {
      sess = { phase: "idle", learnIdx: 0, viewed: new Set(), quizPool: [], quizIdx: 0, checked: false, typed: "", meaningOk: null, perfect: 0, partial: 0, miss: 0, misses: [], round: 1 };
    }
  } catch {
    sess = { phase: "idle", learnIdx: 0, viewed: new Set(), quizPool: [], quizIdx: 0, checked: false, typed: "", meaningOk: null, perfect: 0, partial: 0, miss: 0, misses: [], round: 1 };
  }
  try { renderSess(); } catch {}
}

function sessLearn() {
  if (!todaySet.newChars.length && !todaySet.revChars.length) {
    document.getElementById("sess-status").textContent = "Nothing to learn today — scope is empty or all done. Adjust scope above.";
    return;
  }
  sess.phase = "learn";
  sess.learnIdx = 0;
  renderSess();
}

function sessCardHTML(ch, showAnswer) {
  const k = kanjiMap.get(ch);
  const ex = VOCAB.filter(v => v.word.includes(ch)).slice(0, 2);
  return `<div class="tile-top" style="position:static;display:flex;justify-content:center;margin-bottom:4px"><span class="badge">${esc(k.level)}</span></div>
    <div class="sess-card-big">${esc(ch)}</div>
    ${showAnswer ? `<div class="sess-meaning"><b>${esc(k.meanings.join(", "))}</b></div>
    <div class="sess-reading">音 ${esc((k.onyomi||[]).join("・")||"—")} · 訓 ${esc((k.kunyomi||[]).join("・")||"—")} · ${k.strokes ?? "—"} strokes</div>
    <div class="sess-examples"><b>Usage</b><ul>${ex.map(v => `<li>${esc(v.word)} (${esc(v.reading)}) — ${esc(v.meanings.slice(0,2).join(", "))}</li>`).join("") || "<li>—</li>"}</ul></div>`
    : `<div class="sess-meaning"><span style="color:var(--muted);font-weight:500">Try to recall the meaning + reading, then Reveal.</span></div>`}`;
}

function renderSess() {
  const box = document.getElementById("sess-card");
  const status = document.getElementById("sess-status");
  if (!box || !KANJI.length) return;
  saveSess();
  if (sess.phase === "idle") {
    status.textContent = `Press Learn to walk through ${todaySet.newChars.length} new kanji one by one. Quiz yourself in the Test tab.`;
    box.innerHTML = "";
    return;
  }
  if (sess.phase === "learn") {
    const list = todaySet.newChars;
    if (!list.length) { status.textContent = "No new kanji today — review in the Test tab."; box.innerHTML = ""; return; }
    sess.learnIdx = Math.min(Math.max(0, sess.learnIdx), list.length - 1);
    const ch = list[sess.learnIdx];
    const revealed = sess.viewed.has(ch + "@" + sess.learnIdx) || sess.viewed.has(ch);
    status.textContent = `Learn ${sess.learnIdx + 1}/${list.length} · recalled ${[...sess.viewed].filter(x => list.includes(x)).length}/${list.length}.`;
    box.innerHTML = `${sessCardHTML(ch, revealed)}
      <div class="controls"><button id="sess-reveal">${revealed ? "Hide" : "Reveal answer"}</button></div>`;
    document.getElementById("sess-reveal").onclick = () => {
      if (sess.viewed.has(ch)) sess.viewed.delete(ch); else sess.viewed.add(ch);
      renderSess();
    };
    return;
  }
}

// ---------- header: global search, streak pill, shortcuts ----------
function focusHdrSearch() {
  const h = document.getElementById("hdr-search");
  if (h) { h.focus(); h.select(); }
}
function submitHdrSearch() {
  const h = document.getElementById("hdr-search");
  const q = (h?.value || "").trim();
  document.querySelector("[data-tab='library']").click();
  if (q) {
    document.getElementById("lib-search").value = q;
    libPage = 1;
    renderLibrary();
  }
}
function paintHdrStreak() {
  const el = document.getElementById("hdr-streak");
  if (el) el.textContent = `🔥 ${daily.streak || 0} days`;
  const lv = document.getElementById("hdr-level");
  if (lv) lv.textContent = daily.settings.level;
  const xp = document.getElementById("hdr-xp");
  if (xp) {
    const learned = Object.keys(daily.srs).length;
    const reviewed = Object.values(daily.srs).reduce((a, e) => a + (e.reps || 0), 0);
    xp.textContent = `◈ ${(learned * 50 + reviewed * 10).toLocaleString()} XP`;
  }
}
document.getElementById("hdr-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitHdrSearch();
  else if (e.key === "Escape") e.target.blur();
});
document.getElementById("theme-btn").onclick = toggleTheme;
function paintTheme() {
  const dark = document.documentElement.classList.contains("dark");
  const b = document.getElementById("theme-btn");
  if (b) b.textContent = dark ? "☀️" : "🌙";
  const lbl = document.getElementById("side-theme-label");
  if (lbl) lbl.textContent = dark ? "Light mode" : "Dark mode";
}
paintTheme();
document.addEventListener("keydown", (e) => {
  const tag = (document.activeElement?.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select";
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); focusHdrSearch(); return; }
  if (e.key === "/" && !typing) { e.preventDefault(); focusHdrSearch(); return; }
  if (e.key === "Escape") {
    ["kanji-detail", "help-modal"].forEach(id => document.getElementById(id)?.classList.add("hidden"));
    closeNav();
    if (typing) document.activeElement.blur();
    return;
  }
  if (typing) return;
  const playVisible = !document.getElementById("quiz-play").classList.contains("hidden");
  const quizActive = document.getElementById("tab-quiz").classList.contains("active") && playVisible;
  if (quizActive) {
    if (["1", "2", "3", "4"].includes(e.key)) {
      const btns = [...document.querySelectorAll("#quiz-opts button")].filter(b => !b.disabled);
      const b = btns[parseInt(e.key, 10) - 1];
      if (b) b.click();
    } else if (e.key === "Enter") {
      const nx = document.getElementById("quiz-next");
      if (!nx.classList.contains("hidden")) nx.click();
    }
    return;
  }
  // secondary nav: 1-4 switch tabs when no quiz is running
  if (["1", "2", "3", "4"].includes(e.key)) {
    const tabs = ["daily", "library", "quiz", "compounds"];
    const b = document.querySelector(`[data-tab='${tabs[parseInt(e.key,10)-1]}']`);
    if (b) b.click();
  }
});

// ---------- cloud sync (Supabase): shared progress across PC + phone ----------
// Local-first: everything still works offline in localStorage. When logged in,
// changes push (debounced) and the other device merges them in on next pull.
const SUPA_CFG_KEY = "kanji-supa-cfg";
const SUPA_ENABLED = false; // cloud sync disabled for now — flip to true to re-enable
let supa = null, supaReady = null, supaUser = null;
let syncDirty = false, syncTimer = null, lastPullAt = 0;

function getSupaCfg() {
  try { return JSON.parse(localStorage.getItem(SUPA_CFG_KEY) || "null") || {}; }
  catch { return {}; }
}
function normSupaUrl(u) {
  return String(u || "").trim().replace(/\/+$/, "").replace(/\/(rest\/v1|auth\/v1)$/, "");
}
function setSyncStatus(t) {
  const el = document.getElementById("sync-status");
  const map = { off: "Not connected", local: "● Local only (log in to sync)",
    syncing: "↻ Syncing…", ready: "● Up to date", error: "⚠ Sync error — retry" };
  if (el) el.textContent = map[t] || t;
}
async function supaClient() {
  if (supa) return supa;
  if (!supaReady) supaReady = (async () => {
    const cfg = getSupaCfg();
    if (!cfg.url || !cfg.key) return null;
    const mod = await import("https://esm.sh/@supabase/supabase-js@2.39.0");
    supa = mod.createClient(normSupaUrl(cfg.url), cfg.key);
    return supa;
  })().catch(() => null);
  return supaReady;
}
function markDirty() {
  syncDirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { if (syncDirty) pushCloud(); }, 4000);
}
function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

async function pushCloud(force = false) {
  if (!force && !syncDirty) return true;
  let client = null;
  try { client = await supaClient(); } catch { client = null; }
  if (!client || !supaUser) return false;
  setSyncStatus("syncing");
  try {
    stampDaily();
    writeDailyStore();
    const doc = { daily, best: readJSON("kanji-best"), custom: readJSON("kanji-custom"),
      clientUpdatedAt: daily.clientUpdatedAt };
    const { error } = await client.from("progress").upsert(
      { user_id: supaUser.id, data: doc, updated_at: new Date().toISOString() },
      { on_conflict: "user_id" });
    if (error) throw error;
    syncDirty = false;
    setSyncStatus("ready");
    return true;
  } catch { setSyncStatus("error"); return false; }
}

async function pullCloud() {
  let client = null;
  try { client = await supaClient(); } catch { client = null; }
  if (!client || !supaUser) return false;
  setSyncStatus("syncing");
  try {
    const { data } = await client.from("progress")
      .select("data,updated_at").eq("user_id", supaUser.id).maybeSingle();
    lastPullAt = Date.now();
    if (data?.data?.daily) mergeCloudDoc(data.data);
    else await pushCloud(true); // first device: upload local progress
    if (syncDirty) await pushCloud(true);
    else setSyncStatus("ready");
    return true;
  } catch { setSyncStatus("error"); return false; }
}

// merge a cloud doc into local state: per-kanji winner = higher reps (tie: later due),
// per-day graded prefers the newer doc, streak follows latest activity, bests take max
function mergeCloudDoc(doc) {
  try {
    const cloud = doc.daily;
    if (!cloud || !cloud.settings || !cloud.srs || !cloud.days) return;
    const cloudNewer = (cloud.clientUpdatedAt || "") >= (daily.clientUpdatedAt || "");
    if (cloudNewer) daily.settings = { ...daily.settings, ...cloud.settings };
    for (const [ch, e] of Object.entries(cloud.srs || {})) {
      const mine = daily.srs[ch];
      if (!mine) daily.srs[ch] = e;
      else {
        const mr = mine.reps || 0, cr = e.reps || 0;
        if (cr > mr || (cr === mr && (e.due || "") > (mine.due || ""))) daily.srs[ch] = e;
      }
    }
    for (const [day, d] of Object.entries(cloud.days || {})) {
      if (!daily.days[day]) {
        daily.days[day] = { newChars: [...(d.newChars || [])], graded: { ...(d.graded || {}) } };
        if (d.sess) daily.days[day].sess = d.sess;
      } else {
        const mine = daily.days[day];
        mine.newChars = [...new Set([...(mine.newChars || []), ...(d.newChars || [])])];
        mine.graded = cloudNewer
          ? { ...(mine.graded || {}), ...(d.graded || {}) }
          : { ...(d.graded || {}), ...(mine.graded || {}) };
        if (d.sess && !mine.sess) mine.sess = d.sess;
      }
    }
    if ((cloud.lastActive || "") >= (daily.lastActive || "")) {
      daily.streak = cloud.streak || 0;
      daily.lastActive = cloud.lastActive || null;
    }
    if (cloudNewer || !daily.clientUpdatedAt) daily.clientUpdatedAt = cloud.clientUpdatedAt || daily.clientUpdatedAt;
    try {
      const lb = JSON.parse(localStorage.getItem("kanji-best") || "{}");
      for (const [k, v] of Object.entries(doc.best || {})) {
        if (!lb[k] || parseInt(v) > parseInt(lb[k])) lb[k] = v;
      }
      localStorage.setItem("kanji-best", JSON.stringify(lb));
    } catch {}
    try {
      const lc = JSON.parse(localStorage.getItem("kanji-custom") || "[]");
      const seen = new Set(lc.map(x => x.word));
      for (const c of doc.custom || []) {
        if (c?.word && !seen.has(c.word)) { lc.push(c); seen.add(c.word); }
      }
      localStorage.setItem("kanji-custom", JSON.stringify(lc));
    } catch {}
    stampDaily();
    writeDailyStore();
    syncDirty = true;
    buildTodaySet();
    renderDaily();
    restoreSess();
    try { renderLibrary(); renderBest(); renderCompounds(); } catch {}
  } catch {}
}
function paintAcct() {
  const email = supaUser?.email || "";
  const msg = document.getElementById("acct-msg");
  if (msg && !msg.textContent) msg.textContent = email ? `Logged in as ${email}` : "";
  const lo = document.getElementById("acct-logout");
  if (lo) lo.classList.toggle("hidden", !supaUser);
  const av = document.getElementById("hdr-level");
  if (av) av.title = email ? `Synced as ${email} — click for account` : "Study level — click for account";
}
function openAcct() {
  const cfg = getSupaCfg();
  const u = document.getElementById("supa-url");
  if (!u) return;
  u.value = cfg.url || "";
  document.getElementById("supa-key").value = cfg.key || "";
  document.getElementById("acct-msg").textContent = "";
  paintAcct();
  document.getElementById("acct-modal").classList.remove("hidden");
}

async function supaInit() {
  if (!SUPA_ENABLED) return; // disabled — everything stays local-only
  let client = null;
  try { client = await supaClient(); } catch { client = null; }
  if (!client) { setSyncStatus("local"); paintAcct(); return; }
  try {
    const { data: { session } } = await client.auth.getSession();
    supaUser = session?.user || null;
    if (supaUser) await pullCloud();
    else setSyncStatus("local");
  } catch { setSyncStatus("error"); }
  paintAcct();
}

async function acctAuth(mode) {
  const msgEl = document.getElementById("acct-msg");
  const msg = (t) => { if (msgEl) msgEl.textContent = t; };
  let client = null;
  try { client = await supaClient(); } catch { client = null; }
  if (!client) { msg("Save your Project URL + anon key first."); return; }
  const email = document.getElementById("acct-email").value.trim();
  const password = document.getElementById("acct-pass").value;
  if (!email || !password) { msg("Enter email + password."); return; }
  msg(mode === "signup" ? "Creating account…" : "Logging in…");
  try {
    const res = mode === "signup"
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    if (res.error) throw res.error;
    supaUser = res.data.user || res.data.session?.user || null;
    if (!supaUser) {
      try {
        const s = await client.auth.getSession();
        supaUser = s.data.session?.user || null;
      } catch {}
    }
    if (!supaUser) {
      msg("Account created — check your inbox to confirm (or turn off “Confirm email” in Supabase → Auth → Providers → Email for instant access).");
      paintAcct();
      return;
    }
    msg("Logged in — syncing…");
    await pullCloud();
    await pushCloud(true);
    setSyncStatus("ready");
    paintAcct();
  } catch (e) { msg("Error: " + (e.message || e)); setSyncStatus("error"); }
}

document.getElementById("hdr-level").onclick = () => {
  document.querySelector("[data-tab='daily']").click();
  scrollTo(document.getElementById("sess-box"), { behavior: "smooth", block: "center" });
};
// Supabase cloud sync is DISABLED for now (flip SUPA_ENABLED to re-enable).
// The whole block below no-ops while the account UI is absent from the page.
if (document.getElementById("acct-btn")) {
document.getElementById("acct-btn").onclick = openAcct;
document.getElementById("acct-close").onclick = () =>
  document.getElementById("acct-modal").classList.add("hidden");
document.getElementById("supa-save").onclick = async () => {
  const url = normSupaUrl(document.getElementById("supa-url").value);
  const key = document.getElementById("supa-key").value.trim();
  try { localStorage.setItem(SUPA_CFG_KEY, JSON.stringify({ url, key })); } catch {}
  supa = null; supaReady = null;
  document.getElementById("acct-msg").textContent = url && key ? "Connecting…" : "Enter Project URL + anon key.";
  await supaInit();
};
document.getElementById("acct-login").onclick = () => acctAuth("login");
document.getElementById("acct-signup").onclick = () => acctAuth("signup");
document.getElementById("acct-logout").onclick = async () => {
  await pushCloud(true);
  try { (await supaClient())?.auth.signOut(); } catch {}
  supaUser = null;
  syncDirty = false;
  setSyncStatus("local");
  paintAcct();
};
document.getElementById("sync-now").onclick = async () => {
  if (!supaUser) { openAcct(); return; }
  await pullCloud();
  syncDirty = true;
  await pushCloud(true);
  try { renderDaily(); } catch {}
};
} // end Supabase-disabled guard
setInterval(() => { if (syncDirty && supaUser) pushCloud(); }, 120000);
document.addEventListener("online", () => { if (supaUser) pullCloud(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && supaUser && Date.now() - lastPullAt > 5 * 60 * 1000) pullCloud();
});

paintIcons();
loadData().catch(err => {
  document.getElementById("lib-stats").textContent =
    "Failed to load data. Run via a local server (python -m http.server), not file://. " + err;
});