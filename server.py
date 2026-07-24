
import os
import io
import re
import json
import logging
from typing import Optional
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai-voa")


app = FastAPI(title="AI-VOA Complaint System Backend", version="1.0.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if not GROQ_API_KEY:
    logger.warning(
        "GROQ_API_KEY is not set. Set it as an environment variable "
        "(get one from https://console.groq.com/keys). Extraction calls will fail until then."
    )

client = Groq(api_key=GROQ_API_KEY)

MODEL_NAME = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")

MAX_UPLOAD_SIZE = 10 * 1024 * 1024 

FIELD_KEYS = [
    "complaintSource",
    "customerName",
    "productName",
    "productStrength",
    "batchNumber",
    "manufacturingDate",
    "expiryDate",
    "quantityAffected",
    "complaintType",
    "complaintDate",
    "description",
    "initialSeverity",
    "priority",
    "complaintCategory",
    "suggestedSeverity",
    "suggestedNextAction",
    "initialRiskAssessment",
]


class ComplaintInput(BaseModel):
    text: str
    mode: Optional[str] = None
    current_data: Optional[dict] = None


class ComplaintRecord(BaseModel):
    complaintSource: str = ""
    customerName: str = ""
    productName: str = ""
    productStrength: str = ""
    batchNumber: str = ""
    manufacturingDate: str = ""
    expiryDate: str = ""
    quantityAffected: str = ""
    complaintType: str = ""
    complaintDate: str = ""
    description: str = ""
    initialSeverity: str = "Medium"
    priority: str = "Medium"
    complaintCategory: str = ""
    suggestedSeverity: str = ""
    suggestedNextAction: str = ""
    initialRiskAssessment: str = ""
    status: str = "Pending Triage"

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "complaints_db.json")


def _load_db():
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("complaints", []), data.get("next_id", 1)
        except Exception as e:
            logger.warning("Could not read %s (%s); starting with an empty store", DB_FILE, e)
    return [], 1


def _save_db():
    try:
        with open(DB_FILE, "w", encoding="utf-8") as f:
            json.dump({"complaints": COMPLAINTS_DB, "next_id": _next_id}, f, indent=2)
    except Exception as e:
        logger.error("Failed to persist complaints_db.json: %s", e)


COMPLAINTS_DB, _next_id = _load_db()


@app.get("/")
def read_root():
    return {
        "message": "AI-VOA Complaint System Backend Running.",
        "model": MODEL_NAME,
        "groq_key_configured": bool(GROQ_API_KEY),
    }


def _extract_json(text: str) -> dict:
    """Pull a JSON object out of raw model text, in case of stray
    markdown fences or leading/trailing commentary."""
    text = text.strip()
    text = re.sub(r"^```(json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise json.JSONDecodeError("No JSON object found", text, 0)
    return json.loads(match.group(0))


def _call_model(prompt: str) -> dict:
    try:
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=2048,
            response_format={"type": "json_object"},
        )
        content = completion.choices[0].message.content or ""
        return _extract_json(content)
    except Exception as strict_err:
        logger.warning(
            "Strict JSON mode failed (%s), retrying without response_format",
            strict_err,
        )
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=2048,
        )
        content = completion.choices[0].message.content or ""
        return _extract_json(content)


def _build_fresh_extraction_prompt(text: str) -> str:
    return f"""
    You are an expert pharmaceutical quality assurance and compliance AI agent.
    Analyze the complaint text below and extract the following fields precisely based ONLY on the provided text.
    If a specific field is not mentioned or cannot be inferred, return an empty string (""). Do not guess or use hardcoded placeholders.

    Current Date Context: 2026-07-24. Convert any relative or written dates into standard YYYY-MM-DD format.

    Return ONLY a JSON object (no markdown, no commentary) with these EXACT keys:
    - complaintSource (entity reporting it, e.g. pharmacy or hospital name)
    - customerName (customer or organization name)
    - productName (name of the drug/product)
    - productStrength (e.g., 500mg, 250mg)
    - batchNumber (lot or batch code)
    - manufacturingDate (YYYY-MM-DD)
    - expiryDate (YYYY-MM-DD)
    - quantityAffected (number of units/boxes if mentioned, else "")
    - complaintType (e.g., Discoloured Capsules, Packaging Defect, Contamination)
    - complaintDate (YYYY-MM-DD, default to 2026-07-24 if not specified)
    - description (the exact full text or summary of the issue)
    - initialSeverity (Low, Medium, High, or Critical)
    - priority (Low, Medium, High, or Urgent)
    - complaintCategory (a short classification, e.g. "Product Defect - Discoloration", "Packaging Defect", "Contamination", "Documentation Error")
    - suggestedSeverity (your AI risk-assessment recommendation: Minor, Major, or Critical, based on patient safety impact)
    - suggestedNextAction (a short recommended next step for QA, e.g. "Route to QA Investigation & Issue Replacement", "Initiate Batch Recall Review", "Log for Trend Monitoring")
    - initialRiskAssessment (2-3 sentence narrative on likely root cause and risk to patient safety, written as a QA analyst would)

    Complaint Text:
    {text}
    """


