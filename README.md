# AIVOA Complaint Intake & Risk Assessment System

An internal quality-assurance tool for logging customer complaints (API & FDF), extracting complaint details automatically using AI, and committing reviewed complaints to a QMS (Quality Management System) ledger.

---

## Overview

This system lets a QA/quality team member:

1. **Upload or paste** a complaint document (PDF, DOCX, TXT, or EML) or raw complaint text.
2. Have an **AI assistant automatically extract** structured fields (product, batch number, complaint type, description, etc.) and populate a complaint form.
3. **Review and edit** the extracted data, including an AI-suggested severity and risk assessment.
4. **Save** the complaint and **commit** it to the QMS ledger using a slide-to-confirm action.

---

## Project Structure

```
aivoa-complaint-system/
├── server.py                     # Backend API (FastAPI) — extraction, storage, commit endpoints
├── complaints_db.json            # Local JSON store of saved complaints
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
The backend API server. Expected responsibilities:
- `POST /api/extract-complaint` — extracts structured complaint data from raw text (supports a `correction` mode that patches only changed fields against an existing record).
- `POST /api/extract-complaint-file` — accepts an uploaded PDF/DOCX file and returns extracted complaint data.
- `POST /api/complaints` — saves a complaint record and returns it with an assigned `id` and `status`.
- `POST /api/complaints/{id}/commit` — commits a saved complaint to the QMS ledger, returning the updated status.

### `App.jsx`
The root component. Holds the single source of truth for `formData` and passes it down to both `ComplaintForm` and `AIAssistantSidebar`. Normalizes whatever shape the backend returns (camelCase or snake_case) into the form's expected fields, and bumps a `formVersion` counter whenever a new complaint is loaded (via AI extraction or a manual reset) so child components can reset their own local UI state.

### `components/AIAssistantSidebar.jsx`
A chat-style side panel that is the primary way complaint data gets into the form. Supports:
- Drag-and-drop or click-to-browse file upload (PDF, DOCX, TXT, EML — 10MB limit)
- Pasting raw complaint text/email
- A chat input for follow-up corrections (e.g. "batch number should be X") — detects whether the form already has real data and, if so, sends the current record as context so the backend only patches the relevant field(s) instead of overwriting everything.

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

### Backend
```bash
cd aivoa-complaint-system
python -m venv venv
venv\Scripts\activate        # on Windows
# source venv/bin/activate   # on macOS/Linux
pip install -r requirements.txt
python server.py
```
The backend should run at `http://localhost:8000`.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
The frontend should run at `http://localhost:5173` (Vite default) and expects the backend at `http://localhost:8000`.

---

## Notes
- Uploaded/pasted documents are always treated as a **fresh** complaint (full extraction); chat messages sent while the form already has data are treated as **corrections** to that existing record.
- `complaints_db.json` is a local data file — if it contains real complaint data, keep the repository private or exclude this file via `.gitignore` before pushing to a public remote.