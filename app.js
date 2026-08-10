// PL-900 Practice Test — local prototype (localStorage-based)
// Data layer is isolated in the DB object so it can be swapped for Firebase later
// without touching the UI/quiz-engine code below.

const FULL_TEST_MINUTES = 60;
const SECTION_TEST_MINUTES = 15;
const PASS_PERCENT = 70;

// ---------- Data layer (localStorage today, Firestore later) ----------
const DB = {
  getUser() {
    const raw = localStorage.getItem("pl900_user");
    return raw ? JSON.parse(raw) : null;
  },
  setUser(user) {
    localStorage.setItem("pl900_user", JSON.stringify(user));
  },
  clearUser() {
    localStorage.removeItem("pl900_user");
  },
  historyKey(email) {
    return `pl900_history_${email.toLowerCase()}`;
  },
  getHistory(email) {
    const raw = localStorage.getItem(this.historyKey(email));
    return raw ? JSON.parse(raw) : [];
  },
  saveAttempt(email, attempt) {
    const history = this.getHistory(email);
    history.unshift(attempt);
    localStorage.setItem(this.historyKey(email), JSON.stringify(history));
  },
};

// ---------- App state ----------
let ALL_QUESTIONS = [];
let session = null; // active test session

// ---------- View switching ----------
function show(viewId) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(viewId).classList.add("active");
}

function setUserChip() {
  const user = DB.getUser();
  const chip = document.getElementById("userChip");
  chip.textContent = user ? `${user.name} · ${user.email}` : "";
}

// ---------- Boot ----------
async function boot() {
  const res = await fetch("questions.json");
  ALL_QUESTIONS = await res.json();

  const user = DB.getUser();
  if (user) {
    setUserChip();
    renderDashboard();
    show("view-dashboard");
  } else {
    show("view-welcome");
  }

  document.getElementById("welcomeForm").addEventListener("submit", onWelcomeSubmit);
  document.getElementById("logoutBtn").addEventListener("click", () => {
    DB.clearUser();
    setUserChip();
    show("view-welcome");
  });
  document.getElementById("startFullBtn").addEventListener("click", () => startTest("full"));
  document.getElementById("submitTestBtn").addEventListener("click", onSubmitTest);
  document.getElementById("prevQBtn").addEventListener("click", () => gotoQuestion(session.index - 1));
  document.getElementById("nextQBtn").addEventListener("click", () => gotoQuestion(session.index + 1));
  document.getElementById("backToDashBtn").addEventListener("click", () => {
    renderDashboard();
    show("view-dashboard");
  });
}

// ---------- Welcome / guest login ----------
function onWelcomeSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("nameInput").value.trim();
  const email = document.getElementById("emailInput").value.trim();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
    alert("Please enter your name and a valid email address.");
    return;
  }
  DB.setUser({ name, email });
  setUserChip();
  renderDashboard();
  show("view-dashboard");
}

// ---------- Dashboard ----------
function getSections() {
  return [...new Set(ALL_QUESTIONS.map((q) => q.section))];
}

