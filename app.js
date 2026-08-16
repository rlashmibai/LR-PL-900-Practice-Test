// PL-900 Practice Test — local prototype (localStorage-based)
// Data layer is isolated in the DB object so it can be swapped for Firebase later
// without touching the UI/quiz-engine code below.

const SECTION_TEST_MINUTES = 15;
const PASS_PERCENT = 70;
const TEST_SET_COUNT = 12;
const TEST_SET_MINUTES = 50; // ~1 min/question, matching real PL-900 exam pacing

// Official PL-900 exam skill weights, shown next to each topic on the dashboard
const EXAM_WEIGHTS = {
  "Describe the business value of Microsoft Power Platform": "5–10%",
  "Manage the Microsoft Power Platform environment": "20–25%",
  "Demonstrate the capabilities of Power Apps": "20–25%",
  "Demonstrate the capabilities of Power Automate": "20–25%",
  "Describe features and capabilities of agents in Microsoft Copilot Studio": "20–25%",
};

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
  document.querySelector(".container").classList.toggle("wide", viewId === "view-test");
}

function setUserChip() {
  const user = DB.getUser();
  const chip = document.getElementById("userChip");
  chip.textContent = user ? `${user.name} · ${user.email}` : "";
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, "");
}

// ---------- Explanation formatting (best-effort reconstruction of structure) ----------
// Source explanations vary: some are already written with real \n\n paragraph breaks
// (anything we authored ourselves), others got flattened into one run-on string during
// doc import (no newlines at all). This does its best to rebuild headings, numbered
// lists, and bullet lists from whatever structure survived, and auto-links bare URLs.
// IMPORTANT: never list both a word and its own prefix here (e.g. "Reference" AND
// "References") — the shorter one will re-match *inside* text the longer one already
// produced, orphaning the remainder (this caused the "R" / "eferences ..." bug).
// Colon-suffixed singular forms are safe to keep alongside colon-less plurals since
// the colon makes them distinct substrings that can't collide.
const EXPL_HEADERS = [
  "Overall explanation", "References:", "Reference:", "References",
  "Exam Tips:", "Exam Tip:",
  "Recommended Youtube Video:", "Recommended YouTube video:", "Recommended Youtube Video", "Recommended YouTube video",
  "Keep in Mind:", "Keep in Mind", "Study Links:", "Study links:", "Study Links", "Study links",
  "Remember,", "Remember:",
];

// Recurring section-header phrases that have variable trailing content (so they
// can't just be exact strings in EXPL_HEADERS), confirmed by scanning the whole
// question bank for genuinely repeated patterns — not a generic "any Title Case
// phrase" rule, which mostly false-positives on product names like "Power
// Automate" mid-sentence. Each captures its own variable suffix (e.g. "Advantages
// of Using TLS") so the real heading text is preserved, just isolated onto its
// own line and bolded like the fixed EXPL_HEADERS.
const EXPL_HEADER_PATTERNS = [
  // Bare "Exam Tip" / "Exam Tips" (no colon) as one atomic pattern — listing
  // both forms separately in EXPL_HEADERS would have the shorter one
  // ("Exam Tip") re-match *inside* text the longer one ("Exam Tips") already
  // isolated, orphaning the trailing "s" (the exact bug that hit
  // References/Reference earlier this project). The colon-suffixed forms
  // above stay in EXPL_HEADERS since the colon makes them distinct strings.
  /\bExam Tips?\b/g,
  /Why Other[s]?(?: Answers?| Options?)?\s*(?:Are|Is)\s*(?:Correct|Incorrect|Wrong|Right)\b/gi,
  /Advantages of (?:[A-Z][a-zA-Z]*|and|of|for|the|in|to|on|or|using)(?:\s(?:[A-Z][a-zA-Z]*|and|of|for|the|in|to|on|or|using)){0,4}(?=\s[A-Z][a-z])/g,
  /Benefits of (?:[A-Z][a-zA-Z]*|and|of|for|the|in|to|on|or|using)(?:\s(?:[A-Z][a-zA-Z]*|and|of|for|the|in|to|on|or|using)){0,4}(?=\s[A-Z][a-z])/g,
  /Challenges (?:in|of|with) (?:[A-Z][a-zA-Z]*|and|of|for|the|in|to|on|or)(?:\s(?:[A-Z][a-zA-Z]*|and|of|for|the|in|to|on|or)){0,4}(?=\s[A-Z][a-z])/g,
  /Potential Downsides(?: to (?:[A-Z][a-zA-Z]*|and|of|for|the|in|to|on|or|all)(?:\s(?:[A-Z][a-zA-Z]*|and|of|for|the|in|to|on|or|all)){0,6})?(?=\s[A-Z][a-z])/g,
  /Key Focus Area\b/g,
  /Common Confusion(?: to Avoid)?\b/g,
  /Why (?:It|This) Matters\b/g,
  /Simple Example\b/g,
];

