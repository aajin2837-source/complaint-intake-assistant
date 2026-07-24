# AIVOA Complaint Intake & Risk Assessment System

An internal quality-assurance tool for logging customer complaints (API & FDF), extracting complaint details automatically using AI, and committing reviewed complaints to a QMS (Quality Management System) ledger.

---

## Overview

This system lets a QA/quality team member:

1. **Upload or paste** a complaint document (PDF, DOCX, TXT, or EML) or raw complaint text.
2. Have an **AI assistant automatically extract** structured fields (product, batch number, complaint type, description, etc.) and populate a complaint form.
3. **Review and edit** the extracted data, including an AI-suggested severity and risk assessment.
4. **Save** the complaint and **commit** it to the QMS ledger using a slide-to-confirm action.
5. **Correct** any field via chat afterward — the AI patches only the field(s) mentioned, and now also updates any matching mention of the old value inside the free-text description, so the structured fields and the narrative never fall out of sync.

---

## Project Structure

```
aivoa-complaint-system/
├── server.py                     # Backend API (FastAPI) — extraction, storage, commit endpoints
├── agent_graph.py                # LangGraph state graph that orchestrates the extraction agent
├── complaint_shared.py           # Shared field schema, prompt templates, and validation helpers
├── complaints_db.json            # Local JSON store of saved complaints
├── requirements.txt              # Backend Python dependencies
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Root component — owns form state, wires sidebar + form together
│   │   ├── components/
│   │   │   ├── AIAssistantSidebar.jsx   # Chat/upload panel that extracts complaint data via AI
│   │   │   ├── ComplaintForm.jsx        # Main complaint intake form
│   │   │   └── RiskAssessmentPanel.jsx  # AI risk assessment + slide-to-confirm commit action
│   │   ├── App.css
│   │   ├── index.css
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
└── .gitignore
```

---

## File Descriptions

### `server.py`
The FastAPI backend. Responsibilities:
- `POST /api/extract-complaint` — extracts structured complaint data from raw text. Accepts an optional `mode: "correction"` plus `current_data`, in which case only the relevant field(s) are patched instead of re-extracting from scratch.
- `POST /api/extract-complaint-file` — accepts an uploaded PDF or DOCX, extracts the raw text server-side (`pypdf` / `python-docx`), then runs it through the same extraction pipeline as pasted text.
- `POST /api/complaints` — saves a complaint record to `complaints_db.json` and returns it with an assigned `id` and `status: "Pending Triage"`.
- `GET /api/complaints`, `GET /api/complaints/{id}` — list/fetch saved complaints.
- `POST /api/complaints/{id}/commit` — commits a saved complaint to the QMS ledger, returning `status: "Committed to QMS Ledger"`.

`server.py` doesn't call the AI model directly — both extraction endpoints hand off to the compiled LangGraph agent (`agent_graph.py`) via `run_extraction(...)`, built once at startup and reused across requests.

### `agent_graph.py`
Defines the extraction pipeline as a small **LangGraph state graph** instead of an inline if/else chain:

```
START → route → extract_fresh ──┐
              → extract_correction ─→ finalize → END
```