def _build_correction_prompt(text: str, current_data: dict) -> str:
    existing_json = json.dumps({key: current_data.get(key, "") for key in FIELD_KEYS}, indent=2)
    return f"""
    You are an expert pharmaceutical quality assurance and compliance AI agent helping fix a
    complaint record that has ALREADY been filled in.

    Here is the EXISTING record as JSON:
    {existing_json}

    The user just sent this follow-up message. It is a correction or clarification to ONE OR A FEW
    fields of the record above. It is NOT a brand-new complaint, so do NOT re-extract from scratch
    and do NOT treat it as a replacement for the whole record:

    "{text}"

    Task: figure out which field(s), if any, this message is correcting or adding information for.
    This can be ANY field in the record — not just batch/lot number. Read the message carefully for
    what it's actually referring to before deciding. Examples of the range of corrections you must
    handle equally well:
    - "actually the batch number is OMP-2026-M13" -> only batchNumber changes
    - "the customer is City Hospital Pharmacy, not what's in there now" -> only customerName changes
    - "manufacturing date should be march 1st 2026" -> only manufacturingDate changes, converted to 2026-03-01
    - "this should be marked high priority" -> only priority changes, to "High"
    - "actually 40 boxes were affected, not what you have" -> only quantityAffected changes
    - "can you also note it was a foreign hospital, not a local one" -> only complaintSource or description changes, whichever the message is actually clarifying — not both, and not fields the message doesn't touch
    - "no changes, just confirming" or a message unrelated to any field -> return the existing record completely unchanged

    Rules:
    - Return a JSON object with the EXACT SAME keys as the existing record above.
    - For every field the message does NOT mention or change, copy the existing value over UNCHANGED
      (do not blank it, do not guess a new value for it, do not "helpfully" rewrite it).
    - Only change the value(s) the message actually addresses.
    - initialSeverity must be one of: Low, Medium, High, Critical. priority must be one of: Low, Medium, High, Urgent.
      suggestedSeverity must be one of: Minor, Major, Critical. If the message doesn't clearly map to one of
      these exact values, leave the field unchanged rather than guessing.
    - NEVER copy the user's raw message into "description" unless the message is clearly rewriting
      or adding to the complaint's description itself. If in doubt, leave "description" as it was.
    - Convert any dates mentioned into YYYY-MM-DD format (current date context: 2026-07-24).

    Return ONLY the JSON object — no markdown, no commentary.
    Keys required: {", ".join(FIELD_KEYS)}
    """


def _finalize_fresh_result(parsed_data: dict, original_text: str) -> dict:
    """Fill in the same sensible defaults for a brand-new extraction,
    shared by both the text endpoint and the file-upload endpoint."""
    result = {key: parsed_data.get(key, "") for key in FIELD_KEYS}
    if not result["description"]:
        result["description"] = original_text
    if not result["complaintDate"]:
        result["complaintDate"] = "2026-07-24"
    if not result["initialSeverity"]:
        result["initialSeverity"] = "Medium"
    if not result["priority"]:
        result["priority"] = "Medium"
    if not result["suggestedSeverity"]:
        result["suggestedSeverity"] = "Major"
    if not result["suggestedNextAction"]:
        result["suggestedNextAction"] = "Route to QA Investigation"
    if not result["initialRiskAssessment"]:
        result["initialRiskAssessment"] = (
            "Automated risk assessment unavailable for this complaint — "
            "please review manually."
        )
    return result


def _extract_pdf_text(contents: bytes) -> str:
    """Requires: pip install pypdf"""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(contents))
    pages = [(page.extract_text() or "") for page in reader.pages]
    return "\n".join(pages).strip()


def _extract_docx_text(contents: bytes) -> str:
    """Requires: pip install python-docx"""
    from docx import Document

    doc = Document(io.BytesIO(contents))
    chunks = [p.text for p in doc.paragraphs if p.text]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text:
                    chunks.append(cell.text)

    return "\n".join(chunks).strip()