function linkify(text) {
  // Some explanations already contain real <a href="..."> links (recovered
  // straight from the source docs), and some of THOSE have the raw URL itself
  // as the visible label rather than a nice title. A lookbehind on href="
  // alone only protects the attribute value — it does nothing for a bare URL
  // sitting as an anchor's own inner text, which this regex would happily
  // wrap in a second, nested <a>. So pull out every existing <a>...</a> tag
  // first (protecting both its href AND its label) and only linkify what's
  // left, regardless of what shape the pre-existing links take.
  const anchors = [];
  const withoutLinks = text.replace(/<a\s[^>]*>.*?<\/a>/g, (m) => {
    anchors.push(m);
    return `\x00LINK${anchors.length - 1}\x00`;
  });
  const linked = withoutLinks.replace(/(https?:\/\/[^\s<"]+)/g, (url) => {
    const clean = url.replace(/[.,;:)]+$/, "");
    const trailing = url.slice(clean.length);
    let label = clean.replace(/^https?:\/\//, "");
    if (label.length > 55) label = label.slice(0, 52) + "...";
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${label}</a>${trailing}`;
  });
  return linked.replace(/\x00LINK(\d+)\x00/g, (_, i) => anchors[Number(i)]);
}

// Detects " * item * item * item" style bullets within a block of text.
function formatBullets(text) {
  const parts = text.split(/\s\*\s(?=\S)/);
  if (parts.length < 3) return null; // need at least 2 real bullet items
  const before = parts.shift().trim();
  return (before ? `<p>${linkify(before)}</p>` : "") + `<ul>${parts.map((p) => `<li>${linkify(p.trim())}</li>`).join("")}</ul>`;
}

// Detects "1. foo 2. bar 3. baz" style numbered lists within a block of text.
// The source data sometimes loses the leading "1." (it got consumed elsewhere
// during import), leaving a list that reads "2. ... 3. ... 4. ..." — still a
// real list, just missing its first marker — so this only requires 3+ RUNS of
// consecutive integers, not that the run starts at 1.
function formatNumbered(text) {
  const matches = [...text.matchAll(/(?:^|\s)(\d{1,2})[.)]\s/g)];
  const nums = matches.map((m) => parseInt(m[1], 10));
  const sequential = nums.length >= 3 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (!sequential) return null;

  const before = text.slice(0, matches[0].index).trim();
  const items = matches.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const itemText = text.slice(start, end).trim();
    return formatBullets(itemText) || `<li>${linkify(itemText)}</li>`;
  });
  // formatBullets() already returns full <ul> markup for items that contain sub-bullets;
  // wrap plain items in <li>, leave sub-list items as-is inside their own <li>.
  const html = items
    .map((it) => (it.startsWith("<ul>") || it.startsWith("<p>") ? `<li>${it}</li>` : it))
    .join("");
  // Recursively format the lead-in text too (it's often itself a run of short
  // "Term - definition." clauses that read much better one per line) instead
  // of dumping it into one dense paragraph.
  return (before ? formatSentences(before) : "") + `<ol>${html}</ol>`;
}

// Detects "A. foo B. bar D. baz" style lettered lists within a block of text
// (common where an explanation discusses several answer options by letter).
// Letters don't need to be perfectly consecutive — a discussion might skip a
// letter whose option didn't need explaining — just increasing, and each
// marker must be followed by a capitalized word so a stray "A." mid-sentence
// can't false-trigger this.
function formatLettered(text) {
  const matches = [...text.matchAll(/(?:^|\s)([A-H])[.)]\s(?=[A-Z])/g)];
  if (matches.length < 2) return null;
  const codes = matches.map((m) => m[1].charCodeAt(0));
  const increasing = codes.every((c, i) => i === 0 || c > codes[i - 1]);
  if (!increasing) return null;

  const before = text.slice(0, matches[0].index).trim();
  const items = matches.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const itemText = text.slice(start, end).trim();
    return `<li><strong>${m[1]}.</strong> ${linkify(itemText)}</li>`;
  });
  return (before ? formatSentences(before) : "") + `<ul class="lettered-list">${items.join("")}</ul>`;
}

// Detects a short (1-4 word) Title Case phrase glued directly onto the
// sentence that follows it by \xa0 (non-breaking space) instead of a real
// line break — a real, if easy to miss, structural signal preserved from the
// source docs. \xa0 also shows up throughout this content for perfectly
// ordinary spacing though, so this alone isn't trusted as proof of a heading;
// see the 3+ occurrence check in formatSentences below.
function splitEmbeddedTitle(sentence) {
  // Anchored at start-of-string OR right after ": "/". " so a leading intro
  // clause (e.g. "10 Use Cases for X: Troubleshooting Assistance The chatbot...")
  // doesn't hide the first item's title from matching — only what comes after
  // that point needs to look like a title, not the whole sentence.
  const m = sentence.match(/(?:^|[:.]\s)((?:[A-Z][a-zA-Z]*)(?:\s(?:[A-Z][a-zA-Z]*|and|of|for|the|in|to|on|or)){0,3})\xa0(?=[A-Z][a-z])([\s\S]*)$/);
  if (!m) return null;
  const title = m[1].trim();
  const words = title.split(/\s+/);
  if (words.length === 1 && ["A", "An", "The", "I", "It", "This", "That"].includes(words[0])) return null;
  const titleStart = sentence.indexOf(title, m.index);
  return { prefix: sentence.slice(0, titleStart).trim(), title, rest: m[2] };
}

// Splits a run of prose into one <p> per sentence, so a long explanation reads
// as short, scannable lines instead of one dense paragraph. Existing <a> tags
// are pulled out first so a period inside a link's own visible text (rare,
// but possible) can never split the tag itself in half.
function formatSentences(text) {
  const anchors = [];
  const safe = text.replace(/<a [^>]*>.*?<\/a>/g, (m) => {
    anchors.push(m);
    return `\x00A${anchors.length - 1}\x00`;
  });
  const sentences = safe
    .split(/(?<=[a-z0-9\)"']\.)\s+(?=[A-Z])/g)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length < 2) return `<p>${linkify(text)}</p>`;

  // Named-list detection: if the same "Title\xa0Sentence" shape shows up 3+
  // times in this one explanation, it's a deliberate list of named items
  // (e.g. "10 Use Cases..." each with its own label) whose structure got
  // flattened on import — bold each title in place. A single match elsewhere
  // is left untouched, since on its own it's far more likely an incidental
  // product name than a real heading.
  const splits = sentences.map(splitEmbeddedTitle);
  const titleCount = splits.filter(Boolean).length;

  return sentences
    .map((s, i) => {
      const split = titleCount >= 3 ? splits[i] : null;
      const body = split ? `${split.prefix ? split.prefix + " " : ""}<strong>${split.title}</strong> ${split.rest.trim()}` : s;
      return `<p>${linkify(body.replace(/\x00A(\d+)\x00/g, (_, i2) => anchors[Number(i2)]))}</p>`;
    })
    .join("");
}

function formatBlock(p) {
  return formatNumbered(p) || formatLettered(p) || formatBullets(p) || formatSentences(p);
}

// Splits one side of a matching question ("A. Item, B. Item" or "item; item; item")
// into individual {marker, text} entries, preferring explicit letter/number
// markers when present and falling back to semicolon- or comma-separated items.
function splitMatchItems(raw) {
  const letterMatches = [...raw.matchAll(/(?:^|\s)([A-H])[.)]\s(?=[A-Za-z])/g)];
  if (letterMatches.length >= 2) {
    return letterMatches.map((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < letterMatches.length ? letterMatches[i + 1].index : raw.length;
      return { marker: m[1], text: raw.slice(start, end).replace(/[,.]\s*$/, "").trim() };
    });
  }
  const numMatches = [...raw.matchAll(/(?:^|\s)(\d)[.)]\s(?=[A-Za-z])/g)];
  if (numMatches.length >= 2) {
    return numMatches.map((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < numMatches.length ? numMatches[i + 1].index : raw.length;
      return { marker: m[1], text: raw.slice(start, end).replace(/[,.]\s*$/, "").trim() };
    });
  }
  const parts = raw.includes(";") ? raw.split(";") : raw.split(",");
  return parts
    .map((s) => s.replace(/\.\s*$/, "").trim())
    .filter(Boolean)
    .map((t) => ({ marker: null, text: t }));
}

// "Match each X to Y" stems name exactly two lists ("Types: A. ... B. ..." /
// "Descriptions: ... ; ...") — this pulls those two lists apart and lays them
// out as a real two-column table, one row per item, IN THE ORDER GIVEN (never
// cross-matched to the correct answer — that would hand out the answer before
// you've attempted the question). Only fires when there are exactly two
// "Label:" sections and both sides have the same, matchable item count;
// anything messier falls back to the simple line-per-item layout below, which
// is always safe.
function formatMatchingTable(text) {
  const labelMatches = [...text.matchAll(/\b([A-Z][a-zA-Z]*(?:\s[a-zA-Z]+){0,2}):\s/g)];
  if (labelMatches.length !== 2) return null;

  const introText = text.slice(0, labelMatches[0].index).trim();
  const leftLabel = labelMatches[0][1];
  const leftRaw = text.slice(labelMatches[0].index + labelMatches[0][0].length, labelMatches[1].index).trim();
  const rightLabel = labelMatches[1][1];
  const rightRaw = text.slice(labelMatches[1].index + labelMatches[1][0].length).trim();

  const leftItems = splitMatchItems(leftRaw);
  const rightItems = splitMatchItems(rightRaw);
  if (leftItems.length < 2 || rightItems.length < 2 || leftItems.length !== rightItems.length) return null;

  const rows = leftItems
    .map((l, i) => {
      const r = rightItems[i];
      const leftMark = l.marker || String.fromCharCode(65 + i);
      const rightMark = r.marker || String(i + 1);
      return `<tr><td><strong>${leftMark}.</strong> ${l.text}</td><td><strong>${rightMark}.</strong> ${r.text}</td></tr>`;
    })
    .join("");

  return `
    ${introText ? `<p class="match-intro">${introText}</p>` : ""}
    <table class="match-table">
      <thead><tr><th>Left: ${leftLabel}</th><th>Right: ${rightLabel}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// "Match each X to Y" question stems arrive as one dense run-on paragraph
// ("Apps: Power Apps, Power Automate. Scenarios: A. ... B. ... C. ...").
// Tries the real two-column table first; if the text doesn't cleanly split
// into two equal-length lists, falls back to one line per label/item instead
// — still far more readable than the original run-on, just not a table.
// Only ever called for question text starting with "Match each"/"Match the
// following", and always falls back to the untouched original if neither
// approach finds real list structure, so it can never make an ordinary
// question worse.
function formatMatchingQuestionText(text) {
  if (!/^match (each|the following)/i.test(text.trim())) return text;

  const table = formatMatchingTable(text);
  if (table) return table;

  let working = text;
  working = working.replace(/\s*\b([A-Z][a-zA-Z]*(?:\s[a-zA-Z]+){0,2}):\s/g, "\n$1: ");
  working = working.replace(/\s([A-H])\.\s(?=[A-Z])/g, "\n$1. ");
  working = working.replace(/;\s*/g, "\n");
  const lines = working
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length < 3) return text;
  return lines.map((l) => `<div class="match-line">${l}</div>`).join("");
}

function formatExplanation(raw) {
  if (!raw) return "";

  // Arrow characters (from source docx bullets like "Manager -> Approves") render
  // inconsistently across fonts/platforms; a plain ASCII arrow is more reliable.
  raw = raw.replace(/→|➔|➡/g, "->");

  // Pull out any embedded <img> tags so they don't get mangled, restore them after.
  // The placeholder uses \x00 (a character .trim()/whitespace regexes never touch)
  // rather than plain spaces — an image sitting at the very end of a paragraph would
  // otherwise have its trailing space stripped by the .trim() below, leaving the
  // restore regex with nothing to match and a literal " IMG0" leaking into the output.
  const imgTags = [];
  let text = raw.replace(/<img[^>]*>/g, (m) => {
    imgTags.push(m);
    return `\x00IMG${imgTags.length - 1}\x00`;
  });

  // Break known section headers onto their OWN isolated paragraph (blank line on both
  // sides) so they render as sub-headings rather than getting merged into body text.
  const headerNames = new Set(EXPL_HEADERS.map((h) => h.replace(/:$/, "")));
  EXPL_HEADERS.forEach((h) => {
    text = text.split(h).join(`\n\n${h.replace(/:$/, "")}\n\n`);
  });

  // Same idea for headers with variable trailing content ("Advantages of Using
  // TLS", "Why Other Options Are Incorrect") — isolate onto their own paragraph,
  // wrapped in a \x02...\x02 sentinel since the captured text varies per match
  // and can't be looked up in the fixed headerNames set below.
  EXPL_HEADER_PATTERNS.forEach((re) => {
    text = text.replace(re, (m) => `\n\n\x02${m.trim()}\x02\n\n`);
  });

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  // A paragraph becomes a heading if its entire (trimmed) content is exactly one
  // of the known header names, or the whole thing is a \x02-wrapped dynamic
  // header — never just "the first character of any paragraph" (that was the
  // earlier bug: every paragraph got its first letter sliced off).
  let html = paragraphs
    .map((p) => {
      if (headerNames.has(p)) return `<h4 class="expl-heading">${p}</h4>`;
      const dynamicHeading = p.match(/^\x02(.+)\x02$/);
      if (dynamicHeading) return `<h4 class="expl-heading">${dynamicHeading[1]}</h4>`;
      return formatBlock(p);
    })
    .join("");

  html = html.replace(/\x00IMG(\d+)\x00/g, (_, i) => imgTags[Number(i)]);

  // Consecutive reference links separated by only a space (common in
  // "References"/"Recommended Video" sections with several links in a row)
  // have touching underlines with no visible gap, reading as one merged link.
  // Break each back-to-back link onto its own line.
  html = html.replace(/<\/a>\s+(?=<a )/g, "</a><br>");

  return html;
}

// Builds "why each option is right/wrong" + the Overall Explanation card,
// shared by Practice mode's post-check reveal and the Results review list.
// Per-option explanations only exist for single/multi/truefalse questions
// re-matched back to their source doc; anything else (or a question with no
// recovered per-option text) just falls back to the Overall Explanation alone.
function renderExplanationBreakdown(q, given) {
  const hasOptionExpl =
    (q.type === "single" || q.type === "multi" || q.type === "truefalse") &&
    Array.isArray(q.options) &&
    q.options.some((o) => o.explanation);

  let optionsHtml = "";
  if (hasOptionExpl) {
    optionsHtml =
      `<div class="option-breakdown">` +
      q.options
        .map((opt) => {
          const isCorrect = q.correct.includes(opt.id);
          const wasGiven = given.includes(opt.id);
          let cls = "option-expl-item";
          if (isCorrect) cls += " correct";
          else if (wasGiven) cls += " incorrect";
          const tag = isCorrect ? "Correct answer" : wasGiven ? "Your answer" : "";
          const mark = isCorrect ? "✓" : wasGiven ? "✗" : "";
          return `
            <div class="${cls}">
              <div class="option-expl-label">${mark ? `<span class="option-expl-mark">${mark}</span> ` : ""}${opt.text}${
                tag ? `<span class="option-expl-tag">${tag}</span>` : ""
              }</div>
              ${opt.explanation ? `<div class="option-expl-text">${formatExplanation(opt.explanation)}</div>` : ""}
            </div>`;
        })
        .join("") +
      `</div>`;
  }

  return `
    ${optionsHtml}
    <div class="explanation-card">
      <div class="explanation-title">${hasOptionExpl ? "Overall Explanation" : "Explanation"}</div>
      <div class="explanation-body">${formatExplanation(q.explanation)}</div>
    </div>
  `;
}

// ---------- Boot ----------
// Deter casual copying of question content: block the context menu, text
// selection, and copy/cut/paste. Not a real security boundary (view-source
// still works), just friction against right-click-and-copy.
document.addEventListener("contextmenu", (e) => e.preventDefault());
const inField = (e) => e.target.closest && e.target.closest("input, textarea");
document.addEventListener("selectstart", (e) => { if (!inField(e)) e.preventDefault(); });
document.addEventListener("copy", (e) => { if (!inField(e)) e.preventDefault(); });
document.addEventListener("cut", (e) => { if (!inField(e)) e.preventDefault(); });
document.addEventListener("paste", (e) => { if (!inField(e)) e.preventDefault(); });

async function boot() {
  // Load the question bank defensively: if this fetch fails or the response is
  // malformed (flaky connection, offline, etc.), fall back to an empty array
  // instead of throwing — an uncaught rejection here would abort boot() before
  // ANY event listener below got wired up, silently breaking every button on
  // the site (not just test-taking), including nav that doesn't even need
  // question data. A visible banner tells the visitor to refresh instead.
  try {
    const res = await fetch("questions.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ALL_QUESTIONS = await res.json();
  } catch (err) {
    console.error("Failed to load questions.json:", err);
    ALL_QUESTIONS = [];
  }

  const user = DB.getUser();
  if (user) {
    setUserChip();
    renderDashboard();
    show("view-dashboard");
  } else {
    show("view-home");
  }

  // Header brand name doubles as a home link from anywhere in the app
  const goHome = () => {
    if (session && document.getElementById("view-test").classList.contains("active")) {
      goHomeFromTest();
    } else {
      show(DB.getUser() ? "view-dashboard" : "view-home");
      if (DB.getUser()) renderDashboard();
    }
  };
  document.getElementById("appHomeLink").addEventListener("click", goHome);

  // Header About / Contact links, available from anywhere in the app
  document.getElementById("headerAboutBtn").addEventListener("click", () => show("view-about"));
  document.getElementById("headerContactBtn").addEventListener("click", () => show("view-contact"));
  document.getElementById("aboutGoHomeBtn").addEventListener("click", goHome);
  document.getElementById("contactGoHomeBtn").addEventListener("click", goHome);
  document.getElementById("contactForm").addEventListener("submit", onContactSubmit);

  // Footer legal pages, available from anywhere in the app
  document.getElementById("footerDisclaimerBtn").addEventListener("click", () => show("view-disclaimer"));
  document.getElementById("footerPrivacyBtn").addEventListener("click", () => show("view-privacy"));
  document.getElementById("footerCookieBtn").addEventListener("click", () => show("view-cookies"));
  document.getElementById("disclaimerGoHomeBtn").addEventListener("click", goHome);
  document.getElementById("privacyGoHomeBtn").addEventListener("click", goHome);
  document.getElementById("cookiesGoHomeBtn").addEventListener("click", goHome);

  document.getElementById("welcomeForm").addEventListener("submit", onWelcomeSubmit);
  document.getElementById("logoutBtn").addEventListener("click", () => {
    DB.clearUser();
    setUserChip();
    show("view-home");
  });

  // Home page -> Choose Test page (no sign-in required to start any test)
  const goToChooseTest = () => {
    renderTestGrid("chooseTimedGrid", "deferred");
    renderTestGrid("choosePracticeGrid", "immediate");
    show("view-choose-test");
  };
  document.getElementById("homeReadyBtn").addEventListener("click", goToChooseTest);
  document.getElementById("homeGoToLoginBtn").addEventListener("click", () => show("view-welcome"));
  document.getElementById("chooseTestGoHomeBtn").addEventListener("click", () => show("view-home"));
  document.getElementById("chooseTestLoginBtn").addEventListener("click", () => show("view-welcome"));

  document.getElementById("submitTestBtn").addEventListener("click", onSubmitTest);
  document.getElementById("prevQBtn").addEventListener("click", () => gotoQuestion(session.index - 1));
  document.getElementById("nextQBtn").addEventListener("click", () => gotoQuestion(session.index + 1));
  document.getElementById("testCancelBtn").addEventListener("click", () => cancelTest());
  document.getElementById("backToDashBtn").addEventListener("click", () => {
    if (DB.getUser()) {
      renderDashboard();
      show("view-dashboard");
    } else {
      show("view-home");
    }
  });

  if (ALL_QUESTIONS.length === 0) {
    const banner = document.createElement("div");
    banner.className = "card load-error-banner";
    banner.innerHTML = `⚠️ The question bank didn't load (connection hiccup). <button id="reloadQuestionsBtn" class="btn small">Refresh</button>`;
    document.querySelector(".container").prepend(banner);
    document.getElementById("reloadQuestionsBtn").addEventListener("click", () => location.reload());
  }

  // Floating back-to-top button — shows once you've scrolled, works on every page
  const backToTopBtn = document.getElementById("backToTopBtn");
  window.addEventListener("scroll", () => {
    backToTopBtn.classList.toggle("visible", window.scrollY > 400);
  });
  backToTopBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

function goHomeFromTest() {
  if (!confirm("Leave this test? Your progress on this attempt will be lost.")) return;
  clearInterval(session && session.timerHandle);
  show(DB.getUser() ? "view-dashboard" : "view-home");
  if (DB.getUser()) renderDashboard();
}

function cancelTest() {
  if (!confirm("Cancel this test? Your progress on this attempt will be lost.")) return;
  clearInterval(session && session.timerHandle);
  if (DB.getUser()) {
    renderDashboard();
    show("view-dashboard");
  } else {
    show("view-home");
  }
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

// ---------- Contact form (delivered via FormSubmit.co — free, no backend needed) ----------
async function onContactSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("contactName").value.trim();
  const email = document.getElementById("contactEmail").value.trim();
  const message = document.getElementById("contactMessage").value.trim();
  const status = document.getElementById("contactStatus");
  const btn = document.getElementById("contactSubmitBtn");

  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !message) {
    status.textContent = "Please fill in your name, a valid email, and a message.";
    status.className = "contact-status error";
    return;
  }

  btn.disabled = true;
  status.textContent = "Sending...";
  status.className = "contact-status sending";

  try {
    const res = await fetch("https://formsubmit.co/ajax/rlashmibai@gmail.com", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name,
        email,
        message,
        _subject: `LR PL900 Practice Test — feedback from ${name}`,
      }),
    });
    if (!res.ok) throw new Error("Request failed");
    status.textContent = "Thanks! Your message has been sent.";
    status.className = "contact-status ok";
    document.getElementById("contactForm").reset();
  } catch (err) {
    status.textContent = "Something went wrong sending that. Please try again in a moment.";
    status.className = "contact-status error";
  } finally {
    btn.disabled = false;
  }
}

// ---------- Dashboard ----------
function getSections() {
  return [...new Set(ALL_QUESTIONS.map((q) => q.section))];
}

// Renders the 12 test-set buttons (shared by the no-login Choose Test page and the
// signed-in Dashboard) into the given container element id.
function renderTestGrid(containerId, feedbackMode) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = "";
  for (let n = 1; n <= TEST_SET_COUNT; n++) {
    const count = ALL_QUESTIONS.filter((q) => q.testSet === n).length;
    const btn = document.createElement("button");
    btn.className = "test-tile";
    btn.innerHTML = `<div class="test-tile-num">PL900 Practice Test ${n}</div><div class="test-tile-sub">${count} questions</div>`;
    btn.addEventListener("click", () => startTest("testset", n, feedbackMode));
    grid.appendChild(btn);
  }
}