- **`route`** — decides whether the request is a brand-new complaint or a correction to an existing record (based on `mode` and whether `current_data` was provided).
- **`extract_fresh`** — builds the full-extraction prompt and calls the LLM (via `Groq`), for documents/pasted text with no existing record.
- **`extract_correction`** — builds the correction prompt (existing record + the user's follow-up message) and calls the LLM, patching only what changed.
- **`finalize`** — merges/validates whatever the model returned into the exact field shape the frontend expects, filling in safe defaults for fresh extractions and falling back to the prior value for corrections if the model returns something invalid.

Each node only reads/writes a shared `ComplaintState` dict, so nodes are easy to test or extend independently later (e.g. adding a "flag for human review" node) without touching the rest of the graph.

### `complaint_shared.py`
The single source of truth for what a "valid" complaint record looks like — imported by both `server.py` and `agent_graph.py` so the schema is never duplicated:
- `FIELD_KEYS` — the canonical list of complaint fields.
- `build_fresh_extraction_prompt(text)` — prompt for extracting a brand-new complaint from raw text.
- `build_correction_prompt(text, current_data)` — prompt for patching an existing record from a follow-up message. Instructs the model to touch only the field(s) the message actually addresses, and — if the old value being corrected (e.g. an old batch number) appears verbatim inside `description` — to surgically find-and-replace just that substring in the description too, without rewriting anything else in it.
- `finalize_fresh_result(...)` / `validate_and_coerce(...)` — fill in sensible defaults and guard against the model returning an out-of-enum value for `initialSeverity`, `priority`, or `suggestedSeverity`, falling back to the prior/safe value instead of letting a bad value reach the frontend.

### `App.jsx`
The root component. Holds the single source of truth for `formData` and passes it down to both `ComplaintForm` and `AIAssistantSidebar`. Normalizes whatever shape the backend returns (camelCase or snake_case) into the form's expected fields, and bumps a `formVersion` counter whenever a new complaint is loaded (via AI extraction or a manual reset) so child components can reset their own local UI state.

### `components/AIAssistantSidebar.jsx`
A chat-style side panel that is the primary way complaint data gets into the form. Supports:
- Drag-and-drop or click-to-browse file upload (PDF, DOCX, TXT, EML — 10MB limit)
- Pasting raw complaint text/email
- A chat input for follow-up corrections (e.g. "actually the batch number is PAN-2026-Y45") — detects whether the form already has real data and, if so, sends the current record as context so the backend only patches the relevant field(s) instead of overwriting everything.

### `components/ComplaintForm.jsx`
The main data-entry form, organized into sections:
1. Origin & Customer Details
2. Product & Batch Identification
3. Complaint Details
4. Initial Assessment & Priority

Handles saving the complaint (`POST /api/complaints`) and resetting the form. Renders `RiskAssessmentPanel` below the form, keyed on `formVersion` so the panel's internal state (slider position, success/error messages) resets whenever a new complaint is loaded.

### `components/RiskAssessmentPanel.jsx`
Displays the AI-suggested severity, next action, and risk assessment for the current complaint, plus a **slide-to-confirm** control used to commit the complaint to the QMS ledger. If the complaint hasn't been saved yet when the user commits, it auto-saves first so the commit action works standalone.

---

## Setup

### Prerequisites
- Node.js (for the frontend)
- Python 3.x (for the backend)
- A [Groq API key](https://console.groq.com/keys) — required for AI extraction to work

### Backend
```bash
cd aivoa-complaint-system
python -m venv venv
venv\Scripts\activate        # on Windows
# source venv/bin/activate   # on macOS/Linux
pip install -r requirements.txt

# set your Groq API key
set GROQ_API_KEY=your_key_here      # on Windows
# export GROQ_API_KEY=your_key_here # on macOS/Linux

python server.py
```
The backend should run at `http://localhost:8000`. If `GROQ_API_KEY` isn't set, the server still starts but extraction calls will fail with a 500 until it's configured. You can optionally override the model via `GROQ_MODEL` (defaults to `openai/gpt-oss-20b`).

### Frontend
```bash
cd frontend
npm install
npm run dev
```
The frontend should run at `http://localhost:5173` (Vite default) and expects the backend at `http://localhost:8000`.

---

## Notes
- Uploaded/pasted documents are always treated as a **fresh** complaint (full extraction, via the `extract_fresh` node); chat messages sent while the form already has data are treated as **corrections** to that existing record (via the `extract_correction` node).
- Corrections are surgical: only the field(s) a follow-up message actually addresses are changed. As of the latest update, if the old value being corrected also appears in the free-text `description`, that mention is updated too — everything else in the description is left word-for-word unchanged.
- `complaints_db.json` is a local data file — if it contains real complaint data, keep the repository private or exclude this file via `.gitignore` before pushing to a public remote.