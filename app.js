/* =========================================================================
   Eat That Frog — Productivity OS
   Vanilla JS. No frameworks. Offline-first (localStorage + IndexedDB).
   Author: AMA Global Inc.
   ========================================================================= */
(function () {
  "use strict";

  /* =======================================================================
     0. CONSTANTS & HELPERS
     ======================================================================= */
  const STORAGE_KEY = "etf_state_v1";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);
  const escapeHtml = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  function daysBetween(a, b) {
    return Math.round((new Date(a) - new Date(b)) / 86400000);
  }
  function relativeDeadline(deadline) {
    if (!deadline) return { label: "No deadline", urgent: false };
    const diff = daysBetween(deadline, todayKey());
    if (diff < 0) return { label: `Overdue ${-diff}d`, urgent: true, over: true };
    if (diff === 0) return { label: "Due today", urgent: true };
    if (diff === 1) return { label: "Due tomorrow", urgent: true };
    if (diff <= 7) return { label: `Due in ${diff}d`, urgent: diff <= 3 };
    return { label: `Due in ${diff}d`, urgent: false };
  }

  const QUOTES = [
    ["If the first thing you do each morning is to eat a live frog, you can go through the day knowing the worst is behind you.", "Brian Tracy"],
    ["The ability to concentrate single-mindedly on your most important task is the key to great success.", "Brian Tracy"],
    ["If you have to eat two frogs, eat the ugliest one first.", "Brian Tracy"],
    ["Successful people are those who launch directly into their major tasks and discipline themselves to work steadily.", "Brian Tracy"],
    ["There is never enough time to do everything, but there is always enough time to do the most important thing.", "Brian Tracy"],
    ["The key to success is action — and the essential first step is to start.", "Brian Tracy"],
    ["Every minute you spend in planning saves as many as ten minutes in execution.", "Brian Tracy"],
    ["A task started is more likely to be a task completed — develop a sense of urgency.", "Brian Tracy"],
  ];

  const BADGE_DEFS = [
    { id: "first_frog", ico: "🐸", label: "First Frog", test: (s) => s.tasks.some((t) => t.done) },
    { id: "frog5", ico: "🏅", label: "5 Frogs", test: (s) => s.tasks.filter((t) => t.done).length >= 5 },
    { id: "frog25", ico: "🏆", label: "25 Frogs", test: (s) => s.tasks.filter((t) => t.done).length >= 25 },
    { id: "streak3", ico: "🔥", label: "3-Day Streak", test: (s) => bestHabitStreak(s) >= 3 },
    { id: "streak7", ico: "⚡", label: "7-Day Streak", test: (s) => bestHabitStreak(s) >= 7 },
    { id: "focus10", ico: "🎧", label: "10 Sessions", test: (s) => s.focusSessions.length >= 10 },
    { id: "goal1", ico: "🎯", label: "Goal Crusher", test: (s) => s.goals.some((g) => goalProgress(g) >= 100) },
    { id: "level5", ico: "🌟", label: "Level 5", test: (s) => levelInfo(s.xp).level >= 5 },
  ];

  /* =======================================================================
     1. STATE & PERSISTENCE
     ======================================================================= */
  function defaultState() {
    return {
      profile: { name: "Achiever", theme: "dark" },
      xp: 0,
      tasks: [],
      goals: [],
      habits: [],
      planner: {}, // { '2026-06-15': { '9': {title, color} } }
      focusSessions: [], // {date, minutes, type}
      kra: [
        { id: uid(), name: "Career", grade: 70 },
        { id: uid(), name: "Health", grade: 55 },
        { id: uid(), name: "Relationships", grade: 65 },
        { id: uid(), name: "Personal Growth", grade: 60 },
      ],
      reviews: [], // {date, type, text, rating}
      settings: { pomodoro: 25, shortBreak: 5, longBreak: 15, sound: false, soundType: "brown" },
      dailyDone: {}, // {dateKey: count} for consistency tracker
      lastVisit: todayKey(),
    };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) {
      console.log("[v0] load error", e.message);
    }
    return seedState(defaultState());
  }

  let saveTimer = null;
  function save() {
    state.lastVisit = todayKey();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.log("[v0] localStorage save failed", e.message);
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => idbSave(state), 400); // debounced IndexedDB backup
    updateLevelCard();
  }

  /* ---- IndexedDB backup layer ---- */
  let _db = null;
  function idbOpen() {
    return new Promise((res, rej) => {
      if (_db) return res(_db);
      const req = indexedDB.open("etf_db", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => { _db = req.result; res(_db); };
      req.onerror = () => rej(req.error);
    });
  }
  async function idbSave(data) {
    try {
      const db = await idbOpen();
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(JSON.stringify(data), "state");
    } catch (e) { console.log("[v0] idb save skipped", e.message); }
  }

  /* ---- Seed demo data on first run ---- */
  function seedState(s) {
    const tk = todayKey();
    const future = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return todayKey(x); };
    s.tasks = [
      task("Finish Q3 strategy presentation", { desc: "Most important deliverable for the board meeting.", importance: 10, consequence: 9, difficulty: 8, deadline: future(1), category: "Work", estimate: 120 }),
      task("Prepare tax documents", { desc: "Gather receipts and submit filing.", importance: 8, consequence: 9, difficulty: 5, deadline: future(3), category: "Finance", estimate: 90 }),
      task("Reply to client emails", { desc: "Inbox cleanup.", importance: 5, consequence: 4, difficulty: 2, deadline: future(0), category: "Work", estimate: 30 }),
      task("Read industry newsletter", { desc: "Nice to do.", importance: 3, consequence: 2, difficulty: 1, category: "Growth", estimate: 20 }),
      task("Organize old downloads folder", { desc: "Can be eliminated.", importance: 1, consequence: 1, difficulty: 2, category: "Personal", estimate: 15 }),
    ];
    s.goals = [
      goal("Launch side business", "long", future(180), [
        { id: uid(), text: "Validate idea", done: true },
        { id: uid(), text: "Build MVP", done: false },
        { id: uid(), text: "First 10 customers", done: false },
      ]),
      goal("Run a half marathon", "monthly", future(45), [
        { id: uid(), text: "Run 5k", done: true },
        { id: uid(), text: "Run 10k", done: true },
        { id: uid(), text: "Run 15k", done: false },
      ]),
    ];
    s.habits = [
      habit("Eat the frog before 9am", "🐸"),
      habit("Exercise 30 minutes", "💪"),
      habit("Read 20 pages", "📚"),
      habit("No social media before noon", "🚫"),
    ];
    // pre-fill a little habit history for visuals
    s.habits.forEach((h) => {
      for (let i = 1; i < 6; i++) if (Math.random() > 0.35) h.history.push(daysAgoKey(i));
    });
    s.xp = 120;
    return s;
  }
  function daysAgoKey(n) { const d = new Date(); d.setDate(d.getDate() - n); return todayKey(d); }

  /* ---- Entity factories ---- */
  function task(title, o = {}) {
    return {
      id: uid(), title, desc: o.desc || "", category: o.category || "General",
      importance: o.importance ?? 5, consequence: o.consequence ?? 5, difficulty: o.difficulty ?? 5,
      estimate: o.estimate ?? 30, deadline: o.deadline || "", notes: o.notes || "",
      priority: o.priority || "", // A-E, auto if blank
      done: false, created: Date.now(), completedAt: null, order: Date.now(),
    };
  }
  function goal(title, type, deadline, milestones) {
    return { id: uid(), title, type: type || "short", deadline: deadline || "", notes: "", motivation: 7, milestones: milestones || [], created: Date.now() };
  }
  function habit(name, ico) {
    return { id: uid(), name, ico: ico || "✅", category: "General", difficulty: "medium", history: [], created: Date.now() };
  }

  /* =======================================================================
     2. DERIVED LOGIC (scoring, frogs, abcde, xp, analytics)
     ======================================================================= */
  function frogScore(t) {
    const dl = relativeDeadline(t.deadline);
    let urgency = 0;
    if (t.deadline) {
      const diff = daysBetween(t.deadline, todayKey());
      urgency = diff <= 0 ? 10 : diff <= 1 ? 8 : diff <= 3 ? 6 : diff <= 7 ? 4 : 2;
    }
    const raw = t.importance * 3.2 + t.consequence * 3.2 + t.difficulty * 1.6 + urgency * 2;
    return Math.round(clamp(raw / 10, 0, 10) * 10) / 10; // 0-10
  }
  function autoPriority(t) {
    if (t.priority) return t.priority;
    const sc = t.importance + t.consequence;
    if (t.importance <= 2 && t.consequence <= 2) return "E";
    if (t.difficulty <= 3 && t.importance <= 4) return "D";
    if (sc >= 16) return "A";
    if (sc >= 11) return "B";
    if (sc >= 7) return "C";
    return "D";
  }
  function priorityRank(p) { return { A: 0, B: 1, C: 2, D: 3, E: 4 }[p] ?? 5; }

  function sortedTasks(includeDone = false) {
    return state.tasks
      .filter((t) => includeDone || !t.done)
      .slice()
      .sort((a, b) => {
        const pa = priorityRank(autoPriority(a)), pb = priorityRank(autoPriority(b));
        if (pa !== pb) return pa - pb;
        const fa = frogScore(a), fb = frogScore(b);
        if (fb !== fa) return fb - fa;
        return (a.order || 0) - (b.order || 0);
      });
  }
  function biggestFrog() {
    const open = state.tasks.filter((t) => !t.done);
    if (!open.length) return null;
    return open.slice().sort((a, b) => frogScore(b) - frogScore(a))[0];
  }

  function levelInfo(xp) {
    // level n needs n*100 cumulative; smooth curve
    let level = 1, need = 100, total = xp;
    while (total >= need) { total -= need; level++; need = level * 100; }
    return { level, into: total, need, pct: Math.round((total / need) * 100) };
  }
  function addXP(amount, reason) {
    const before = levelInfo(state.xp).level;
    state.xp += amount;
    const after = levelInfo(state.xp).level;
    if (after > before) {
      toast(`Level up! You reached Level ${after} 🌟`, "success");
      confetti();
    }
    if (reason) toast(`+${amount} XP · ${reason}`, "success");
  }

  function goalProgress(g) {
    if (!g.milestones.length) return 0;
    return Math.round((g.milestones.filter((m) => m.done).length / g.milestones.length) * 100);
  }
  function habitStreak(h) {
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      if (h.history.includes(daysAgoKey(i))) streak++;
      else if (i === 0) continue; // today not done yet doesn't break
      else break;
    }
    return streak;
  }
  function bestHabitStreak(s) { return s.habits.reduce((m, h) => Math.max(m, habitStreak(h)), 0); }

  function productivityScore() {
    const open = state.tasks.filter((t) => !t.done);
    const doneToday = state.tasks.filter((t) => t.done && t.completedAt && todayKey(new Date(t.completedAt)) === todayKey()).length;
    const habitsToday = state.habits.filter((h) => h.history.includes(todayKey())).length;
    const focusToday = state.focusSessions.filter((f) => f.date === todayKey()).reduce((a, b) => a + b.minutes, 0);
    let score = 30;
    score += Math.min(30, doneToday * 8);
    score += Math.min(20, habitsToday * 6);
    score += Math.min(20, focusToday / 5);
    score -= Math.min(20, open.filter((t) => relativeDeadline(t.deadline).over).length * 5);
    return clamp(Math.round(score), 0, 100);
  }
  function dailyProgress() {
    const today = state.tasks.filter((t) => autoPriority(t) <= "C" || true);
    const open = state.tasks.filter((t) => !t.done);
    const total = state.tasks.length;
    if (!total) return 0;
    return Math.round((state.tasks.filter((t) => t.done).length / total) * 100);
  }

  /* =======================================================================
     3. UI PRIMITIVES (toast, modal, confetti, counters)
     ======================================================================= */
  function toast(msg, type = "") {
    const root = $("#toastRoot");
    const el = document.createElement("div");
    el.className = "toast" + (type ? ` toast--${type}` : "");
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.style.transition = "opacity .3s, transform .3s"; el.style.opacity = "0"; el.style.transform = "translateY(10px)"; }, 2600);
    setTimeout(() => el.remove(), 2950);
  }

  function confetti() {
    const colors = ["#16a34a", "#2563eb", "#ea7a17", "#7c3aed", "#dc2626"];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement("div");
      c.className = "confetti";
      c.style.left = Math.random() * 100 + "vw";
      c.style.background = colors[i % colors.length];
      c.style.animation = `confettiFall ${1 + Math.random() * 1.5}s cubic-bezier(.2,.6,.4,1) ${Math.random() * 0.3}s forwards`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 2800);
    }
  }

  function modal(title, sub, bodyHtml, footHtml) {
    const root = $("#modalRoot");
    root.hidden = false;
    root.innerHTML = `
      <div class="modal-overlay" data-close></div>
      <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal__head">
          <div><h2>${escapeHtml(title)}</h2>${sub ? `<p>${escapeHtml(sub)}</p>` : ""}</div>
          <button class="icon-btn" data-close aria-label="Close">&times;</button>
        </div>
        <div class="modal__body">${bodyHtml}</div>
        ${footHtml ? `<div class="modal__foot">${footHtml}</div>` : ""}
      </div>`;
    root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    document.addEventListener("keydown", escClose);
    return root;
  }
  function closeModal() { const r = $("#modalRoot"); r.hidden = true; r.innerHTML = ""; document.removeEventListener("keydown", escClose); }
  function escClose(e) { if (e.key === "Escape") closeModal(); }

  function animateCounter(el, to, dur = 800, suffix = "") {
    const start = 0, t0 = performance.now();
    function step(now) {
      const p = clamp((now - t0) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(start + (to - start) * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function ringSvg(pct, size = 120, stroke = 12, color = "var(--green)", label = "") {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
    return `<div class="ring-center" style="width:${size}px;height:${size}px">
      <svg class="ring" width="${size}" height="${size}">
        <circle class="ring__bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"></circle>
        <circle class="ring__fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
          stroke="${color}" stroke-dasharray="${c}" stroke-dashoffset="${off}"></circle>
      </svg>
      <div class="ring-center__val">${label || pct + "%"}</div>
    </div>`;
  }

  /* =======================================================================
     4. ROUTER
     ======================================================================= */
  const VIEWS = {};
  let currentView = "dashboard";

  function go(view) {
    if (!VIEWS[view]) view = "dashboard";
    currentView = view;
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.dataset.view === view));
    $$(".nav__item").forEach((n) => n.classList.toggle("is-active", n.dataset.view === view));
    $$(".bottomnav__item").forEach((n) => n.classList.toggle("is-active", n.dataset.view === view));
    VIEWS[view]();
    $("#content").scrollTop = 0;
    window.scrollTo(0, 0);
    closeMobileNav();
    location.hash = view;
  }

  function renderCurrent() { if (VIEWS[currentView]) VIEWS[currentView](); }

  function updateLevelCard() {
    const li = levelInfo(state.xp);
    const ring = $("#levelRing"), lbl = $("#levelLabel"), xp = $("#xpLabel");
    if (ring) ring.style.setProperty("--p", li.pct + "%");
    if (lbl) lbl.textContent = "Level " + li.level;
    if (xp) xp.textContent = state.xp + " XP";
  }

  /* =======================================================================
     5. VIEWS  (each renders into #view-<name>)
     ======================================================================= */

  /* ---------- DASHBOARD ---------- */
  VIEWS.dashboard = function () {
    const el = $("#view-dashboard");
    const frog = biggestFrog();
    const q = QUOTES[new Date().getDate() % QUOTES.length];
    const score = productivityScore();
    const prog = dailyProgress();
    const doneFrogs = state.tasks.filter((t) => t.done).length;
    const openFrogs = state.tasks.filter((t) => !t.done).length;
    const focusMin = state.focusSessions.filter((f) => f.date === todayKey()).reduce((a, b) => a + b.minutes, 0);
    const habitsToday = state.habits.filter((h) => h.history.includes(todayKey())).length;
    const goalRate = state.goals.length ? Math.round(state.goals.reduce((a, g) => a + goalProgress(g), 0) / state.goals.length) : 0;
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    el.innerHTML = `
      <div class="hero card--glass mb-16">
        <div>
          <div class="hero__greet">${greet}, ${escapeHtml(state.profile.name)} 👋</div>
          <p class="hero__sub">${openFrogs ? `You have <b>${openFrogs}</b> frogs to eat today. Start with the biggest one.` : "All frogs eaten. Outstanding discipline!"}</p>
          <blockquote class="hero__quote">"${q[0]}"<cite>— ${q[1]}</cite></blockquote>
        </div>
        <div class="hero__frog">
          ${ringSvg(score, 120, 12, "var(--green)", `<div style="text-align:center"><b style="font-size:28px;font-family:var(--ff-display)">${score}</b><br><small class="muted" style="font-size:11px">SCORE</small></div>`)}
        </div>
      </div>

      ${frog ? `
      <div class="frog-banner">
        <span class="big">🐸</span>
        <div style="flex:1">
          <small class="muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700;font-size:11px">Today's biggest frog</small>
          <h3>${escapeHtml(frog.title)}</h3>
          <p>${escapeHtml(frog.desc) || "Eat this first. It has the greatest impact on your day."}</p>
        </div>
        <div class="flex gap-8 wrap">
          <button class="btn btn--primary" data-eat="${frog.id}">Eat the frog</button>
          <button class="btn" data-focusnow="${frog.id}">Focus</button>
        </div>
      </div>` : ""}

      <div class="grid grid--stats mb-16">
        ${statCard("◷", "blue", prog + "%", "Daily Progress", true)}
        ${statCard("🐸", "green", doneFrogs, "Frogs Eaten")}
        ${statCard("🎯", "purple", goalRate + "%", "Goal Completion", true)}
        ${statCard("🎧", "orange", focusMin + "m", "Focus Today")}
      </div>

      <div class="bento">
        <div class="card col-2 row-2">
          <div class="flex between center mb-12"><div class="card__title">📈 7-Day Consistency</div><span class="muted text-xs">tasks completed</span></div>
          <canvas id="chartConsistency" height="200"></canvas>
        </div>
        <div class="card col-2">
          <div class="card__title mb-12">🔥 Habit Momentum</div>
          ${state.habits.length ? state.habits.slice(0, 3).map((h) => {
            const st = habitStreak(h), done = h.history.includes(todayKey());
            return `<div class="flex between center" style="padding:7px 0">
              <span>${h.ico} ${escapeHtml(h.name)}</span>
              <span class="${done ? "" : "muted"}" style="font-weight:700;color:${done ? "var(--orange)" : ""}">${st}🔥</span>
            </div>`;
          }).join("") : `<p class="muted text-sm">No habits yet. Add some in the Habits tab.</p>`}
        </div>
        <div class="card col-2">
          <div class="card__title mb-12">⚡ Time Usage Today</div>
          <canvas id="chartTime" height="120"></canvas>
        </div>
        <div class="card col-2">
          <div class="card__title mb-12">📋 Up Next</div>
          <div class="task-list" id="dashNext"></div>
        </div>
        <div class="card col-2">
          <div class="card__title mb-12">🏅 Achievements</div>
          <div class="badges" id="dashBadges"></div>
        </div>
      </div>
    `;

    // counters animate
    requestAnimationFrame(() => {
      drawConsistencyChart("chartConsistency");
      drawTimeChart("chartTime");
    });

    // up next
    const next = sortedTasks().slice(0, 3);
    $("#dashNext").innerHTML = next.length ? next.map(taskRowMini).join("") : `<p class="muted text-sm">No open tasks. Add a frog!</p>`;
    $$("#dashNext [data-eat]").forEach((b) => b.addEventListener("click", () => { completeTask(b.dataset.eat); }));

    // badges
    renderBadges($("#dashBadges"));

    // wire frog banner
    const eat = el.querySelector("[data-eat]");
    if (eat) eat.addEventListener("click", () => completeTask(eat.dataset.eat));
    const fn = el.querySelector("[data-focusnow]");
    if (fn) fn.addEventListener("click", () => { go("focus"); });
  };

  function statCard(ico, color, val, label, anim) {
    return `<div class="card stat card--hover">
      <div class="stat__top">
        <div class="stat__ico stat__ico--${color}">${ico}</div>
      </div>
      <div class="stat__val counter" ${anim ? `data-count="${parseInt(val)}" data-suffix="%"` : ""}>${val}</div>
      <div class="stat__label">${label}</div>
    </div>`;
  }
  function taskRowMini(t) {
    const p = autoPriority(t), dl = relativeDeadline(t.deadline);
    return `<div class="task task--${p}" style="padding:11px 13px">
      <button class="task__check" data-eat="${t.id}" aria-label="Complete"></button>
      <div class="task__body">
        <div class="task__title">${escapeHtml(t.title)} <span class="tag tag--prio tag--${p}">${p}</span></div>
        <div class="task__meta"><span class="tag ${dl.urgent ? "tag--A tag--prio" : ""}">${dl.label}</span><span class="tag">⭐ ${frogScore(t)}</span></div>
      </div>
    </div>`;
  }
  function renderBadges(container) {
    container.innerHTML = BADGE_DEFS.map((b) => {
      const earned = b.test(state);
      return `<div class="badge ${earned ? "earned" : ""}" title="${escapeHtml(b.label)}">
        <span class="b-ico">${b.ico}</span><small>${escapeHtml(b.label)}</small>
      </div>`;
    }).join("");
  }

  /* ---------- canvas charts ---------- */
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function setupCanvas(id, h) {
    const c = $("#" + id); if (!c) return null;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || c.parentElement.clientWidth;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    return { ctx, w, h };
  }
  function drawConsistencyChart(id) {
    const s = setupCanvas(id, 200); if (!s) return;
    const { ctx, w, h } = s;
    const days = []; for (let i = 6; i >= 0; i--) days.push(daysAgoKey(i));
    const data = days.map((d) => state.tasks.filter((t) => t.done && t.completedAt && todayKey(new Date(t.completedAt)) === d).length);
    const max = Math.max(3, ...data);
    const pad = 28, bw = (w - pad) / days.length;
    const green = cssVar("--green"), dim = cssVar("--text-faint"), border = cssVar("--border");
    ctx.clearRect(0, 0, w, h);
    // gridlines
    ctx.strokeStyle = border; ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const y = 10 + (h - 40) * (i / 3); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w, y); ctx.stroke(); }
    data.forEach((v, i) => {
      const bh = (v / max) * (h - 40);
      const x = pad + i * bw + bw * 0.2, bwid = bw * 0.6, y = h - 30 - bh;
      const grad = ctx.createLinearGradient(0, y, 0, h - 30);
      grad.addColorStop(0, green); grad.addColorStop(1, green + "55");
      ctx.fillStyle = grad;
      roundRect(ctx, x, y, bwid, bh, 6); ctx.fill();
      ctx.fillStyle = dim; ctx.font = "11px Inter"; ctx.textAlign = "center";
      ctx.fillText(["S", "M", "T", "W", "T", "F", "S"][new Date(days[i]).getDay()], x + bwid / 2, h - 12);
      if (v) { ctx.fillStyle = cssVar("--text"); ctx.font = "bold 11px Inter"; ctx.fillText(v, x + bwid / 2, y - 6); }
    });
  }
  function drawTimeChart(id) {
    const s = setupCanvas(id, 120); if (!s) return;
    const { ctx, w, h } = s;
    const cats = {};
    state.tasks.filter((t) => t.done).forEach((t) => { cats[t.category] = (cats[t.category] || 0) + (t.estimate || 30); });
    const focusMin = state.focusSessions.filter((f) => f.date === todayKey()).reduce((a, b) => a + b.minutes, 0);
    if (focusMin) cats["Focus"] = (cats["Focus"] || 0) + focusMin;
    const entries = Object.entries(cats);
    const total = entries.reduce((a, [, v]) => a + v, 0);
    ctx.clearRect(0, 0, w, h);
    if (!total) { ctx.fillStyle = cssVar("--text-faint"); ctx.font = "13px Inter"; ctx.textAlign = "center"; ctx.fillText("Complete tasks to see time usage", w / 2, h / 2); return; }
    const colors = [cssVar("--green"), cssVar("--blue"), cssVar("--orange"), cssVar("--purple"), cssVar("--red")];
    let x = 0; const bh = 26, y = 18;
    entries.forEach(([k, v], i) => {
      const bw = (v / total) * w;
      ctx.fillStyle = colors[i % colors.length];
      roundRect(ctx, x, y, Math.max(0, bw - 2), bh, 6); ctx.fill();
      x += bw;
    });
    // legend
    let lx = 0, ly = y + bh + 22;
    ctx.textAlign = "left"; ctx.font = "12px Inter";
    entries.forEach(([k, v], i) => {
      ctx.fillStyle = colors[i % colors.length];
      roundRect(ctx, lx, ly - 9, 10, 10, 3); ctx.fill();
      ctx.fillStyle = cssVar("--text-dim");
      const txt = `${k} ${v}m`; ctx.fillText(txt, lx + 16, ly);
      lx += ctx.measureText(txt).width + 32;
      if (lx > w - 80) { lx = 0; ly += 20; }
    });
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); if (w < 0) w = 0;
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* ---------- placeholder views (defined in part 6) ---------- */

  /* =======================================================================
     6. TASK ACTIONS
     ======================================================================= */
  function completeTask(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t || t.done) return;
    t.done = true; t.completedAt = Date.now();
    state.dailyDone[todayKey()] = (state.dailyDone[todayKey()] || 0) + 1;
    addXP(Math.round(frogScore(t) * 3) + 5, "Frog eaten!");
    confetti();
    save(); renderCurrent();
  }
  function uncompleteTask(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return; t.done = false; t.completedAt = null; save(); renderCurrent();
  }
  function deleteTask(id) { state.tasks = state.tasks.filter((t) => t.id !== id); save(); renderCurrent(); toast("Task deleted"); }

  function taskModal(existing) {
    const t = existing || {};
    modal(existing ? "Edit Frog" : "New Frog", "Define the task. Importance + consequence drive its priority.", `
      <div class="field"><label>Task title</label><input id="f_title" value="${escapeHtml(t.title || "")}" placeholder="e.g. Finish the board presentation" /></div>
      <div class="field"><label>Description</label><textarea id="f_desc" placeholder="What does done look like?">${escapeHtml(t.desc || "")}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Category</label><input id="f_cat" value="${escapeHtml(t.category || "Work")}" /></div>
        <div class="field"><label>Deadline</label><input type="date" id="f_deadline" value="${t.deadline || ""}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Importance <b id="lbl_imp">${t.importance ?? 5}</b>/10</label><input type="range" min="1" max="10" id="f_imp" value="${t.importance ?? 5}" /></div>
        <div class="field"><label>Consequence <b id="lbl_con">${t.consequence ?? 5}</b>/10</label><input type="range" min="1" max="10" id="f_con" value="${t.consequence ?? 5}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Difficulty <b id="lbl_dif">${t.difficulty ?? 5}</b>/10</label><input type="range" min="1" max="10" id="f_dif" value="${t.difficulty ?? 5}" /></div>
        <div class="field"><label>Estimate (min)</label><input type="number" id="f_est" value="${t.estimate ?? 30}" min="5" step="5" /></div>
      </div>
      <div class="field"><label>Priority (auto if blank)</label>
        <select id="f_prio">
          <option value="">Auto-classify (ABCDE)</option>
          <option value="A" ${t.priority === "A" ? "selected" : ""}>A — Must do, serious consequences</option>
          <option value="B" ${t.priority === "B" ? "selected" : ""}>B — Should do, mild consequences</option>
          <option value="C" ${t.priority === "C" ? "selected" : ""}>C — Nice to do, no consequences</option>
          <option value="D" ${t.priority === "D" ? "selected" : ""}>D — Delegate</option>
          <option value="E" ${t.priority === "E" ? "selected" : ""}>E — Eliminate</option>
        </select>
      </div>
    `, `<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" id="f_save">${existing ? "Save" : "Add Frog"}</button>`);

    ["imp", "con", "dif"].forEach((k) => {
      const map = { imp: "f_imp", con: "f_con", dif: "f_dif" }, lmap = { imp: "lbl_imp", con: "lbl_con", dif: "lbl_dif" };
      $("#" + map[k]).addEventListener("input", (e) => { $("#" + lmap[k]).textContent = e.target.value; });
    });
    $("#f_save").addEventListener("click", () => {
      const title = $("#f_title").value.trim();
      if (!title) { toast("Please enter a title", "warn"); return; }
      const data = {
        title, desc: $("#f_desc").value.trim(), category: $("#f_cat").value.trim() || "General",
        deadline: $("#f_deadline").value, importance: +$("#f_imp").value, consequence: +$("#f_con").value,
        difficulty: +$("#f_dif").value, estimate: +$("#f_est").value || 30, priority: $("#f_prio").value,
      };
      if (existing) { Object.assign(existing, data); toast("Frog updated", "success"); }
      else { const nt = task(title, data); nt.priority = data.priority; state.tasks.push(nt); toast("Frog added 🐸", "success"); }
      save(); closeModal(); renderCurrent();
    });
  }

  /* ---------- FROG ENGINE ---------- */
  let taskFilter = "all";
  VIEWS.frogs = function () {
    const el = $("#view-frogs");
    const frog = biggestFrog();
    el.innerHTML = `
      <div class="page-head">
        <div><h1>Frog Priority Engine</h1><p>Every task is auto-scored by importance, consequence, difficulty and urgency. Drag to re-rank, then eat the biggest frog first.</p></div>
        <div class="page-head__actions"><button class="btn btn--primary" id="addFrog"><span>＋</span> New Frog</button></div>
      </div>
      ${frog ? `<div class="frog-banner"><span class="big">🐸</span><div style="flex:1"><small class="muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700;font-size:11px">Biggest / ugliest frog</small><h3>${escapeHtml(frog.title)}</h3><p>Score ${frogScore(frog)} · ${relativeDeadline(frog.deadline).label}</p></div><button class="btn btn--primary" data-eat="${frog.id}">Eat it now</button></div>` : ""}
      <div class="toolbar">
        ${["all", "A", "B", "C", "D", "E", "done"].map((f) => `<button class="chip ${taskFilter === f ? "is-active" : ""}" data-filter="${f}">${f === "all" ? "All" : f === "done" ? "Completed" : "Priority " + f}</button>`).join("")}
        <div class="spacer"></div>
        <span class="muted text-sm">${state.tasks.filter((t) => !t.done).length} open · ${state.tasks.filter((t) => t.done).length} done</span>
      </div>
      <div class="task-list" id="frogList"></div>
    `;
    $("#addFrog").addEventListener("click", () => taskModal());
    $$("#view-frogs [data-filter]").forEach((b) => b.addEventListener("click", () => { taskFilter = b.dataset.filter; VIEWS.frogs(); }));
    const fb = el.querySelector(".frog-banner [data-eat]"); if (fb) fb.addEventListener("click", () => completeTask(fb.dataset.eat));
    renderFrogList();
  };
  function renderFrogList() {
    const list = $("#frogList"); if (!list) return;
    let tasks;
    if (taskFilter === "done") tasks = state.tasks.filter((t) => t.done).sort((a, b) => b.completedAt - a.completedAt);
    else if (taskFilter === "all") tasks = sortedTasks();
    else tasks = sortedTasks().filter((t) => autoPriority(t) === taskFilter);
    if (!tasks.length) { list.innerHTML = `<div class="empty"><div class="big">🐸</div><h3>No frogs here</h3><p>Add a task to get started.</p></div>`; return; }
    list.innerHTML = tasks.map(taskRow).join("");
    wireTaskRows(list);
    if (taskFilter === "all") enableDragSort(list);
  }
  function taskRow(t) {
    const p = autoPriority(t), dl = relativeDeadline(t.deadline), sc = frogScore(t);
    const isFrog = !t.done && biggestFrog() && biggestFrog().id === t.id;
    return `<div class="task task--${p} ${t.done ? "is-done" : ""}" draggable="${taskFilter === "all" && !t.done}" data-id="${t.id}">
      <button class="task__check ${t.done ? "checked" : ""}" data-toggle="${t.id}" aria-label="Toggle complete">${t.done ? "✓" : ""}</button>
      <div class="task__body">
        <div class="task__title">${escapeHtml(t.title)} <span class="tag tag--prio tag--${p}">${p}</span> ${isFrog ? `<span class="tag tag--frog">🐸 Frog</span>` : ""}</div>
        ${t.desc ? `<div class="task__desc">${escapeHtml(t.desc)}</div>` : ""}
        <div class="task__meta">
          <span class="tag">${escapeHtml(t.category)}</span>
          <span class="tag ${dl.urgent ? "tag--A tag--prio" : ""}">${dl.label}</span>
          <span class="tag">⏱ ${t.estimate}m</span>
          <span class="tag">⚠ C${t.consequence}</span>
        </div>
      </div>
      <div class="task__score"><b>${sc}</b><small>frog</small></div>
      <div class="task__actions">
        <button class="icon-btn btn--sm" data-edit="${t.id}" aria-label="Edit" title="Edit">✎</button>
        <button class="icon-btn btn--sm" data-del="${t.id}" aria-label="Delete" title="Delete">🗑</button>
      </div>
    </div>`;
  }
  function wireTaskRows(root) {
    $$("[data-toggle]", root).forEach((b) => b.addEventListener("click", () => {
      const t = state.tasks.find((x) => x.id === b.dataset.toggle);
      if (t.done) uncompleteTask(t.id); else completeTask(t.id);
    }));
    $$("[data-edit]", root).forEach((b) => b.addEventListener("click", () => taskModal(state.tasks.find((x) => x.id === b.dataset.edit))));
    $$("[data-del]", root).forEach((b) => b.addEventListener("click", () => {
      confirmModal("Delete this task?", "This cannot be undone.", () => deleteTask(b.dataset.del));
    }));
  }
  function enableDragSort(list) {
    let dragEl = null;
    $$(".task[draggable='true']", list).forEach((row) => {
      row.addEventListener("dragstart", () => { dragEl = row; row.classList.add("dragging"); });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        $$(".task", list).forEach((r) => r.classList.remove("drop-target"));
        // persist new order
        $$(".task", list).forEach((r, i) => { const t = state.tasks.find((x) => x.id === r.dataset.id); if (t) t.order = i; });
        save();
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
        $$(".task", list).forEach((r) => r.classList.remove("drop-target"));
        row.classList.add("drop-target");
        if (dragEl && dragEl !== row) {
          if (after) row.after(dragEl); else row.before(dragEl);
        }
      });
    });
  }

  function confirmModal(title, sub, onYes, yesLabel = "Delete", danger = true) {
    modal(title, sub, "", `<button class="btn btn--ghost" data-close>Cancel</button><button class="btn ${danger ? "btn--danger" : "btn--primary"}" id="cf_yes">${yesLabel}</button>`);
    $("#cf_yes").addEventListener("click", () => { closeModal(); onYes(); });
  }

  /* the remaining views are appended in section 7 */

  /* =======================================================================
     8. INIT (wired after all views defined — see bottom)
     ======================================================================= */
  function init() {
    // theme
    applyTheme(state.profile.theme || "dark");

    // nav events
    $$(".nav__item, .bottomnav__item").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
    $("#menuBtn").addEventListener("click", openMobileNav);
    $("#sidebarClose").addEventListener("click", closeMobileNav);
    $("#scrim").addEventListener("click", closeMobileNav);
    $("#themeToggle").addEventListener("click", toggleTheme);
    $("#quickAdd").addEventListener("click", () => taskModal());
    $("#fab").addEventListener("click", () => quickAddRouter());
    $("#reviewBtn").addEventListener("click", () => dailyReviewModal());

    // search
    setupSearch();

    // hash route
    const start = (location.hash || "#dashboard").slice(1);
    go(VIEWS[start] ? start : "dashboard");
    window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (v && v !== currentView) go(v); });

    updateLevelCard();
    checkDailyRollover();

    // register SW
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch((e) => console.log("[v0] sw fail", e.message));
    }
  }

  function quickAddRouter() {
    const v = currentView;
    if (v === "goals") return goalModal();
    if (v === "habits") return habitModal();
    return taskModal();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    $("#themeToggle").textContent = theme === "dark" ? "🌙" : "☀️";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#0b0f14" : "#f4f6f9";
    state.profile.theme = theme;
  }
  function toggleTheme() {
    applyTheme(state.profile.theme === "dark" ? "light" : "dark");
    save(); renderCurrent();
  }

  function openMobileNav() { $("#app").classList.add("nav-open"); }
  function closeMobileNav() { $("#app").classList.remove("nav-open"); }

  function checkDailyRollover() {
    // nothing destructive; could surface review prompt
    const last = state.lastVisit;
    if (last && last !== todayKey()) {
      setTimeout(() => toast("New day — time to eat your frog 🐸", "success"), 800);
    }
  }

  /* ---------- SEARCH ---------- */
  function setupSearch() {
    const input = $("#globalSearch"), box = $("#searchResults");
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { box.hidden = true; return; }
      const results = [];
      state.tasks.forEach((t) => { if (t.title.toLowerCase().includes(q)) results.push({ ico: "🐸", label: t.title, sub: "Task · " + t.category, view: "frogs" }); });
      state.goals.forEach((g) => { if (g.title.toLowerCase().includes(q)) results.push({ ico: "🎯", label: g.title, sub: "Goal", view: "goals" }); });
      state.habits.forEach((h) => { if (h.name.toLowerCase().includes(q)) results.push({ ico: "🔥", label: h.name, sub: "Habit", view: "habits" }); });
      box.hidden = false;
      box.innerHTML = results.length ? results.slice(0, 8).map((r) => `<div class="sr-item" data-view="${r.view}"><span>${r.ico}</span><div>${escapeHtml(r.label)}<br><small>${r.sub}</small></div></div>`).join("") : `<div class="sr-empty">No matches found</div>`;
      $$(".sr-item", box).forEach((it) => it.addEventListener("click", () => { box.hidden = true; input.value = ""; go(it.dataset.view); }));
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".search")) box.hidden = true; });
  }

  /* =======================================================================
     7. REMAINING VIEWS
     ======================================================================= */

  /* ---------- ABCDE METHOD ---------- */
  const ABCDE_META = {
    A: { label: "Must Do", desc: "Serious consequences if not done", color: "var(--red)" },
    B: { label: "Should Do", desc: "Mild consequences", color: "var(--orange)" },
    C: { label: "Nice to Do", desc: "No consequences", color: "var(--blue)" },
    D: { label: "Delegate", desc: "Someone else can do it", color: "var(--purple)" },
    E: { label: "Eliminate", desc: "Stop doing this entirely", color: "var(--text-faint)" },
  };
  VIEWS.abcde = function () {
    const el = $("#view-abcde");
    const open = state.tasks.filter((t) => !t.done);
    const aTasks = open.filter((t) => autoPriority(t) === "A").sort((a, b) => frogScore(b) - frogScore(a));
    const eatFirst = aTasks[0];
    el.innerHTML = `
      <div class="page-head">
        <div><h1>ABCDE Method</h1><p>Drag tasks between columns to classify them. A = serious consequences, E = eliminate. Always work on A before B, B before C.</p></div>
      </div>
      ${eatFirst ? `<div class="frog-banner"><span class="big">👑</span><div style="flex:1"><small class="muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700;font-size:11px">Eat First — your A1 task</small><h3>${escapeHtml(eatFirst.title)}</h3><p>Highest-consequence task. Do this before anything else today.</p></div><button class="btn btn--primary" data-eat="${eatFirst.id}">Eat A1</button></div>` : ""}
      <div class="card mb-16"><div class="insight" style="margin:0"><span class="insight__ico">🤖</span><div><b>Smart suggestion</b><p id="abcdeTip"></p></div></div></div>
      <div class="abcde-grid" id="abcdeGrid">
        ${["A", "B", "C", "D", "E"].map((p) => {
          const items = open.filter((t) => autoPriority(t) === p).sort((a, b) => frogScore(b) - frogScore(a));
          return `<div class="abcde-col" data-col="${p}">
            <div class="abcde-col__head">
              <div class="flex center gap-8"><span class="abcde-col__badge ${p}">${p}</span><div><strong>${ABCDE_META[p].label}</strong><div class="abcde-col__desc">${ABCDE_META[p].desc}</div></div></div>
              <span class="muted text-sm">${items.length}</span>
            </div>
            ${items.map((t, i) => `<div class="mini-task" draggable="true" data-id="${t.id}">${p === "A" ? `A${i + 1} · ` : ""}${escapeHtml(t.title)}<small>⭐ ${frogScore(t)} · ⏱ ${t.estimate}m</small></div>`).join("") || `<div class="muted text-xs" style="padding:8px;text-align:center">Drop tasks here</div>`}
          </div>`;
        }).join("")}
      </div>
    `;
    const tip = eatFirst
      ? `Start with "<b>${escapeHtml(eatFirst.title)}</b>" — it has the highest consequence score. ${aTasks.length > 1 ? `Then move to A2: "${escapeHtml(aTasks[1].title)}".` : ""}`
      : open.length ? "No A-tasks yet. Promote your most consequential task to column A." : "Add tasks to see your daily execution order.";
    $("#abcdeTip").innerHTML = tip;
    const eb = el.querySelector(".frog-banner [data-eat]"); if (eb) eb.addEventListener("click", () => completeTask(eb.dataset.eat));
    enableAbcdeDrag();
  };
  function enableAbcdeDrag() {
    let drag = null;
    $$("#abcdeGrid .mini-task").forEach((m) => {
      m.addEventListener("dragstart", () => { drag = m; m.classList.add("dragging"); });
      m.addEventListener("dragend", () => { m.classList.remove("dragging"); drag = null; });
    });
    $$("#abcdeGrid .abcde-col").forEach((col) => {
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop-target"); });
      col.addEventListener("dragleave", () => col.classList.remove("drop-target"));
      col.addEventListener("drop", (e) => {
        e.preventDefault(); col.classList.remove("drop-target");
        if (!drag) return;
        const t = state.tasks.find((x) => x.id === drag.dataset.id);
        if (t) { t.priority = col.dataset.col; save(); VIEWS.abcde(); toast(`Moved to ${col.dataset.col}`, "success"); }
      });
    });
  }

  /* ---------- 80/20 ANALYZER ---------- */
  VIEWS.pareto = function () {
    const el = $("#view-pareto");
    const all = state.tasks.slice().sort((a, b) => (b.importance + b.consequence) - (a.importance + a.consequence));
    const vitalCount = Math.max(1, Math.ceil(all.length * 0.2));
    const vital = all.slice(0, vitalCount);
    const trivial = all.slice(vitalCount);
    const totalValue = all.reduce((a, t) => a + t.importance + t.consequence, 0) || 1;
    const vitalValue = vital.reduce((a, t) => a + t.importance + t.consequence, 0);
    const vitalPct = Math.round((vitalValue / totalValue) * 100);
    el.innerHTML = `
      <div class="page-head"><div><h1>80/20 Analyzer</h1><p>The Pareto Principle: roughly 20% of your tasks produce 80% of your results. Focus relentlessly on the vital few.</p></div></div>
      <div class="grid grid--3 mb-16">
        ${statCard("⚡", "green", vitalCount, "Vital Few (top 20%)")}
        ${statCard("📊", "blue", vitalPct + "%", "Of Total Value", false)}
        ${statCard("🗑", "orange", trivial.length, "Trivial Many")}
      </div>
      <div class="card mb-16">
        <div class="card__title mb-12">🎯 Your vital few — do these first</div>
        <div class="task-list">${vital.map((t) => `<div class="task task--${autoPriority(t)} ${t.done ? "is-done" : ""}"><div class="task__body"><div class="task__title">${escapeHtml(t.title)} <span class="tag tag--frog">High impact</span></div><div class="task__meta"><span class="tag">Impact ${t.importance + t.consequence}/20</span><span class="tag">${escapeHtml(t.category)}</span></div></div>${!t.done ? `<button class="btn btn--sm btn--primary" data-eat="${t.id}">Do</button>` : `<span class="tag tag--frog">✓ done</span>`}</div>`).join("") || `<p class="muted">Add tasks to analyze.</p>`}</div>
      </div>
      <div class="card mb-16">
        <div class="card__title mb-12">💡 Performance insights</div>
        <div class="insight"><span class="insight__ico">⚡</span><div><b>Concentrate your energy</b><p>Completing your ${vitalCount} vital task(s) delivers ~${vitalPct}% of your potential results. Eat these frogs before touching the trivial many.</p></div></div>
        <div class="insight"><span class="insight__ico">🗑</span><div><b>Eliminate or delegate</b><p>You have ${trivial.length} low-impact task(s). Consider deleting, delegating, or batching them at the end of the day.</p></div></div>
        ${trivial.length > vital.length * 3 ? `<div class="insight"><span class="insight__ico">⚠️</span><div><b>Too much busywork</b><p>Your trivial tasks heavily outnumber your vital ones. Be ruthless about saying no.</p></div></div>` : ""}
      </div>
    `;
    $$("#view-pareto [data-eat]").forEach((b) => b.addEventListener("click", () => completeTask(b.dataset.eat)));
  };

  /* ---------- GOALS ---------- */
  const GOAL_TYPES = { long: ["Long-term", "var(--purple)"], monthly: ["Monthly", "var(--blue)"], weekly: ["Weekly", "var(--green)"], short: ["Short-term", "var(--orange)"], daily: ["Daily", "var(--red)"] };
  VIEWS.goals = function () {
    const el = $("#view-goals");
    el.innerHTML = `
      <div class="page-head"><div><h1>Goal Management</h1><p>Track long-term vision down to daily goals. Break each into milestones and watch your progress climb.</p></div>
      <div class="page-head__actions"><button class="btn btn--primary" id="addGoal"><span>＋</span> New Goal</button></div></div>
      <div class="grid grid--2" id="goalGrid"></div>`;
    $("#addGoal").addEventListener("click", () => goalModal());
    const grid = $("#goalGrid");
    if (!state.goals.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">🎯</div><h3>No goals yet</h3><p>Define what you're working toward.</p></div>`; return; }
    grid.innerHTML = state.goals.map((g) => {
      const prog = goalProgress(g), tp = GOAL_TYPES[g.type] || GOAL_TYPES.short, dl = relativeDeadline(g.deadline);
      return `<div class="card goal card--hover" data-id="${g.id}">
        <div class="goal__head">
          <div><span class="goal__cat" style="background:${tp[1]}22;color:${tp[1]}">${tp[0]}</span><h3 style="margin-top:8px">${escapeHtml(g.title)}</h3></div>
          <div class="task__actions"><button class="icon-btn btn--sm" data-gedit="${g.id}">✎</button><button class="icon-btn btn--sm" data-gdel="${g.id}">🗑</button></div>
        </div>
        <div class="flex between center mt-12 text-sm"><span class="muted">${dl.label}</span><b>${prog}%</b></div>
        <div class="progress mt-8"><div class="progress__bar ${prog >= 100 ? "" : "blue"}" style="width:${prog}%"></div></div>
        <div class="mt-12">${g.milestones.map((m) => `<div class="milestone ${m.done ? "done" : ""}"><span class="dot" data-ms="${g.id}:${m.id}"></span>${escapeHtml(m.text)}</div>`).join("") || `<span class="muted text-sm">No milestones</span>`}</div>
        ${g.notes ? `<p class="muted text-sm mt-8">${escapeHtml(g.notes)}</p>` : ""}
        <div class="flex between center mt-12"><span class="muted text-xs">Motivation ${g.motivation}/10</span>${prog >= 100 ? `<span class="tag tag--frog">🏆 Achieved</span>` : ""}</div>
      </div>`;
    }).join("");
    $$("[data-ms]", grid).forEach((d) => d.addEventListener("click", () => {
      const [gid, mid] = d.dataset.ms.split(":");
      const g = state.goals.find((x) => x.id === gid), m = g.milestones.find((x) => x.id === mid);
      m.done = !m.done;
      if (goalProgress(g) >= 100) { confetti(); addXP(50, "Goal achieved! 🏆"); }
      save(); VIEWS.goals();
    }));
    $$("[data-gedit]", grid).forEach((b) => b.addEventListener("click", () => goalModal(state.goals.find((x) => x.id === b.dataset.gedit))));
    $$("[data-gdel]", grid).forEach((b) => b.addEventListener("click", () => confirmModal("Delete goal?", "", () => { state.goals = state.goals.filter((x) => x.id !== b.dataset.gdel); save(); VIEWS.goals(); })));
  };
  function goalModal(existing) {
    const g = existing || {};
    const msList = (g.milestones || []).map((m) => `<div class="flex gap-8 center mb-12"><input class="ms-in" data-id="${m.id}" value="${escapeHtml(m.text)}" style="flex:1" /><button class="icon-btn btn--sm" data-msdel="${m.id}">🗑</button></div>`).join("");
    modal(existing ? "Edit Goal" : "New Goal", "Define a goal and break it into milestones.", `
      <div class="field"><label>Goal title</label><input id="g_title" value="${escapeHtml(g.title || "")}" placeholder="e.g. Launch my side business" /></div>
      <div class="field-row">
        <div class="field"><label>Type</label><select id="g_type">${Object.entries(GOAL_TYPES).map(([k, v]) => `<option value="${k}" ${g.type === k ? "selected" : ""}>${v[0]}</option>`).join("")}</select></div>
        <div class="field"><label>Target date</label><input type="date" id="g_deadline" value="${g.deadline || ""}" /></div>
      </div>
      <div class="field"><label>Motivation <b id="g_mlbl">${g.motivation ?? 7}</b>/10</label><input type="range" min="1" max="10" id="g_mot" value="${g.motivation ?? 7}" /></div>
      <div class="field"><label>Notes</label><textarea id="g_notes">${escapeHtml(g.notes || "")}</textarea></div>
      <div class="field"><label>Milestones</label><div id="g_ms">${msList}</div><button class="btn btn--sm mt-8" id="g_addms"><span>＋</span> Add milestone</button></div>
    `, `<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" id="g_save">${existing ? "Save" : "Create Goal"}</button>`);
    $("#g_mot").addEventListener("input", (e) => $("#g_mlbl").textContent = e.target.value);
    $("#g_addms").addEventListener("click", () => {
      const div = document.createElement("div"); div.className = "flex gap-8 center mb-12";
      const id = uid();
      div.innerHTML = `<input class="ms-in" data-id="${id}" placeholder="Milestone" style="flex:1" /><button class="icon-btn btn--sm" data-msdel="${id}">🗑</button>`;
      $("#g_ms").appendChild(div);
      div.querySelector("[data-msdel]").addEventListener("click", () => div.remove());
    });
    $$("#g_ms [data-msdel]").forEach((b) => b.addEventListener("click", (e) => e.target.closest(".flex").remove()));
    $("#g_save").addEventListener("click", () => {
      const title = $("#g_title").value.trim(); if (!title) { toast("Enter a title", "warn"); return; }
      const ms = $$("#g_ms .ms-in").filter((i) => i.value.trim()).map((i) => {
        const ex = (g.milestones || []).find((m) => m.id === i.dataset.id);
        return { id: i.dataset.id, text: i.value.trim(), done: ex ? ex.done : false };
      });
      const data = { title, type: $("#g_type").value, deadline: $("#g_deadline").value, motivation: +$("#g_mot").value, notes: $("#g_notes").value.trim(), milestones: ms };
      if (existing) Object.assign(existing, data); else state.goals.push(Object.assign(goal(title), data));
      save(); closeModal(); VIEWS.goals(); toast(existing ? "Goal updated" : "Goal created 🎯", "success");
    });
  }

  /* ---------- DAILY PLANNER ---------- */
  let plannerDate = todayKey();
  VIEWS.planner = function () {
    const el = $("#view-planner");
    const day = state.planner[plannerDate] || {};
    const hours = []; for (let h = 6; h <= 22; h++) hours.push(h);
    el.innerHTML = `
      <div class="page-head"><div><h1>Daily Planner</h1><p>Plan every day in advance. Assign time blocks to your frogs — every minute planned saves ten in execution.</p></div>
      <div class="page-head__actions"><input type="date" id="plDate" value="${plannerDate}" class="btn" style="padding:8px 12px" /><button class="btn" id="plClear">Clear day</button></div></div>
      <div class="grid grid--2">
        <div class="card">
          <div class="card__title mb-12">🗓️ Hourly schedule</div>
          <div class="planner-grid">
            ${hours.map((h) => {
              const slot = day[h];
              return `<div class="hour-label">${h}:00</div><div class="hour-slot" data-hour="${h}">${slot ? `<div class="block" style="background:${slot.color}">${escapeHtml(slot.title)}</div>` : ""}</div>`;
            }).join("")}
          </div>
        </div>
        <div>
          <div class="card mb-16"><div class="card__title mb-12">📋 Unscheduled frogs</div><div class="task-list" id="plTasks"></div></div>
          <div class="card"><div class="card__title mb-12">📅 This week</div><div id="plWeek"></div></div>
        </div>
      </div>`;
    $("#plDate").addEventListener("change", (e) => { plannerDate = e.target.value; VIEWS.planner(); });
    $("#plClear").addEventListener("click", () => confirmModal("Clear this day's schedule?", "", () => { delete state.planner[plannerDate]; save(); VIEWS.planner(); }));
    $$("#view-planner .hour-slot").forEach((s) => s.addEventListener("click", () => plannerSlotModal(+s.dataset.hour)));
    const open = sortedTasks().slice(0, 6);
    $("#plTasks").innerHTML = open.length ? open.map((t) => `<div class="task task--${autoPriority(t)}" style="padding:10px 12px"><div class="task__body"><div class="task__title" style="font-size:14px">${escapeHtml(t.title)}</div><div class="task__meta"><span class="tag">⏱ ${t.estimate}m</span></div></div><button class="btn btn--sm" data-sched="${t.id}">Schedule</button></div>`).join("") : `<p class="muted text-sm">No open tasks.</p>`;
    $$("#plTasks [data-sched]").forEach((b) => b.addEventListener("click", () => plannerSlotModal(null, state.tasks.find((x) => x.id === b.dataset.sched))));
    // week overview
    const weekHtml = [];
    for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() + i); const k = todayKey(d); const cnt = Object.keys(state.planner[k] || {}).length; weekHtml.push(`<div class="flex between center" style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="text-sm">${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span><span class="tag">${cnt} block${cnt !== 1 ? "s" : ""}</span></div>`); }
    $("#plWeek").innerHTML = weekHtml.join("");
  };
  function plannerSlotModal(hour, presetTask) {
    const colors = { Work: "var(--blue)", Focus: "var(--green)", Personal: "var(--purple)", Break: "var(--orange)", Other: "var(--red)" };
    modal("Schedule block", presetTask ? `Scheduling: ${presetTask.title}` : `Plan your ${hour}:00 slot`, `
      <div class="field"><label>What</label><input id="pl_title" value="${presetTask ? escapeHtml(presetTask.title) : ""}" placeholder="e.g. Deep work on report" /></div>
      <div class="field-row">
        <div class="field"><label>Hour</label><select id="pl_hour">${Array.from({ length: 17 }, (_, i) => i + 6).map((h) => `<option value="${h}" ${hour === h ? "selected" : ""}>${h}:00</option>`).join("")}</select></div>
        <div class="field"><label>Type</label><select id="pl_color">${Object.entries(colors).map(([k, v]) => `<option value="${v}">${k}</option>`).join("")}</select></div>
      </div>`, `<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" id="pl_save">Add block</button>`);
    $("#pl_save").addEventListener("click", () => {
      const title = $("#pl_title").value.trim(); if (!title) { toast("Enter a title", "warn"); return; }
      const h = $("#pl_hour").value;
      state.planner[plannerDate] = state.planner[plannerDate] || {};
      state.planner[plannerDate][h] = { title, color: $("#pl_color").value };
      save(); closeModal(); VIEWS.planner(); toast("Block scheduled", "success");
    });
  }

  /* ---------- FOCUS MODE (Pomodoro) ---------- */
  let focusTimer = { remaining: 0, total: 0, running: false, interval: null, type: "focus" };
  let audioCtx = null, noiseNode = null;
  VIEWS.focus = function () {
    const el = $("#view-focus");
    const s = state.settings;
    if (!focusTimer.total) { focusTimer.remaining = s.pomodoro * 60; focusTimer.total = s.pomodoro * 60; }
    const todayFocus = state.focusSessions.filter((f) => f.date === todayKey());
    const totalMin = todayFocus.reduce((a, b) => a + b.minutes, 0);
    const streak = focusStreak();
    el.innerHTML = `
      <div class="page-head"><div><h1>Focus Mode</h1><p>Deep work with the Pomodoro technique. Eliminate distractions and create large chunks of uninterrupted time.</p></div></div>
      <div class="grid grid--3 mb-16">
        ${statCard("🎧", "green", totalMin + "m", "Focused Today")}
        ${statCard("✅", "blue", todayFocus.filter((f) => f.type === "focus").length, "Sessions Today")}
        ${statCard("🔥", "orange", streak + "d", "Focus Streak")}
      </div>
      <div class="card focus-stage">
        <div class="flex gap-8">
          ${["focus", "shortBreak", "longBreak"].map((t) => `<button class="chip ${focusTimer.type === t ? "is-active" : ""}" data-ftype="${t}">${t === "focus" ? "Focus " + s.pomodoro + "m" : t === "shortBreak" ? "Short " + s.shortBreak + "m" : "Long " + s.longBreak + "m"}</button>`).join("")}
        </div>
        <div class="timer-ring">
          <svg viewBox="0 0 200 200">
            <circle class="ring__bg" cx="100" cy="100" r="90" stroke-width="10"></circle>
            <circle class="ring__fg" id="focusRing" cx="100" cy="100" r="90" stroke-width="10" stroke="var(--green)" stroke-dasharray="${2 * Math.PI * 90}" stroke-dashoffset="0"></circle>
          </svg>
          <div class="timer-ring__time"><b id="focusTime">${fmtTime(focusTimer.remaining)}</b><small id="focusLabel">${focusTimer.type === "focus" ? "Focus" : "Break"}</small></div>
        </div>
        <div class="focus-controls">
          <button class="btn btn--primary" id="focusStart">${focusTimer.running ? "Pause" : "Start"}</button>
          <button class="btn" id="focusReset">Reset</button>
          <button class="btn" id="focusFull">⛶ Fullscreen</button>
        </div>
        <div>
          <div class="muted text-sm mb-12">Ambient sound</div>
          <div class="sound-toggle">
            ${[["off", "🔇 Off"], ["brown", "🌧 Rain"], ["white", "💨 White"], ["pink", "🌊 Waves"]].map(([k, l]) => `<button class="chip ${(!s.sound && k === "off") || (s.sound && s.soundType === k) ? "is-active" : ""}" data-sound="${k}">${l}</button>`).join("")}
          </div>
        </div>
      </div>`;
    $$("#view-focus [data-ftype]").forEach((b) => b.addEventListener("click", () => setFocusType(b.dataset.ftype)));
    $("#focusStart").addEventListener("click", toggleFocus);
    $("#focusReset").addEventListener("click", resetFocus);
    $("#focusFull").addEventListener("click", () => { document.body.classList.toggle("focusing"); });
    $$("#view-focus [data-sound]").forEach((b) => b.addEventListener("click", () => setSound(b.dataset.sound)));
    updateFocusRing();
  };
  function fmtTime(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, "0")}`; }
  function setFocusType(type) {
    focusTimer.type = type; focusTimer.running = false; clearInterval(focusTimer.interval);
    const map = { focus: state.settings.pomodoro, shortBreak: state.settings.shortBreak, longBreak: state.settings.longBreak };
    focusTimer.total = map[type] * 60; focusTimer.remaining = focusTimer.total;
    if (currentView === "focus") VIEWS.focus();
  }
  function toggleFocus() {
    if (focusTimer.running) {
      focusTimer.running = false; clearInterval(focusTimer.interval);
      $("#focusStart").textContent = "Start";
    } else {
      focusTimer.running = true; $("#focusStart").textContent = "Pause";
      if (state.settings.sound) startNoise(state.settings.soundType);
      focusTimer.interval = setInterval(tickFocus, 1000);
    }
  }
  function tickFocus() {
    focusTimer.remaining--;
    const t = $("#focusTime"); if (t) t.textContent = fmtTime(focusTimer.remaining);
    updateFocusRing();
    if (focusTimer.remaining <= 0) {
      clearInterval(focusTimer.interval); focusTimer.running = false; stopNoise();
      const mins = Math.round(focusTimer.total / 60);
      if (focusTimer.type === "focus") {
        state.focusSessions.push({ date: todayKey(), minutes: mins, type: "focus" });
        addXP(mins, "Focus session complete!"); confetti();
        toast("Focus session complete! Take a break 🎉", "success");
      } else { toast("Break over — back to work!", "success"); }
      save();
      beep();
      setFocusType(focusTimer.type);
    }
  }
  function resetFocus() { focusTimer.running = false; clearInterval(focusTimer.interval); stopNoise(); setFocusType(focusTimer.type); }
  function updateFocusRing() {
    const ring = $("#focusRing"); if (!ring) return;
    const c = 2 * Math.PI * 90, pct = focusTimer.remaining / focusTimer.total;
    ring.style.strokeDashoffset = c * (1 - pct);
    ring.setAttribute("stroke", focusTimer.type === "focus" ? "var(--green)" : "var(--blue)");
  }
  function ensureAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
  function startNoise(type) {
    stopNoise(); if (type === "off") return;
    const ctx = ensureAudio();
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      if (type === "brown") { data[i] = (last + 0.02 * white) / 1.02; last = data[i]; data[i] *= 3.5; }
      else if (type === "pink") { last = 0.95 * last + 0.05 * white; data[i] = last * 2.2; }
      else data[i] = white * 0.5;
    }
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const gain = ctx.createGain(); gain.gain.value = 0.18;
    src.connect(gain); gain.connect(ctx.destination); src.start(); noiseNode = src;
  }
  function stopNoise() { if (noiseNode) { try { noiseNode.stop(); } catch (e) {} noiseNode = null; } }
  function beep() {
    try { const ctx = ensureAudio(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 660; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.2, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6); o.start(); o.stop(ctx.currentTime + 0.6); } catch (e) {}
  }
  function setSound(type) {
    if (type === "off") { state.settings.sound = false; stopNoise(); }
    else { state.settings.sound = true; state.settings.soundType = type; if (focusTimer.running) startNoise(type); }
    save(); if (currentView === "focus") VIEWS.focus();
  }
  function focusStreak() {
    let streak = 0;
    for (let i = 0; i < 365; i++) { const k = daysAgoKey(i); const has = state.focusSessions.some((f) => f.date === k); if (has) streak++; else if (i === 0) continue; else break; }
    return streak;
  }

  /* ---------- HABITS ---------- */
  VIEWS.habits = function () {
    const el = $("#view-habits");
    el.innerHTML = `
      <div class="page-head"><div><h1>Habit Builder</h1><p>Build the daily disciplines of success. Tap the flame to check in — keep your streaks alive.</p></div>
      <div class="page-head__actions"><button class="btn btn--primary" id="addHabit"><span>＋</span> New Habit</button></div></div>
      <div class="grid grid--2" id="habitGrid"></div>`;
    $("#addHabit").addEventListener("click", () => habitModal());
    const grid = $("#habitGrid");
    if (!state.habits.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">🔥</div><h3>No habits yet</h3><p>Add a positive daily habit.</p></div>`; return; }
    grid.innerHTML = state.habits.map((h) => {
      const done = h.history.includes(todayKey()), st = habitStreak(h);
      const cal = []; for (let i = 29; i >= 0; i--) { const k = daysAgoKey(i); cal.push(`<span class="${h.history.includes(k) ? "on" : ""}" title="${k}"></span>`); }
      return `<div class="card habit card--hover">
        <button class="habit__flame ${done ? "lit" : ""}" data-check="${h.id}" aria-label="Check in">🔥</button>
        <div class="habit__body">
          <div class="flex between center"><strong>${h.ico} ${escapeHtml(h.name)}</strong><div class="task__actions"><button class="icon-btn btn--sm" data-hedit="${h.id}">✎</button><button class="icon-btn btn--sm" data-hdel="${h.id}">🗑</button></div></div>
          <div class="habit__streak">${st} day streak · ${h.history.length} total</div>
          <div class="habit-cal">${cal.join("")}</div>
        </div>
      </div>`;
    }).join("");
    $$("[data-check]", grid).forEach((b) => b.addEventListener("click", () => {
      const h = state.habits.find((x) => x.id === b.dataset.check); const k = todayKey();
      if (h.history.includes(k)) h.history = h.history.filter((d) => d !== k);
      else { h.history.push(k); addXP(10, "Habit checked!"); if (habitStreak(h) % 7 === 0) confetti(); }
      save(); VIEWS.habits();
    }));
    $$("[data-hedit]", grid).forEach((b) => b.addEventListener("click", () => habitModal(state.habits.find((x) => x.id === b.dataset.hedit))));
    $$("[data-hdel]", grid).forEach((b) => b.addEventListener("click", () => confirmModal("Delete habit?", "Streak history will be lost.", () => { state.habits = state.habits.filter((x) => x.id !== b.dataset.hdel); save(); VIEWS.habits(); })));
  };
  function habitModal(existing) {
    const h = existing || {};
    const icons = ["🐸", "💪", "📚", "🚫", "💧", "🧘", "🏃", "🥗", "😴", "✍️", "🎯", "🌅"];
    modal(existing ? "Edit Habit" : "New Habit", "Small daily disciplines compound into success.", `
      <div class="field"><label>Habit name</label><input id="h_name" value="${escapeHtml(h.name || "")}" placeholder="e.g. Exercise 30 minutes" /></div>
      <div class="field"><label>Icon</label><div class="flex wrap gap-8" id="h_icons">${icons.map((ic) => `<button class="chip ${h.ico === ic ? "is-active" : ""}" data-ic="${ic}" style="font-size:18px">${ic}</button>`).join("")}</div></div>
      <div class="field-row">
        <div class="field"><label>Category</label><input id="h_cat" value="${escapeHtml(h.category || "Health")}" /></div>
        <div class="field"><label>Difficulty</label><select id="h_diff"><option ${h.difficulty === "easy" ? "selected" : ""}>easy</option><option ${h.difficulty === "medium" || !h.difficulty ? "selected" : ""}>medium</option><option ${h.difficulty === "hard" ? "selected" : ""}>hard</option></select></div>
      </div>
    `, `<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" id="h_save">${existing ? "Save" : "Add Habit"}</button>`);
    let chosen = h.ico || "✅";
    $$("#h_icons [data-ic]").forEach((b) => b.addEventListener("click", () => { chosen = b.dataset.ic; $$("#h_icons .chip").forEach((c) => c.classList.remove("is-active")); b.classList.add("is-active"); }));
    $("#h_save").addEventListener("click", () => {
      const name = $("#h_name").value.trim(); if (!name) { toast("Enter a name", "warn"); return; }
      const data = { name, ico: chosen, category: $("#h_cat").value.trim(), difficulty: $("#h_diff").value };
      if (existing) Object.assign(existing, data); else state.habits.push(Object.assign(habit(name, chosen), data));
      save(); closeModal(); VIEWS.habits(); toast(existing ? "Habit updated" : "Habit added 🔥", "success");
    });
  }

  /* ---------- ANALYTICS ---------- */
  VIEWS.analytics = function () {
    const el = $("#view-analytics");
    const done = state.tasks.filter((t) => t.done);
    const overdue = state.tasks.filter((t) => !t.done && relativeDeadline(t.deadline).over);
    const procrastinated = state.tasks.filter((t) => !t.done).sort((a, b) => a.created - b.created)[0];
    const bestHour = bestProductivityHour();
    el.innerHTML = `
      <div class="page-head"><div><h1>Productivity Analytics</h1><p>Measure what matters. Track completion, focus, and consistency to find your best working patterns.</p></div></div>
      <div class="grid grid--stats mb-16">
        ${statCard("✅", "green", done.length, "Total Completed")}
        ${statCard("🎧", "blue", state.focusSessions.reduce((a, b) => a + b.minutes, 0) + "m", "Total Focus")}
        ${statCard("⚠️", "orange", overdue.length, "Overdue Frogs")}
        ${statCard("📈", "purple", productivityScore(), "Productivity Score", true)}
      </div>
      <div class="bento">
        <div class="card col-2"><div class="card__title mb-12">📊 Completions (14 days)</div><canvas id="aChart1" height="200"></canvas></div>
        <div class="card col-2"><div class="card__title mb-12">🎧 Focus minutes (14 days)</div><canvas id="aChart2" height="200"></canvas></div>
        <div class="card col-2">
          <div class="card__title mb-12">🟩 Activity heatmap (12 weeks)</div>
          <div class="heatmap" id="aHeat"></div>
        </div>
        <div class="card col-2">
          <div class="card__title mb-12">💡 Insights</div>
          <div class="insight"><span class="insight__ico">⏰</span><div><b>Best productivity window</b><p>${bestHour}</p></div></div>
          <div class="insight"><span class="insight__ico">🐌</span><div><b>Most procrastinated</b><p>${procrastinated ? escapeHtml(procrastinated.title) + " — open for " + Math.max(0, daysBetween(todayKey(), todayKey(new Date(procrastinated.created)))) + " day(s)." : "Nothing lingering. Great job!"}</p></div></div>
          <div class="insight"><span class="insight__ico">🔥</span><div><b>Habit consistency</b><p>Best streak: ${bestHabitStreak(state)} days across ${state.habits.length} habit(s).</p></div></div>
        </div>
      </div>`;
    requestAnimationFrame(() => {
      drawSeries("aChart1", 14, (k) => state.tasks.filter((t) => t.done && t.completedAt && todayKey(new Date(t.completedAt)) === k).length, "var(--green)");
      drawSeries("aChart2", 14, (k) => state.focusSessions.filter((f) => f.date === k).reduce((a, b) => a + b.minutes, 0), "var(--blue)", true);
      drawHeatmap();
    });
  };
  function drawSeries(id, days, fn, color, line) {
    const s = setupCanvas(id, 200); if (!s) return;
    const { ctx, w, h } = s;
    const keys = []; for (let i = days - 1; i >= 0; i--) keys.push(daysAgoKey(i));
    const data = keys.map(fn); const max = Math.max(1, ...data);
    const pad = 24, step = (w - pad) / (days - 1 || 1);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = cssVar("--border");
    for (let i = 0; i <= 3; i++) { const y = 10 + (h - 40) * (i / 3); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    if (line) {
      ctx.beginPath();
      data.forEach((v, i) => { const x = i * step, y = h - 30 - (v / max) * (h - 45); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();
      const grad = ctx.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, color + "44"); grad.addColorStop(1, "transparent");
      ctx.lineTo((days - 1) * step, h - 30); ctx.lineTo(0, h - 30); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      data.forEach((v, i) => { const x = i * step, y = h - 30 - (v / max) * (h - 45); ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fillStyle = color; ctx.fill(); });
    } else {
      const bw = (w - pad) / days;
      data.forEach((v, i) => { const bh = (v / max) * (h - 45); const x = i * bw + bw * 0.18, y = h - 30 - bh; ctx.fillStyle = color; roundRect(ctx, x, y, bw * 0.64, bh, 4); ctx.fill(); });
    }
  }
  function drawHeatmap() {
    const cont = $("#aHeat"); if (!cont) return;
    const cells = []; const total = 12 * 7;
    for (let i = total - 1; i >= 0; i--) {
      const k = daysAgoKey(i);
      const count = state.tasks.filter((t) => t.done && t.completedAt && todayKey(new Date(t.completedAt)) === k).length
        + state.habits.filter((h) => h.history.includes(k)).length;
      const lvl = count === 0 ? "" : count <= 1 ? "heat-1" : count <= 2 ? "heat-2" : count <= 4 ? "heat-3" : "heat-4";
      cells.push(`<span class="${lvl}" title="${k}: ${count} activities"></span>`);
    }
    cont.innerHTML = cells.join("");
  }
  function bestProductivityHour() {
    const hours = {};
    state.tasks.filter((t) => t.done && t.completedAt).forEach((t) => { const h = new Date(t.completedAt).getHours(); hours[h] = (hours[h] || 0) + 1; });
    const entries = Object.entries(hours).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return "Complete tasks to reveal your peak hours.";
    const h = +entries[0][0];
    return `You complete most tasks around ${h}:00–${h + 1}:00. Schedule your frogs then.`;
  }

  /* ---------- KEY RESULT AREAS ---------- */
  VIEWS.kra = function () {
    const el = $("#view-kra");
    el.innerHTML = `
      <div class="page-head"><div><h1>Key Result Areas</h1><p>Identify the areas where excellent performance matters most. Grade yourself and target your weakest constraint.</p></div>
      <div class="page-head__actions"><button class="btn btn--primary" id="addKra"><span>＋</span> Add Area</button></div></div>
      <div class="grid grid--2" id="kraGrid"></div>`;
    $("#addKra").addEventListener("click", () => kraModal());
    const grid = $("#kraGrid");
    const weakest = state.kra.slice().sort((a, b) => a.grade - b.grade)[0];
    grid.innerHTML = state.kra.map((k) => {
      const color = k.grade >= 75 ? "var(--green)" : k.grade >= 50 ? "var(--orange)" : "var(--red)";
      const grade = k.grade >= 90 ? "A" : k.grade >= 80 ? "B" : k.grade >= 70 ? "C" : k.grade >= 60 ? "D" : "F";
      return `<div class="card card--hover">
        <div class="flex between center"><h3>${escapeHtml(k.name)} ${weakest && weakest.id === k.id ? `<span class="tag tag--A tag--prio">Constraint</span>` : ""}</h3><div class="task__actions"><button class="icon-btn btn--sm" data-kedit="${k.id}">✎</button><button class="icon-btn btn--sm" data-kdel="${k.id}">🗑</button></div></div>
        <div class="ring-wrap mt-12">${ringSvg(k.grade, 80, 9, color, `<b style="font-size:18px">${grade}</b>`)}<div><div class="stat__val" style="font-size:24px;color:${color}">${k.grade}%</div><div class="muted text-sm">performance</div></div></div>
        <input type="range" min="0" max="100" value="${k.grade}" data-kgrade="${k.id}" class="mt-12" style="width:100%" />
      </div>`;
    }).join("") || `<div class="empty" style="grid-column:1/-1"><div class="big">🧭</div><h3>No areas defined</h3></div>`;
    $$("[data-kgrade]", grid).forEach((r) => r.addEventListener("input", (e) => { const k = state.kra.find((x) => x.id === r.dataset.kgrade); k.grade = +e.target.value; save(); VIEWS.kra(); }));
    $$("[data-kedit]", grid).forEach((b) => b.addEventListener("click", () => kraModal(state.kra.find((x) => x.id === b.dataset.kedit))));
    $$("[data-kdel]", grid).forEach((b) => b.addEventListener("click", () => confirmModal("Delete area?", "", () => { state.kra = state.kra.filter((x) => x.id !== b.dataset.kdel); save(); VIEWS.kra(); })));
    if (weakest) { const tip = document.createElement("div"); tip.className = "card mt-16"; tip.innerHTML = `<div class="insight" style="margin:0"><span class="insight__ico">🎯</span><div><b>Focus on your constraint</b><p>"${escapeHtml(weakest.name)}" is your lowest-rated area (${weakest.grade}%). Improving your weakest key result area produces the biggest overall gains.</p></div></div>`; el.appendChild(tip); }
  };
  function kraModal(existing) {
    const k = existing || {};
    modal(existing ? "Edit Area" : "New Key Result Area", "e.g. Career, Health, Finances, Relationships", `
      <div class="field"><label>Area name</label><input id="k_name" value="${escapeHtml(k.name || "")}" placeholder="e.g. Health & Fitness" /></div>
      <div class="field"><label>Current grade <b id="k_glbl">${k.grade ?? 50}</b>%</label><input type="range" min="0" max="100" id="k_grade" value="${k.grade ?? 50}" /></div>
    `, `<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" id="k_save">${existing ? "Save" : "Add"}</button>`);
    $("#k_grade").addEventListener("input", (e) => $("#k_glbl").textContent = e.target.value);
    $("#k_save").addEventListener("click", () => {
      const name = $("#k_name").value.trim(); if (!name) { toast("Enter a name", "warn"); return; }
      if (existing) { existing.name = name; existing.grade = +$("#k_grade").value; }
      else state.kra.push({ id: uid(), name, grade: +$("#k_grade").value });
      save(); closeModal(); VIEWS.kra();
    });
  }

  /* ---------- REVIEWS ---------- */
  VIEWS.reviews = function () {
    const el = $("#view-reviews");
    el.innerHTML = `
      <div class="page-head"><div><h1>Reviews & Reflection</h1><p>Review your day, week, and month. Reflection turns experience into wisdom and momentum.</p></div>
      <div class="page-head__actions">
        <button class="btn" data-review="daily">📝 Daily</button>
        <button class="btn" data-review="weekly">📅 Weekly</button>
        <button class="btn" data-review="monthly">🗓️ Monthly</button>
      </div></div>
      <div class="grid grid--2" id="reviewGrid"></div>`;
    $$("#view-reviews [data-review]").forEach((b) => b.addEventListener("click", () => reviewModal(b.dataset.review)));
    const grid = $("#reviewGrid");
    if (!state.reviews.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">📝</div><h3>No reviews yet</h3><p>Reflect on your day to build self-awareness.</p></div>`; return; }
    grid.innerHTML = state.reviews.slice().reverse().map((r) => `<div class="card">
      <div class="flex between center"><span class="goal__cat" style="background:var(--blue-soft);color:var(--blue)">${r.type}</span><span class="muted text-sm">${r.date}</span></div>
      <div class="mt-12">${"⭐".repeat(r.rating)}<span class="muted">${"☆".repeat(5 - r.rating)}</span></div>
      <p class="mt-8">${escapeHtml(r.text)}</p>
      <button class="btn btn--sm mt-12" data-rdel="${r.id}">Delete</button>
    </div>`).join("");
    $$("[data-rdel]", grid).forEach((b) => b.addEventListener("click", () => { state.reviews = state.reviews.filter((x) => x.id !== b.dataset.rdel); save(); VIEWS.reviews(); }));
  };
  function dailyReviewModal() { reviewModal("daily"); }
  function reviewModal(type) {
    const doneToday = state.tasks.filter((t) => t.done && t.completedAt && todayKey(new Date(t.completedAt)) === todayKey()).length;
    modal(type.charAt(0).toUpperCase() + type.slice(1) + " Review", `You completed ${doneToday} task(s) today. What did you learn?`, `
      <div class="field"><label>Rate your ${type === "daily" ? "day" : type === "weekly" ? "week" : "month"}</label>
        <select id="r_rating"><option value="5">⭐⭐⭐⭐⭐ Excellent</option><option value="4">⭐⭐⭐⭐ Good</option><option value="3" selected>⭐⭐⭐ Okay</option><option value="2">⭐⭐ Poor</option><option value="1">⭐ Tough</option></select></div>
      <div class="field"><label>Reflection</label><textarea id="r_text" placeholder="What went well? What was your biggest frog? What will you do better?" style="min-height:120px"></textarea></div>
    `, `<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" id="r_save">Save Review</button>`);
    $("#r_save").addEventListener("click", () => {
      const text = $("#r_text").value.trim(); if (!text) { toast("Write a reflection", "warn"); return; }
      state.reviews.push({ id: uid(), date: todayKey(), type, text, rating: +$("#r_rating").value });
      addXP(15, "Review completed"); save(); closeModal(); if (currentView === "reviews") VIEWS.reviews(); toast("Review saved 📝", "success");
    });
  }

  /* ---------- SETTINGS ---------- */
  VIEWS.settings = function () {
    const el = $("#view-settings");
    const s = state.settings;
    el.innerHTML = `
      <div class="page-head"><div><h1>Settings</h1><p>Personalize your productivity OS, manage your data, and configure focus sessions.</p></div></div>
      <div class="grid grid--2">
        <div class="card">
          <div class="card__title mb-12">👤 Profile</div>
          <div class="field"><label>Your name</label><input id="set_name" value="${escapeHtml(state.profile.name)}" /></div>
          <div class="field"><label>Theme</label><select id="set_theme"><option value="dark" ${state.profile.theme === "dark" ? "selected" : ""}>Dark</option><option value="light" ${state.profile.theme === "light" ? "selected" : ""}>Light</option></select></div>
          <button class="btn btn--primary" id="set_save">Save profile</button>
        </div>
        <div class="card">
          <div class="card__title mb-12">🎧 Focus timer</div>
          <div class="field-row">
            <div class="field"><label>Focus (min)</label><input type="number" id="set_pom" value="${s.pomodoro}" min="5" max="90" /></div>
            <div class="field"><label>Short break</label><input type="number" id="set_sb" value="${s.shortBreak}" min="1" max="30" /></div>
          </div>
          <div class="field"><label>Long break (min)</label><input type="number" id="set_lb" value="${s.longBreak}" min="5" max="60" /></div>
          <button class="btn btn--primary" id="set_timer">Save timer</button>
        </div>
        <div class="card">
          <div class="card__title mb-12">💾 Backup & restore</div>
          <p class="muted text-sm mb-12">Your data is saved automatically offline. Export a backup file or import a previous one.</p>
          <div class="flex gap-8 wrap">
            <button class="btn" id="set_export">⬇ Export data</button>
            <button class="btn" id="set_import">⬆ Import data</button>
            <input type="file" id="set_file" accept="application/json" hidden />
          </div>
        </div>
        <div class="card" style="border-color:var(--red)">
          <div class="card__title mb-12">⚠️ Danger zone</div>
          <p class="muted text-sm mb-12">Reset wipes all tasks, goals, habits, and history permanently. This is the only way to clear your data.</p>
          <button class="btn btn--danger" id="set_reset">Reset everything</button>
        </div>
      </div>
      <div class="card mt-16">
        <div class="card__title mb-12">📊 Your data</div>
        <div class="flex wrap gap-12">
          <span class="tag">${state.tasks.length} tasks</span>
          <span class="tag">${state.goals.length} goals</span>
          <span class="tag">${state.habits.length} habits</span>
          <span class="tag">${state.focusSessions.length} focus sessions</span>
          <span class="tag">${state.reviews.length} reviews</span>
          <span class="tag">${state.xp} XP · Level ${levelInfo(state.xp).level}</span>
        </div>
      </div>`;
    $("#set_save").addEventListener("click", () => { state.profile.name = $("#set_name").value.trim() || "Achiever"; applyTheme($("#set_theme").value); save(); renderCurrent(); toast("Profile saved", "success"); });
    $("#set_timer").addEventListener("click", () => { s.pomodoro = clamp(+$("#set_pom").value, 5, 90); s.shortBreak = clamp(+$("#set_sb").value, 1, 30); s.longBreak = clamp(+$("#set_lb").value, 5, 60); focusTimer.total = 0; save(); toast("Timer settings saved", "success"); });
    $("#set_export").addEventListener("click", exportData);
    $("#set_import").addEventListener("click", () => $("#set_file").click());
    $("#set_file").addEventListener("change", importData);
    $("#set_reset").addEventListener("click", () => confirmModal("Reset everything?", "All your data will be permanently deleted. This cannot be undone.", () => {
      localStorage.removeItem(STORAGE_KEY); idbSave(defaultState());
      state = defaultState(); save(); go("dashboard"); toast("All data reset", "danger");
    }, "Yes, reset all"));
  };
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `eat-that-frog-backup-${todayKey()}.json`; a.click();
    URL.revokeObjectURL(url); toast("Backup exported", "success");
  }
  function importData(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { const data = JSON.parse(reader.result); state = Object.assign(defaultState(), data); save(); applyTheme(state.profile.theme); go("dashboard"); toast("Data imported", "success"); }
      catch (err) { toast("Invalid backup file", "danger"); }
    };
    reader.readAsText(file);
  }

  /* =======================================================================
     9. BOOT
     ======================================================================= */
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