function renderDashboard() {
  const user = DB.getUser();
  document.getElementById("dashGreeting").textContent = `Welcome back, ${user.name}!`;

  renderTestGrid("dashTimedGrid", "deferred");
  renderTestGrid("dashPracticeGrid", "immediate");

  // Section buttons — topic practice always uses immediate (practice-test) feedback
  const sections = getSections();
  const list = document.getElementById("sectionList");
  list.innerHTML = "";
  sections.forEach((sec) => {
    const count = ALL_QUESTIONS.filter((q) => q.section === sec).length;
    const row = document.createElement("div");
    row.className = "section-item";
    const weight = EXAM_WEIGHTS[sec] ? ` (${EXAM_WEIGHTS[sec]})` : "";
    row.innerHTML = `
      <div>
        <div>${sec}${weight}</div>
        <div class="count">${count} question${count === 1 ? "" : "s"}</div>
      </div>
      <button class="btn secondary" data-section="${sec}">Practice this topic</button>
    `;
    row.querySelector("button").addEventListener("click", () => startTest("section", sec, "immediate"));
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

// ---------- Scoring helper ----------
// "ordering" questions are order-sensitive; every other type is a set comparison
// (so answer order for multi-select doesn't matter, but sequence does for ordering).
function isAnswerCorrect(q, given) {
  if (!given || given.length === 0) return false;
  if (q.type === "ordering") {
    return given.length === q.correct.length && given.every((v, i) => v === q.correct[i]);
  }
  if (q.type === "fillblank") {
    return given[0].trim().toLowerCase() === q.correct[0].trim().toLowerCase();
  }
  const a = [...given].sort();
  const b = [...q.correct].sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ---------- Test engine ----------
// feedbackMode: "deferred" (Timed Test — answers/explanations shown only at the end)
//            or "immediate" (Practice Test — check each answer as you go)
function startTest(mode, param, feedbackMode) {
  let questions;
  let minutes;
  let modeLabel;
  let testName;

  if (mode === "testset") {
    // Fixed order (sorted by id, same numeric sort the admin panel uses) rather
    // than shuffled, so "Question #N" always refers to the same question every
    // attempt and matches the same question's position in the admin panel.
    questions = sortById(ALL_QUESTIONS.filter((q) => q.testSet === param));
    minutes = TEST_SET_MINUTES;
    testName = `PL900 Practice Test ${param}`;
    modeLabel = `${testName} (${feedbackMode === "immediate" ? "Practice" : "Timed"})`;
  } else {
    questions = shuffle(ALL_QUESTIONS.filter((q) => q.section === param));
    minutes = SECTION_TEST_MINUTES;
    testName = param;
    modeLabel = param;
  }

  session = {
    mode: modeLabel,
    feedbackMode, // "deferred" | "immediate"
    questions,
    index: 0,
    answers: {}, // qid -> array of selected option ids (order matters for "ordering" type)
    checked: {}, // qid -> true once "Check Answer" has been clicked (immediate mode only)
    flagged: new Set(),
    visited: new Set(), // qid -> seen at least once; visited-but-unanswered = "skipped", never-visited = blank
    startedAt: Date.now(),
    timerMode: feedbackMode === "immediate" ? "countup" : "countdown",
    durationSec: minutes * 60,
    remainingSec: minutes * 60,
    elapsedSec: 0,
    timerHandle: null,
  };

  document.getElementById("modeBadge").textContent = feedbackMode === "immediate" ? "Practice mode" : "Timed exam mode";
  document.getElementById("modeBadge").className = "mode-badge " + (feedbackMode === "immediate" ? "practice" : "timed");
  document.getElementById("testNameLabel").textContent = testName;

  renderQuestionSidebar();
  renderNavGrid();
  renderQuestion();
  startTimer();
  show("view-test");
}

// Numeric-aware sort by id (q2 before q10, not after) — mirrors the same sort
// admin.js uses for its question list, so position numbers line up exactly.
function sortById(arr) {
  return [...arr].sort((a, b) => {
    const aNum = parseInt((a.id.match(/\d+/) || [0])[0], 10);
    const bNum = parseInt((b.id.match(/\d+/) || [0])[0], 10);
    return aNum - bNum || a.id.localeCompare(b.id);
  });
}

function shuffle(arr) {
  arr = [...arr];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function startTimer() {
  updateTimerDisplay();
  session.timerHandle = setInterval(() => {
    if (session.timerMode === "countdown") {
      session.remainingSec--;
      updateTimerDisplay();
      if (session.remainingSec <= 0) {
        clearInterval(session.timerHandle);
        finishTest();
      }
    } else {
      session.elapsedSec++;
      updateTimerDisplay();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById("timerDisplay");
  const sec = session.timerMode === "countdown" ? session.remainingSec : session.elapsedSec;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  el.textContent = `${m}:${String(s).padStart(2, "0")}`;
  el.classList.toggle("low", session.timerMode === "countdown" && session.remainingSec <= 60);
}

// ---------- Question sidebar (replaces the old numbered grid) ----------
function renderQuestionSidebar() {
  const list = document.getElementById("questionSidebarList");
  list.innerHTML = "";
  session.questions.forEach((q, i) => {
    const row = document.createElement("div");
    row.className = "sidebar-q-row";
    const preview = stripHtml(q.text);
    row.innerHTML = `
      <span class="sidebar-q-flag">🔖</span>
      <div class="sidebar-q-text">
        <div class="sidebar-q-num">Question ${i + 1}</div>
        <div class="sidebar-q-preview">${preview.length > 70 ? preview.slice(0, 70) + "…" : preview}</div>
      </div>
    `;
    row.addEventListener("click", () => gotoQuestion(i));
    list.appendChild(row);
  });
  updateQuestionSidebar();
}

function updateQuestionSidebar() {
  const list = document.getElementById("questionSidebarList");
  [...list.children].forEach((row, i) => {
    const q = session.questions[i];
    const given = session.answers[q.id];
    const answered = given && given.length > 0;
    row.className = "sidebar-q-row";
    if (i === session.index) row.classList.add("current");
    if (session.feedbackMode === "immediate" && session.checked[q.id]) {
      row.classList.add(isAnswerCorrect(q, given) ? "correct" : "incorrect");
    } else if (answered) {
      row.classList.add("answered");
    } else if (session.visited.has(q.id) && i !== session.index) {
      row.classList.add("skipped");
    }
    if (session.flagged.has(q.id)) row.classList.add("flagged");
  });

  const total = session.questions.length;
  document.getElementById("progressCount").textContent = `${session.index + 1}/${total}`;
  document.getElementById("progressBarFill").style.width = `${Math.round(((session.index + 1) / total) * 100)}%`;

  updateNavGrid();
}

// ---------- Compact overview grid (right side): complete / skipped / flagged ----------
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
    const given = session.answers[q.id];
    const answered = given && given.length > 0;
    btn.className = "";
    if (i === session.index) btn.classList.add("current");
    if (answered) btn.classList.add("complete");
    else if (session.visited.has(q.id) && i !== session.index) btn.classList.add("skipped");
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
  session.visited.add(q.id);
  document.getElementById("qTopicBar").textContent = q.section;
  document.getElementById("qNumberLabel").textContent = `Question #${session.index + 1}`;
  // innerHTML (not textContent) so a question can include an <img> if needed
  document.getElementById("questionText").innerHTML = formatMatchingQuestionText(q.text);

  const body = document.getElementById("questionBody");
  body.innerHTML = "";

  const selected = session.answers[q.id] || [];
  const locked = session.feedbackMode === "immediate" && session.checked[q.id];

  if (q.type === "single" || q.type === "truefalse") {
    q.options.forEach((opt) => {
      const div = document.createElement("div");
      let cls = "option";
      if (selected.includes(opt.id)) cls += " selected";
      if (locked) {
        cls += " locked";
        if (q.correct.includes(opt.id)) cls += " correct";
        else if (selected.includes(opt.id)) cls += " incorrect";
      }
      div.className = cls;
      div.innerHTML = `<input type="radio" ${selected.includes(opt.id) ? "checked" : ""} disabled /> ${opt.text}`;
      if (!locked) {
        div.addEventListener("click", () => {
          session.answers[q.id] = [opt.id];
          renderQuestion();
          updateQuestionSidebar();
        });
      }
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
      let cls = "option";
      if (selected.includes(opt.id)) cls += " selected";
      if (locked) {
        cls += " locked";
        if (q.correct.includes(opt.id)) cls += " correct";
        else if (selected.includes(opt.id)) cls += " incorrect";
      }
      div.className = cls;
      div.innerHTML = `<input type="checkbox" ${selected.includes(opt.id) ? "checked" : ""} disabled /> ${opt.text}`;
      if (!locked) {
        div.addEventListener("click", () => {
          const set = new Set(selected);
          set.has(opt.id) ? set.delete(opt.id) : set.add(opt.id);
          session.answers[q.id] = [...set];
          renderQuestion();
          updateQuestionSidebar();
        });
      }
      body.appendChild(div);
    });
  } else if (q.type === "fillblank") {
    if (q.clue) {
      const clue = document.createElement("div");
      clue.className = "question-meta";
      clue.style.marginBottom = "8px";
      clue.textContent = `Clue: ${q.clue}`;
      body.appendChild(clue);
    }
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type your answer";
    input.value = selected[0] || "";
    input.disabled = locked;
    if (locked) {
      input.classList.add(isAnswerCorrect(q, selected) ? "correct-input" : "incorrect-input");
    }
    input.addEventListener("input", () => {
      session.answers[q.id] = [input.value];
      updateQuestionSidebar();
      const checkBtn = document.querySelector("#checkAnswerArea button");
      if (checkBtn) checkBtn.disabled = input.value.trim().length === 0;
    });
    body.appendChild(input);
  } else if (q.type === "ordering") {
    const hint = document.createElement("div");
    hint.className = "question-meta";
    hint.style.marginBottom = "8px";
    hint.textContent = locked ? "Correct order shown below" : "Use the arrows to put these in the correct order";
    body.appendChild(hint);

    // Initialize order with option order the first time it's viewed
    let order = selected.length ? selected : q.options.map((o) => o.id);
    session.answers[q.id] = order;

    const ul = document.createElement("ul");
    ul.className = "order-list";
    order.forEach((optId, idx) => {
      const opt = q.options.find((o) => o.id === optId);
      const li = document.createElement("li");
      if (locked) li.className = optId === q.correct[idx] ? "correct" : "incorrect";
      li.innerHTML = `
        <span>${idx + 1}. ${opt.text}</span>
        ${
          locked
            ? ""
            : `<span class="order-btns">
                <button type="button" data-dir="up" ${idx === 0 ? "disabled" : ""}>↑</button>
                <button type="button" data-dir="down" ${idx === order.length - 1 ? "disabled" : ""}>↓</button>
              </span>`
        }
      `;
      if (!locked) {
        li.querySelector('[data-dir="up"]').addEventListener("click", () => moveOrderItem(q, idx, -1));
        li.querySelector('[data-dir="down"]').addEventListener("click", () => moveOrderItem(q, idx, 1));
      }
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
    updateQuestionSidebar();
  };

  // Check-answer / instant-feedback area (Practice Test mode only)
  const checkArea = document.getElementById("checkAnswerArea");
  checkArea.innerHTML = "";
  if (session.feedbackMode === "immediate") {
    if (!locked) {
      const hasAnswer = selected.length > 0;
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Check Answer";
      btn.disabled = !hasAnswer;
      btn.addEventListener("click", () => {
        session.checked[q.id] = true;
        renderQuestion();
        updateQuestionSidebar();
      });
      checkArea.appendChild(btn);
    } else {
      const given = session.answers[q.id] || [];
      const correct = isAnswerCorrect(q, given);
      const correctText =
        q.type === "fillblank"
          ? q.correct[0]
          : q.options.filter((o) => q.correct.includes(o.id)).map((o) => o.text).join(", ");
      const hasOptionExpl =
        (q.type === "single" || q.type === "multi" || q.type === "truefalse") &&
        Array.isArray(q.options) &&
        q.options.some((o) => o.explanation);
      const wrap = document.createElement("div");
      wrap.innerHTML = `
        <div class="verdict-banner ${correct ? "correct" : "incorrect"}">
          <div class="verdict-title">${correct ? "✓ Correct" : "✗ Incorrect"}</div>
          ${!correct && q.type !== "ordering" && !hasOptionExpl ? `<div class="verdict-answer">Correct answer: ${correctText}</div>` : ""}
        </div>
        ${renderExplanationBreakdown(q, given)}
      `;
      checkArea.appendChild(wrap);
    }
  }

  // Prev/Next/Submit — always available. You can skip a question (answered, flagged,
  // or blank) and come back to it later via the sidebar, same as the real exam.
  const isLast = session.index === session.questions.length - 1;
  document.getElementById("prevQBtn").disabled = session.index === 0;
  document.getElementById("nextQBtn").textContent = isLast ? "Submit Test →" : "Skip / Next →";
  document.getElementById("nextQBtn").disabled = false;

  updateQuestionSidebar();
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
  const msg = unanswered > 0
    ? `You have ${unanswered} unanswered question(s). Submit anyway?`
    : "Submit this test now?";
  if (!confirm(msg)) return;
  finishTest();
}

function finishTest() {
  clearInterval(session.timerHandle);

  let correctCount = 0;
  const reviewItems = session.questions.map((q) => {
    const given = session.answers[q.id] || [];
    const isCorrect = isAnswerCorrect(q, given);
    if (isCorrect) correctCount++;
    return { question: q, given, isCorrect };
  });

  const timeTakenSec =
    session.timerMode === "countdown" ? session.durationSec - session.remainingSec : session.elapsedSec;

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
  if (user) {
    DB.saveAttempt(user.email, attempt);
  } // else: guest session (started from the home page with no sign-in) — score still shows, just isn't saved

  renderResults(reviewItems, attempt);
  show("view-results");
}

function renderResults(reviewItems, attempt) {
  const pct = Math.round((attempt.score / attempt.total) * 100);
  document.getElementById("scorePct").textContent = `${pct}%`;
  document.getElementById("scoreDetail").textContent =
    `${attempt.score} / ${attempt.total} correct · ${attempt.mode} · ${formatDuration(attempt.timeTakenSec)}`;
  const badge = document.getElementById("passBadge");
  badge.textContent = pct >= PASS_PERCENT ? "Pass" : "Below passing (70%)";
  badge.className = "badge " + (pct >= PASS_PERCENT ? "pass" : "fail");

  document.getElementById("backToDashBtn").textContent = DB.getUser()
    ? "Back to dashboard"
    : "Done (sign in above to save results like this)";

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
    const weight = EXAM_WEIGHTS[sec] ? ` (${EXAM_WEIGHTS[sec]})` : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${sec}${weight}</td><td>${s.correct}/${s.total}</td>`;
    secBody.appendChild(tr);
  });

  // Full review
  const reviewList = document.getElementById("reviewList");
  reviewList.innerHTML = "";
  reviewItems.forEach((r, i) => {
    const q = r.question;
    const div = document.createElement("div");
    div.className = "review-item";
    const givenText =
      q.type === "fillblank"
        ? r.given[0] || "(no answer)"
        : q.options.filter((o) => r.given.includes(o.id)).map((o) => o.text).join(", ") || "(no answer)";
    const correctText =
      q.type === "fillblank"
        ? q.correct[0]
        : q.options.filter((o) => q.correct.includes(o.id)).map((o) => o.text).join(", ");
    const hasOptionExpl =
      (q.type === "single" || q.type === "multi" || q.type === "truefalse") &&
      Array.isArray(q.options) &&
      q.options.some((o) => o.explanation);
    div.innerHTML = `
      <div class="question-meta">Question ${i + 1} · ${q.section}</div>
      <div class="question-text" style="font-size:0.98rem;">${formatMatchingQuestionText(q.text)}</div>
      <div class="verdict-banner ${r.isCorrect ? "correct" : "incorrect"}">
        <div class="verdict-title">${r.isCorrect ? "✓ Correct" : "✗ Incorrect"}</div>
        <div class="verdict-answer">Your answer: ${givenText}</div>
        ${!r.isCorrect && !hasOptionExpl ? `<div class="verdict-answer">Correct answer: ${correctText}</div>` : ""}
      </div>
      ${renderExplanationBreakdown(q, r.given || [])}
    `;
    reviewList.appendChild(div);
  });
}

boot();
