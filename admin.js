// LR PL900 Admin — edits questions.json and commits directly to GitHub via
// the Git Data API (not the simple Contents API, which caps single-file
// reads at 1MB — this repo's questions.json is ~1.6MB, so the low-level
// blob/tree/commit flow is used instead; it reliably handles files far
// larger than that). The GitHub token lives only in this browser's
// localStorage and is sent only to api.github.com, directly from here.

const REPO_OWNER = "rlashmibai";
const REPO_NAME = "LR-PL-900-Practice-Test";
const BRANCH = "main";
const FILE_PATH = "questions.json";
const TOKEN_KEY = "pl900_admin_token";

const SECTIONS = [
  "Describe the business value of Microsoft Power Platform",
  "Manage the Microsoft Power Platform environment",
  "Demonstrate the capabilities of Power Apps",
  "Demonstrate the capabilities of Power Automate",
  "Describe features and capabilities of agents in Microsoft Copilot Studio",
];

let ALL_QUESTIONS = [];
let currentQuestion = null;
let isNewQuestion = false;

// ---------- Live formatting preview ----------
// Loads app.js's own formatQuestionText()/formatExplanation() (and everything
// they depend on) so the edit form can show exactly what a change will look
// like on the live site — the same rendering pipeline, not a re-implementation
// that could drift out of sync. Only the pure formatting functions are
// loaded: app.js's DOM-wiring code (starting at boot()) is sliced off first
// so nothing here tries to attach to elements that only exist on index.html.
let formattersReady = false;
async function loadFormatters() {
  if (formattersReady) return;
  try {
    const res = await fetch(`app.js?bust=${Date.now()}`);
    const src = await res.text();
    let bootIdx = src.indexOf("function boot(");
    const asyncIdx = src.lastIndexOf("async ", bootIdx);
    if (asyncIdx !== -1 && bootIdx - asyncIdx < 10) bootIdx = asyncIdx;
    const code = src.slice(0, bootIdx);
    // Indirect eval (the "(0, eval)" trick) runs in global scope, so the
    // function declarations inside become real globals callable from
    // anywhere in this file — a direct eval() here would scope them to just
    // this function.
    (0, eval)(code);
    formattersReady = true;
  } catch (err) {
    console.warn("Could not load live formatters for preview:", err);
  }
}