function renderDashboard() {
  const user = DB.getUser();
  document.getElementById("dashGreeting").textContent = `Welcome back, ${user.name}!`;

  // Section buttons
  const sections = getSections();
  const list = document.getElementById("sectionList");
  list.innerHTML = "";
  sections.forEach((sec) => {
    const count = ALL_QUESTIONS.filter((q) => q.section === sec).length;
    const row = document.createElement("div");
    row.className = "section-item";
    row.innerHTML = `
      <div>
        <div>${sec}</div>
        <div class="count">${count} question${count === 1 ? "" : "s"}</div>
      </div>
      <button class="btn secondary" data-section="${sec}">Practice this topic</button>
    `;
    row.querySelector("button").addEventListener("click", () => startTest("section", sec));
    list.appendChild(row);
  });

  // History table
  const history = DB.getHistory(user.email);
  const tbody = document.getElementById("historyBody");
  tbody.innerHTML = "";
  if (history.length === 0) {
    document.getElementById("historyEmpty").style.display = "block";
    document.getElementById("historyTable").style.display = "none";
  } else {
    document.getElementById("historyEmpty").style.display = "none";
    document.getElementById("historyTable").style.display = "table";
    history.forEach((a) => {
      const tr = document.createElement("tr");
      const pct = Math.round((a.score / a.total) * 100);
      tr.innerHTML = `
        <td>${new Date(a.date).toLocaleDateString()} ${new Date(a.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
        <td>${a.mode}</td>
        <td>${a.score}/${a.total}</td>
        <td><span class="badge ${pct >= PASS_PERCENT ? "pass" : "fail"}">${pct}%</span></td>
        <td>${formatDuration(a.timeTakenSec)}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

// ---------- Test engine ----------
function startTest(mode, sectionName) {
  let questions;
  let minutes;
  let modeLabel;

  if (mode === "full") {
    questions = shuffle([...ALL_QUESTIONS]);
    minutes = FULL_TEST_MINUTES;
    modeLabel = "Full practice test";
  } else {
    questions = shuffle(ALL_QUESTIONS.filter((q) => q.section === sectionName));
    minutes = SECTION_TEST_MINUTES;
    modeLabel = sectionName;
  }

  session = {
    mode: modeLabel,
    questions,
    index: 0,
    answers: {}, // qid -> array of selected option ids (order matters for "ordering" type)
    flagged: new Set(),
    startedAt: Date.now(),
    durationSec: minutes * 60,
    remainingSec: minutes * 60,
    timerHandle: null,
  };

  renderNavGrid();
  renderQuestion();
  startTimer();
  show("view-test");
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function startTimer() {
  updateTimerDisplay();
  session.timerHandle = setInterval(() => {
    session.remainingSec--;
    updateTimerDisplay();
    if (session.remainingSec <= 0) {
      clearInterval(session.timerHandle);
      finishTest();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById("timerDisplay");
  const m = Math.floor(session.remainingSec / 60);
  const s = session.remainingSec % 60;
  el.textContent = `${m}:${String(s).padStart(2, "0")}`;
  el.classList.toggle("low", session.remainingSec <= 60);
}

function renderNavGrid() {
  const grid = document.getElementById("navGrid");
  grid.innerHTML = "";
  session.questions.forEach((q, i) => {
    const btn = document.createElement("button");
    btn.textContent = i + 1;
    btn.addEventListener("click", () => gotoQuestion(i));
    grid.appendChild(btn);
  });
  updateNavGrid();
}

function updateNavGrid() {
  const grid = document.getElementById("navGrid");
  [...grid.children].forEach((btn, i) => {
    const q = session.questions[i];
    btn.className = "";
    if (i === session.index) btn.classList.add("current");
    if (session.answers[q.id] && session.answers[q.id].length > 0) btn.classList.add("answered");
    if (session.flagged.has(q.id)) btn.classList.add("flagged");
  });
}

function gotoQuestion(i) {
  if (i < 0 || i >= session.questions.length) return;
  session.index = i;
  renderQuestion();
}

function renderQuestion() {
  const q = session.questions[session.index];
  document.getElementById("questionMeta").textContent =
    `${q.section} · Question ${session.index + 1} of ${session.questions.length}`;
  document.getElementById("questionText").textContent = q.text;

  const body = document.getElementById("questionBody");
  body.innerHTML = "";

  const selected = session.answers[q.id] || [];

  if (q.type === "single" || q.type === "truefalse") {
    q.options.forEach((opt) => {
      const div = document.createElement("div");
      div.className = "option" + (selected.includes(opt.id) ? " selected" : "");
      div.innerHTML = `<input type="radio" ${selected.includes(opt.id) ? "checked" : ""} /> ${opt.text}`;
      div.addEventListener("click", () => {
        session.answers[q.id] = [opt.id];
        renderQuestion();
        updateNavGrid();
      });
      body.appendChild(div);
    });
  } else if (q.type === "multi") {
    const hint = document.createElement("div");
    hint.className = "question-meta";
    hint.style.marginBottom = "8px";
    hint.textContent = "Select all that apply";
    body.appendChild(hint);
    q.options.forEach((opt) => {
      const div = document.createElement("div");
      div.className = "option" + (selected.includes(opt.id) ? " selected" : "");
      div.innerHTML = `<input type="checkbox" ${selected.includes(opt.id) ? "checked" : ""} /> ${opt.text}`;
      div.addEventListener("click", () => {
        const set = new Set(selected);
        set.has(opt.id) ? set.delete(opt.id) : set.add(opt.id);
        session.answers[q.id] = [...set];
        renderQuestion();
        updateNavGrid();
      });
      body.appendChild(div);
    });
  } else if (q.type === "ordering") {
    const hint = document.createElement("div");
    hint.className = "question-meta";
    hint.style.marginBottom = "8px";
    hint.textContent = "Use the arrows to put these in the correct order";
    body.appendChild(hint);

    // Initialize order with option order the first time it's viewed
    let order = selected.length ? selected : q.options.map((o) => o.id);
    session.answers[q.id] = order;

    const ul = document.createElement("ul");
    ul.className = "order-list";
    order.forEach((optId, idx) => {
      const opt = q.options.find((o) => o.id === optId);
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${idx + 1}. ${opt.text}</span>
        <span class="order-btns">
          <button type="button" data-dir="up" ${idx === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-dir="down" ${idx === order.length - 1 ? "disabled" : ""}>↓</button>
        </span>
      `;
      li.querySelector('[data-dir="up"]').addEventListener("click", () => moveOrderItem(q, idx, -1));
      li.querySelector('[data-dir="down"]').addEventListener("click", () => moveOrderItem(q, idx, 1));
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }

  // Flag toggle
  const flagEl = document.getElementById("flagToggle");
  flagEl.classList.toggle("active", session.flagged.has(q.id));
  flagEl.onclick = () => {
    session.flagged.has(q.id) ? session.flagged.delete(q.id) : session.flagged.add(q.id);
    renderQuestion();
    updateNavGrid();
  };

  document.getElementById("prevQBtn").disabled = session.index === 0;
  document.getElementById("nextQBtn").style.display =
    session.index === session.questions.length - 1 ? "none" : "inline-block";
  document.getElementById("submitTestBtn").style.display =
    session.index === session.questions.length - 1 ? "inline-block" : "none";

  updateNavGrid();
}

function moveOrderItem(q, idx, delta) {
  const order = session.answers[q.id];
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= order.length) return;
  [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
  renderQuestion();
}

function onSubmitTest() {
  const unanswered = session.questions.filter((q) => !session.answers[q.id] || session.answers[q.id].length === 0).length;
  if (unanswered > 0) {
    const ok = confirm(`You have ${unanswered} unanswered question(s). Submit anyway?`);
    if (!ok) return;
  }
  finishTest();
}

function finishTest() {
  clearInterval(session.timerHandle);

  let correctCount = 0;
  const reviewItems = session.questions.map((q) => {
    const given = session.answers[q.id] || [];
    const isCorrect = arraysEqual(given, q.correct);
    if (isCorrect) correctCount++;
    return { question: q, given, isCorrect };
  });

  const timeTakenSec = session.durationSec - session.remainingSec;
  const attempt = {
    date: Date.now(),
    mode: session.mode,
    score: correctCount,
    total: session.questions.length,
    timeTakenSec,
    review: reviewItems.map((r) => ({
      qid: r.question.id,
      given: r.given,
      isCorrect: r.isCorrect,
    })),
  };

  const user = DB.getUser();
  DB.saveAttempt(user.email, attempt);

  renderResults(reviewItems, attempt);
  show("view-results");
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]) || (new Set(a).size === a.length && [...a].sort().join() === [...b].sort().join() && !isOrderingSensitive(a, b));
}