@app.post("/api/extract-complaint")
async def extract_complaint(data: ComplaintInput):
    if not data.text or not data.text.strip():
        raise HTTPException(status_code=400, detail="No complaint text provided.")

    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Server misconfigured: GROQ_API_KEY environment variable is not set.",
        )

    is_correction = data.mode == "correction" and bool(data.current_data)

    prompt = (
        _build_correction_prompt(data.text, data.current_data)
        if is_correction
        else _build_fresh_extraction_prompt(data.text)
    )

    try:
        parsed_data = _call_model(prompt)

        if is_correction:
            result = {
                key: (parsed_data.get(key) or data.current_data.get(key, ""))
                for key in FIELD_KEYS
            }
        else:
            result = _finalize_fresh_result(parsed_data, data.text)

        return result

    except json.JSONDecodeError as e:
        logger.error("Model did not return valid JSON: %s", e)
        raise HTTPException(
            status_code=502,
            detail="AI model returned an unparseable response. Try again or shorten the input text.",
        )
    except Exception as e:
        logger.error("Extraction Error: %s", e)
        raise HTTPException(status_code=502, detail=f"AI extraction failed: {e}")


@app.post("/api/extract-complaint-file")
async def extract_complaint_file(file: UploadFile = File(...)):
    """Handles PDF/DOCX uploads from the sidebar's drag-and-drop zone.
    (TXT/EML are read as plain text in the browser and go through
    /api/extract-complaint instead — they never hit this endpoint.)
    """
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Server misconfigured: GROQ_API_KEY environment variable is not set.",
        )

    filename = file.filename or "uploaded file"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in (".pdf", ".docx"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. This endpoint handles PDF and DOCX only.",
        )

    contents = await file.read()

    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"'{filename}' is over the 10MB limit.",
        )

    try:
        if ext == ".pdf":
            text = _extract_pdf_text(contents)
        else:
            text = _extract_docx_text(contents)
    except ImportError as e:
        logger.error("Missing text-extraction dependency: %s", e)
        raise HTTPException(
            status_code=500,
            detail=(
                "Server is missing a required package for reading this file type. "
                "Install with: pip install pypdf python-docx"
            ),
        )
    except Exception as e:
        logger.error("Failed to parse '%s': %s", filename, e)
        raise HTTPException(status_code=400, detail=f"Could not read '{filename}': {e}")

    if not text.strip():
        raise HTTPException(
            status_code=400,
            detail=(
                f"No extractable text found in '{filename}'. It may be a scanned/"
                "image-only document — try a text-based PDF or DOCX instead."
            ),
        )

    prompt = _build_fresh_extraction_prompt(text)

    try:
        parsed_data = _call_model(prompt)
        return _finalize_fresh_result(parsed_data, text)
    except json.JSONDecodeError as e:
        logger.error("Model did not return valid JSON: %s", e)
        raise HTTPException(
            status_code=502,
            detail="AI model returned an unparseable response. Try again.",
        )
    except Exception as e:
        logger.error("Extraction Error: %s", e)
        raise HTTPException(status_code=502, detail=f"AI extraction failed: {e}")


@app.post("/api/complaints")
async def save_complaint(record: ComplaintRecord):
    global _next_id
    complaint = record.dict()
    complaint["id"] = _next_id
    complaint["status"] = complaint.get("status") or "Pending Triage"
    COMPLAINTS_DB.append(complaint)
    _next_id += 1
    _save_db()
    logger.info("Saved complaint #%s", complaint["id"])
    return complaint


@app.get("/api/complaints")
async def list_complaints():
    return COMPLAINTS_DB


@app.get("/api/complaints/{complaint_id}")
async def get_complaint(complaint_id: int):
    for complaint in COMPLAINTS_DB:
        if complaint["id"] == complaint_id:
            return complaint
    raise HTTPException(status_code=404, detail=f"Complaint #{complaint_id} not found.")


@app.post("/api/complaints/{complaint_id}/commit")
async def commit_complaint(complaint_id: int):
    """Called when the user drags the 'Commit to QMS Ledger' slider to
    confirm. Marks the complaint as officially logged."""
    for complaint in COMPLAINTS_DB:
        if complaint["id"] == complaint_id:
            complaint["status"] = "Committed to QMS Ledger"
            _save_db()
            logger.info("Committed complaint #%s to QMS ledger", complaint_id)
            return complaint
    raise HTTPException(status_code=404, detail=f"Complaint #{complaint_id} not found.")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)