// ---------- Token ----------
function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
function ghHeaders() {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

// ---------- Load current questions.json (from the live site, not the API —
// avoids the API's 1MB single-file read cap entirely for this step) ----------
async function loadQuestions() {
  setStatus(document.getElementById("loadStatus"), "info", "Loading current questions.json...");
  try {
    const res = await fetch(`questions.json?bust=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ALL_QUESTIONS = await res.json();
    setStatus(document.getElementById("loadStatus"), "ok", `Loaded ${ALL_QUESTIONS.length} questions.`);
    populateSectionFilter();
    populateTestFilter();
    renderSearchList();
    document.getElementById("editorArea").style.display = "block";
  } catch (err) {
    setStatus(document.getElementById("loadStatus"), "error", `Failed to load: ${err.message}`);
  }
}

function populateSectionFilter() {
  const sel = document.getElementById("sectionFilter");
  const sections = [...new Set(ALL_QUESTIONS.map((q) => q.section))];
  sel.innerHTML = `<option value="">All domains</option>` + sections.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
}

// Lets you jump straight to "Practice Test N" and see just its ~50
// questions, instead of hunting through all 600 in one flat list.
function populateTestFilter() {
  const sel = document.getElementById("testFilter");
  const tests = [...new Set(ALL_QUESTIONS.map((q) => q.testSet).filter((t) => t != null))].sort((a, b) => a - b);
  sel.innerHTML =
    `<option value="">All practice tests</option>` +
    tests.map((t) => `<option value="${t}">Practice Test ${t}</option>`).join("");
}

// ---------- Search list ----------
function renderSearchList() {
  const term = document.getElementById("searchInput").value.trim().toLowerCase();
  const testSet = document.getElementById("testFilter").value;
  const section = document.getElementById("sectionFilter").value;
  let results = ALL_QUESTIONS;
  if (testSet) results = results.filter((x) => String(x.testSet) === testSet);
  if (section) results = results.filter((x) => x.section === section);
  if (term) {
    results = results.filter((x) => x.id.toLowerCase().includes(term) || x.text.toLowerCase().includes(term));
  }
  // Sort by test set, then by id numerically (q2 before q10, not after) —
  // otherwise results just show in raw file order, which doesn't group by test at all.
  results = [...results].sort((a, b) => {
    const bySet = (a.testSet || 0) - (b.testSet || 0);
    if (bySet !== 0) return bySet;
    const aNum = parseInt((a.id.match(/\d+/) || [0])[0], 10);
    const bNum = parseInt((b.id.match(/\d+/) || [0])[0], 10);
    return aNum - bNum || a.id.localeCompare(b.id);
  });
  // No display cap — 600 simple rows renders fine, and capping it here was
  // what made it look like not all questions had loaded.
  const capped = results;
  document.getElementById("resultCount").textContent = `${results.length} match${results.length === 1 ? "" : "es"}`;

  const list = document.getElementById("searchList");
  list.innerHTML = "";
  capped.forEach((qq) => {
    const row = document.createElement("div");
    row.className = "admin-q-row" + (currentQuestion && !isNewQuestion && currentQuestion.id === qq.id ? " active" : "");
    const preview = stripHtml(qq.text).slice(0, 70);
    const pos = positionInTestSet(qq);
    const posLabel = pos ? `Q${pos} · ` : "";
    row.innerHTML = `<strong>Test ${qq.testSet || "—"} · ${posLabel}${escapeHtml(qq.id)}</strong> · ${escapeHtml(qq.type)}<br>${escapeHtml(preview)}${qq.text.length > 70 ? "…" : ""}`;
    row.addEventListener("click", () => selectQuestion(qq.id));
    list.appendChild(row);
  });
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, "");
}

// 1-based position of q within its own test set, sorted the same numeric-id
// way the live test view now uses (fixed order, no shuffle) — so "Q23" here
// is exactly "Question #23" a test-taker sees in that test.
function positionInTestSet(q) {
  if (!q.testSet) return null;
  const sameSet = ALL_QUESTIONS.filter((x) => x.testSet === q.testSet).sort((a, b) => {
    const aNum = parseInt((a.id.match(/\d+/) || [0])[0], 10);
    const bNum = parseInt((b.id.match(/\d+/) || [0])[0], 10);
    return aNum - bNum || a.id.localeCompare(b.id);
  });
  const idx = sameSet.findIndex((x) => x.id === q.id);
  return idx === -1 ? null : idx + 1;
}

// ---------- Select / new ----------
function selectQuestion(id) {
  currentQuestion = ALL_QUESTIONS.find((q) => q.id === id);
  isNewQuestion = false;
  renderSearchList();
  renderForm();
}

function newQuestion() {
  currentQuestion = {
    id: "",
    type: "single",
    section: SECTIONS[0],
    text: "",
    options: [
      { id: "a", text: "" },
      { id: "b", text: "" },
    ],
    correct: [],
    explanation: "",
    testSet: 1,
  };
  isNewQuestion = true;
  renderSearchList();
  renderForm();
}

// ---------- Edit form ----------
function renderForm() {
  const card = document.getElementById("formCard");
  card.style.display = "block";
  const q = currentQuestion;

  let bodyHtml = "";
  if (q.type === "fillblank") {
    bodyHtml = `
      <label for="fillblankAnswer">Accepted answer</label>
      <input type="text" id="fillblankAnswer" value="${escapeAttr((q.correct && q.correct[0]) || "")}" />
      <label for="fillblankClue">Clue (optional)</label>
      <input type="text" id="fillblankClue" value="${escapeAttr(q.clue || "")}" />
    `;
  } else {
    bodyHtml = `
      <label>Options ${q.type === "ordering" ? "(the shuffle-able items)" : "— tick the correct one(s)"}</label>
      <div id="optionsList"></div>
      <div class="btn-row" style="margin-top:0;"><button type="button" id="addOptionBtn" class="btn ghost small">+ Add option</button></div>
    `;
    if (q.type === "ordering") {
      bodyHtml += `
        <label for="orderingCorrect">Correct order — comma-separated option ids (e.g. "a,c,b,d")</label>
        <input type="text" id="orderingCorrect" value="${escapeAttr((q.correct || []).join(","))}" />
      `;
    }
  }

  card.innerHTML = `
    <h2>${
      isNewQuestion
        ? "New Question"
        : `Editing ${escapeHtml(q.id)}` + (positionInTestSet(q) ? ` (Test ${q.testSet} · Question #${positionInTestSet(q)})` : "")
    }</h2>
    <label for="fieldId">ID</label>
    <input type="text" id="fieldId" value="${escapeAttr(q.id)}" ${isNewQuestion ? "" : "disabled"} />
    <label for="fieldType">Type</label>
    <select id="fieldType">
      ${["single", "multi", "truefalse", "fillblank", "ordering"]
        .map((t) => `<option value="${t}" ${t === q.type ? "selected" : ""}>${t}</option>`)
        .join("")}
    </select>
    <label for="fieldSection">Domain / Section</label>
    <select id="fieldSection">
      ${SECTIONS.map((s) => `<option value="${escapeAttr(s)}" ${s === q.section ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
    </select>
    <label for="fieldTestSet">Test Set (1-12)</label>
    <input type="number" id="fieldTestSet" min="1" max="12" value="${q.testSet || 1}" />
    <label for="fieldText">Question text</label>
    <textarea id="fieldText" rows="4">${escapeHtml(q.text)}</textarea>
    ${bodyHtml}
    <label for="fieldExplanation">Overall Explanation</label>
    <textarea id="fieldExplanation" rows="6">${escapeHtml(q.explanation || "")}</textarea>
    <div class="btn-row">
      <button type="button" id="saveBtn" class="btn">Save to GitHub</button>
      ${isNewQuestion ? "" : '<button type="button" id="deleteBtn" class="btn ghost" style="color:var(--red);">Delete question</button>'}
      <button type="button" id="cancelBtn" class="btn ghost">Close</button>
    </div>
    <p id="formStatus" class="admin-status" style="display:none;"></p>
    <div style="font-size:0.78rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin:16px 0 6px; border-top:1px solid var(--border); padding-top:14px;">Live preview — updates as you type, exactly how this renders on the site</div>
    <div id="previewPanel" style="border:1px solid var(--border); border-radius:var(--radius); background:#fff; min-height:60px;"></div>
  `;

  if (q.type !== "fillblank") {
    renderOptionsEditor();
    document.getElementById("addOptionBtn").addEventListener("click", addOption);
  }

  document.getElementById("fieldType").addEventListener("change", (e) => {
    const newType = e.target.value;
    if (newType !== "fillblank" && (!q.options || q.options.length === 0)) {
      q.options = [
        { id: "a", text: "" },
        { id: "b", text: "" },
      ];
    }
    q.correct = [];
    q.type = newType;
    renderForm();
  });

  document.getElementById("saveBtn").addEventListener("click", saveQuestion);
  document.getElementById("cancelBtn").addEventListener("click", () => {
    card.style.display = "none";
    currentQuestion = null;
    isNewQuestion = false;
    renderSearchList();
  });
  if (!isNewQuestion) {
    document.getElementById("deleteBtn").addEventListener("click", deleteQuestion);
  }

  // Live preview: one delegated listener on the whole form catches typing in
  // fieldText/fieldExplanation and any option textarea (including ones added
  // later via "+ Add option", since delegation doesn't need per-input
  // rewiring) and re-renders the preview, debounced so it isn't re-running
  // the formatter on every single keystroke.
  card.addEventListener("input", scheduleLivePreview);
  loadFormatters().then(renderLivePreview);
}

// Renders the CURRENT (unsaved) values of the question text, each option's
// explanation, and the overall explanation through the exact same
// formatQuestionText()/formatExplanation() the live site uses. Always
// visible and kept in sync via scheduleLivePreview() below, so editing feels
// like one continuous surface instead of raw-text-then-click-to-check.
function renderLivePreview() {
  const panel = document.getElementById("previewPanel");
  if (!panel) return; // form was closed before this fired

  if (!formattersReady || typeof formatQuestionText !== "function" || typeof formatExplanation !== "function") {
    panel.innerHTML = `<p style="padding:14px; color:var(--red);">Couldn't load the live formatter (app.js) — check your connection and reopen this question.</p>`;
    return;
  }

  const text = document.getElementById("fieldText").value.trim();
  const explanation = document.getElementById("fieldExplanation").value.trim();

  let optionsHtml = "";
  const optTextInputs = document.querySelectorAll(".opt-text-input");
  if (optTextInputs.length) {
    optionsHtml = [...optTextInputs]
      .map((input) => {
        const idx = input.dataset.idx;
        const optText = input.value.trim();
        const exprInput = document.querySelector(`.opt-expl-input[data-idx="${idx}"]`);
        const optExpl = exprInput ? exprInput.value.trim() : "";
        return `
          <div style="padding:10px 0; border-top:1px solid var(--border);">
            <div style="font-weight:700;">${escapeHtml(optText)}</div>
            ${optExpl ? `<div class="option-expl-text">${formatExplanation(optExpl)}</div>` : ""}
          </div>`;
      })
      .join("");
  }

  panel.innerHTML = `
    <div style="padding:14px;">
      <div class="question-text" style="font-weight:700;">${text ? formatQuestionText(text) : "<em>(no question text yet)</em>"}</div>
      ${optionsHtml}
      ${
        explanation
          ? `<div class="explanation-card" style="margin-top:14px;">
               <div class="explanation-title">${optTextInputs.length ? "Overall Explanation" : "Explanation"}</div>
               <div class="explanation-body">${formatExplanation(explanation)}</div>
             </div>`
          : ""
      }
    </div>
  `;
}

let livePreviewTimer = null;
function scheduleLivePreview() {
  clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(renderLivePreview, 300);
}

function nextOptionId(existing) {
  for (const l of "abcdefgh") if (!existing.includes(l)) return l;
  return `opt${existing.length}`;
}

function addOption() {
  const q = currentQuestion;
  q.options.push({ id: nextOptionId(q.options.map((o) => o.id)), text: "" });
  renderOptionsEditor();
}

function renderOptionsEditor() {
  const q = currentQuestion;
  const wrap = document.getElementById("optionsList");
  wrap.innerHTML = "";
  const showCorrectMarker = q.type !== "ordering";
  const inputType = q.type === "multi" ? "checkbox" : "radio";

  q.options.forEach((opt, idx) => {
    const row = document.createElement("div");
    row.className = "option-edit-row";
    const isCorrect = (q.correct || []).includes(opt.id);
    row.innerHTML = `
      ${showCorrectMarker ? `<div class="correct-marker"><input type="${inputType}" name="correctMarker" data-optid="${escapeAttr(opt.id)}" ${isCorrect ? "checked" : ""} title="Mark correct" /></div>` : ""}
      <div style="flex:1;">
        <input type="text" class="opt-id-input" data-idx="${idx}" value="${escapeAttr(opt.id)}" />
        <textarea class="opt-text-input" data-idx="${idx}" rows="2" placeholder="Option text">${escapeHtml(opt.text)}</textarea>
        <textarea class="opt-expl-input" data-idx="${idx}" rows="2" placeholder="Why this option is right/wrong (optional)">${escapeHtml(opt.explanation || "")}</textarea>
      </div>
      <button type="button" class="btn ghost small remove-opt-btn" data-idx="${idx}">✕</button>
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll(".remove-opt-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.idx);
      const removedId = q.options[idx].id;
      q.options.splice(idx, 1);
      q.correct = (q.correct || []).filter((c) => c !== removedId);
      renderOptionsEditor();
    })
  );
  wrap.querySelectorAll('input[name="correctMarker"]').forEach((input) =>
    input.addEventListener("change", (e) => {
      const optId = e.target.dataset.optid;
      if (q.type === "multi") {
        q.correct = q.correct || [];
        if (e.target.checked) q.correct.push(optId);
        else q.correct = q.correct.filter((c) => c !== optId);
      } else {
        q.correct = [optId];
        wrap.querySelectorAll('input[name="correctMarker"]').forEach((i) => {
          if (i !== e.target) i.checked = false;
        });
      }
    })
  );

  // Adding/removing an option rebuilds this whole block rather than firing a
  // bubbling "input" event, so the live preview needs its own nudge here.
  scheduleLivePreview();
}

function collectFormIntoQuestion() {
  const q = currentQuestion;
  q.id = document.getElementById("fieldId").value.trim();
  q.type = document.getElementById("fieldType").value;
  q.section = document.getElementById("fieldSection").value;
  q.testSet = Number(document.getElementById("fieldTestSet").value) || 1;
  q.text = document.getElementById("fieldText").value.trim();
  q.explanation = document.getElementById("fieldExplanation").value.trim();

  if (q.type === "fillblank") {
    q.correct = [document.getElementById("fillblankAnswer").value.trim()];
    const clue = document.getElementById("fillblankClue").value.trim();
    if (clue) q.clue = clue;
    else delete q.clue;
    delete q.options;
  } else {
    document.querySelectorAll(".opt-id-input").forEach((inp) => {
      q.options[Number(inp.dataset.idx)].id = inp.value.trim();
    });
    document.querySelectorAll(".opt-text-input").forEach((inp) => {
      q.options[Number(inp.dataset.idx)].text = inp.value.trim();
    });
    document.querySelectorAll(".opt-expl-input").forEach((inp) => {
      const val = inp.value.trim();
      if (val) q.options[Number(inp.dataset.idx)].explanation = val;
      else delete q.options[Number(inp.dataset.idx)].explanation;
    });
    if (q.type === "ordering") {
      q.correct = document
        .getElementById("orderingCorrect")
        .value.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return q;
}

function validateQuestion(q) {
  const errors = [];
  if (!q.id) errors.push("ID is required.");
  else if (!/^[a-zA-Z0-9_-]+$/.test(q.id)) errors.push("ID should only contain letters, numbers, - and _.");
  if (!q.text) errors.push("Question text is required.");
  if (!q.explanation) errors.push("Explanation is required.");

  if (q.type === "fillblank") {
    if (!q.correct[0]) errors.push("Fill-in-the-blank needs an accepted answer.");
  } else {
    if (!q.options || q.options.length < 2) errors.push("Needs at least 2 options.");
    else {
      const ids = q.options.map((o) => o.id);
      if (ids.some((id) => !id)) errors.push("Every option needs an ID.");
      if (new Set(ids).size !== ids.length) errors.push("Option IDs must be unique.");
      if (q.options.some((o) => !o.text)) errors.push("Every option needs text.");
    }
    if (q.type === "ordering") {
      if (!q.correct.length || q.correct.length !== q.options.length) errors.push("Correct order must list every option id exactly once.");
    } else {
      if (!q.correct.length) errors.push("Mark at least one correct option.");
      if (q.type === "single" && q.correct.length !== 1) errors.push("Single-choice needs exactly one correct option.");
      if (q.type === "truefalse" && q.options.length !== 2) errors.push("True/False needs exactly 2 options.");
    }
  }
  return errors;
}

// ---------- Save / delete ----------
async function saveQuestion() {
  const q = collectFormIntoQuestion();
  const statusEl = document.getElementById("formStatus");
  const errors = validateQuestion(q);
  if (errors.length) {
    setStatus(statusEl, "error", "Can't save: " + errors.join(" "));
    return;
  }

  if (isNewQuestion) {
    if (ALL_QUESTIONS.some((x) => x.id === q.id)) {
      setStatus(statusEl, "error", `Question id "${q.id}" already exists — pick a unique id.`);
      return;
    }
    ALL_QUESTIONS.push(q);
  }
  // For an existing question, `q` (== currentQuestion) is already a live
  // reference into ALL_QUESTIONS, so the array is already up to date.

  setStatus(statusEl, "info", "Saving to GitHub...");
  try {
    await commitQuestions(`${isNewQuestion ? "Add" : "Edit"} ${q.id} via admin panel`);
    isNewQuestion = false;
    setStatus(statusEl, "ok", "Saved! Live on the site in about 10 minutes.");
    renderSearchList();
  } catch (err) {
    setStatus(statusEl, "error", "Save failed: " + err.message);
  }
}

async function deleteQuestion() {
  if (!confirm(`Delete ${currentQuestion.id}? This can't be undone from here.`)) return;
  const id = currentQuestion.id;
  ALL_QUESTIONS = ALL_QUESTIONS.filter((x) => x.id !== id);
  const statusEl = document.getElementById("formStatus");
  setStatus(statusEl, "info", "Deleting on GitHub...");
  try {
    await commitQuestions(`Delete ${id} via admin panel`);
    document.getElementById("formCard").style.display = "none";
    currentQuestion = null;
    setStatus(statusEl, "ok", "Deleted.");
    renderSearchList();
  } catch (err) {
    setStatus(statusEl, "error", "Delete failed: " + err.message);
  }
}

// ---------- GitHub commit — low-level Git Data API (blob/tree/commit/ref),
// not the simple Contents API PUT, so this always works regardless of how
// large questions.json grows. ----------
async function ghApi(path, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}${path}`, {
    ...options,
    headers: { ...ghHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function commitQuestions(message) {
  const newContent = JSON.stringify(ALL_QUESTIONS, null, 2);

  const ref = await ghApi(`/git/ref/heads/${BRANCH}`);
  const latestCommitSha = ref.object.sha;

  const commit = await ghApi(`/git/commits/${latestCommitSha}`);
  const baseTreeSha = commit.tree.sha;

  const blob = await ghApi(`/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: newContent, encoding: "utf-8" }),
  });

  const tree = await ghApi(`/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [{ path: FILE_PATH, mode: "100644", type: "blob", sha: blob.sha }],
    }),
  });

  const newCommit = await ghApi(`/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [latestCommitSha] }),
  });

  await ghApi(`/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return newCommit;
}

// ---------- Small helpers ----------
function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
function setStatus(el, kind, msg) {
  el.style.display = "block";
  el.className = "admin-status " + kind;
  el.textContent = msg;
}

// ---------- Boot ----------
function boot() {
  loadFormatters(); // fire-and-forget, so it's already cached by the time a question is opened
  const existing = getToken();
  if (existing) {
    document.getElementById("tokenInput").value = existing;
    document.getElementById("loadCard").style.display = "block";
  }
  document.getElementById("saveTokenBtn").addEventListener("click", () => {
    const t = document.getElementById("tokenInput").value.trim();
    if (!t) return;
    setToken(t);
    document.getElementById("loadCard").style.display = "block";
    setStatus(document.getElementById("tokenStatus"), "ok", "Token saved in this browser.");
  });
  document.getElementById("clearTokenBtn").addEventListener("click", () => {
    clearToken();
    document.getElementById("tokenInput").value = "";
    document.getElementById("loadCard").style.display = "none";
    document.getElementById("editorArea").style.display = "none";
  });
  document.getElementById("loadBtn").addEventListener("click", loadQuestions);
  document.getElementById("newQuestionBtn").addEventListener("click", newQuestion);
  document.getElementById("searchInput").addEventListener("input", renderSearchList);
  document.getElementById("testFilter").addEventListener("change", renderSearchList);
  document.getElementById("sectionFilter").addEventListener("change", renderSearchList);
}
boot();
