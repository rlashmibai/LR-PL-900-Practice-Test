# PL-900 Practice Test

PL-900 | 6 Practice Tests | 600 Q's - July 2026 Updated

A free, public PL-900 (Microsoft Power Platform Fundamentals) practice test — no account
password required, just a name + email to save your progress. Built as a static web app so it
can be hosted for free and reached by anyone.

## Live features

- Guest login (name + email, no password) — saves score history on this device
- Full timed practice exam, or practice one topic at a time
- Question formats: single-choice, multi-select, true/false, ordering
- Instant explanation shown after each attempt, plus a full review screen
- Score breakdown by PL-900 exam domain
- Works on mobile and desktop (responsive, installable as a home-screen app)

## Project structure

```
index.html      Page structure / all views (welcome, dashboard, test, results)
style.css       Styling (mobile-first, responsive)
app.js          App logic: guest login, quiz engine, scoring, results rendering
questions.json  The question bank (see format below)
manifest.json   PWA manifest (enables "Add to Home Screen")
```

## Question format

Each question in `questions.json` looks like this:

```json
{
  "id": "q1",
  "type": "single",
  "section": "Business value of Power Platform",
  "text": "Question text goes here?",
  "options": [
    { "id": "a", "text": "Option A" },
    { "id": "b", "text": "Option B" }
  ],
  "correct": ["b"],
  "explanation": "Why b is correct, shown after the visitor answers."
}
```

- `type`: `single` (one correct answer), `multi` (select all that apply), `truefalse`, or
  `ordering` (put items in the correct sequence — `correct` is the array of option ids in order).
- `section`: groups questions into topic-wise practice tests and the results breakdown.

## Running locally

Any static file server works, e.g.:

```
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Deployment

Currently a client-only static app (data is saved to the browser's `localStorage`, per device).
A Firebase backend (Firestore) is planned so guest history syncs across devices — see project
notes for status.