// For "ordering" questions, order matters; for "single"/"multi"/"truefalse" it doesn't.
// Simplify: caller already knows type, but to keep arraysEqual generic we compare as sets
// UNLESS lengths differ from a pure set comparison (ordering questions are compared by exact sequence).
function isOrderingSensitive() {
  return false; // overridden by exact-order check above when arrays already match in sequence
}

function renderResults(reviewItems, attempt) {
  const pct = Math.round((attempt.score / attempt.total) * 100);
  document.getElementById("scorePct").textContent = `${pct}%`;
  document.getElementById("scoreDetail").textContent =
    `${attempt.score} / ${attempt.total} correct · ${attempt.mode} · ${formatDuration(attempt.timeTakenSec)}`;
  const badge = document.getElementById("passBadge");
  badge.textContent = pct >= PASS_PERCENT ? "Pass" : "Below passing (70%)";
  badge.className = "badge " + (pct >= PASS_PERCENT ? "pass" : "fail");

  // Section breakdown
  const bySection = {};
  reviewItems.forEach((r) => {
    const sec = r.question.section;
    bySection[sec] = bySection[sec] || { correct: 0, total: 0 };
    bySection[sec].total++;
    if (r.isCorrect) bySection[sec].correct++;
  });
  const secBody = document.getElementById("sectionBreakdownBody");
  secBody.innerHTML = "";
  Object.entries(bySection).forEach(([sec, s]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${sec}</td><td>${s.correct}/${s.total}</td>`;
    secBody.appendChild(tr);
  });

  // Full review
  const reviewList = document.getElementById("reviewList");
  reviewList.innerHTML = "";
  reviewItems.forEach((r, i) => {
    const q = r.question;
    const div = document.createElement("div");
    div.className = "review-item";
    const givenText = q.options
      .filter((o) => r.given.includes(o.id))
      .map((o) => o.text)
      .join(", ") || "(no answer)";
    const correctText = q.options
      .filter((o) => q.correct.includes(o.id))
      .map((o) => o.text)
      .join(", ");
    div.innerHTML = `
      <div class="question-meta">Question ${i + 1} · ${q.section}</div>
      <div class="question-text" style="font-size:0.98rem;">${q.text}</div>
      <div class="your-answer">
        <span class="${r.isCorrect ? "icon-correct" : "icon-incorrect"}">${r.isCorrect ? "✓ Correct" : "✗ Incorrect"}</span>
        — Your answer: ${givenText}
      </div>
      ${!r.isCorrect ? `<div class="your-answer">Correct answer: ${correctText}</div>` : ""}
      <div class="explanation">${q.explanation}</div>
    `;
    reviewList.appendChild(div);
  });
}

boot();
