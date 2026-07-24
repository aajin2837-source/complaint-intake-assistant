"""
Shared field schema, prompt templates, and validation/normalization
helpers used by both the FastAPI routes (server.py) and the
LangGraph extraction agent (agent_graph.py).

Keeping these here (instead of duplicated in server.py and
agent_graph.py) means there is exactly one place that defines what a
"valid" complaint record looks like.
"""

import json
import re

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

VALID_SEVERITY = {"Low", "Medium", "High", "Critical"}
VALID_PRIORITY = {"Low", "Medium", "High", "Urgent"}
VALID_SUGGESTED_SEVERITY = {"Minor", "Major", "Critical"}

DEFAULT_COMPLAINT_DATE = "2026-07-24"


def extract_json(text: str) -> dict:
    """Pull a JSON object out of raw model text, in case of stray
    markdown fences or leading/trailing commentary."""
    text = text.strip()
    text = re.sub(r"^```(json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise json.JSONDecodeError("No JSON object found", text, 0)
    return json.loads(match.group(0))


def build_fresh_extraction_prompt(text: str) -> str:
    return f"""
    You are an expert pharmaceutical quality assurance and compliance AI agent.
    Analyze the complaint text below and extract the following fields precisely based ONLY on the provided text.
    If a specific field is not mentioned or cannot be inferred, return an empty string (""). Do not guess or use hardcoded placeholders.

    Current Date Context: {DEFAULT_COMPLAINT_DATE}. Convert any relative or written dates into standard YYYY-MM-DD format.

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
    - complaintDate (YYYY-MM-DD, default to {DEFAULT_COMPLAINT_DATE} if not specified)
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


def build_correction_prompt(text: str, current_data: dict) -> str:
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

    Propagating a correction into the description:
    - The existing "description" field is the original narrative text of the complaint. If the OLD
      value of a field you are correcting (e.g. the old batch number, old product name, old quantity,
      old date) appears verbatim or near-verbatim as a substring inside "description", update
      "description" by replacing ONLY that specific substring with the NEW value.
    - This is a surgical find-and-replace, not a rewrite: every other word, sentence, and piece of
      phrasing in "description" must stay exactly as it was. Do not paraphrase, reorder, or "clean up"
      anything else in the description.
    - If the old value does not appear anywhere in "description" (e.g. it was never mentioned in the
      narrative, or the field is an enum like priority/severity that wouldn't appear as prose), leave
      "description" unchanged.
    - NEVER copy the user's raw correction message itself into "description" — only use it to identify
      which value to swap.

    Convert any dates mentioned into YYYY-MM-DD format (current date context: {DEFAULT_COMPLAINT_DATE}).

    Return ONLY the JSON object — no markdown, no commentary.
    Keys required: {", ".join(FIELD_KEYS)}
    """


def finalize_fresh_result(parsed_data: dict, original_text: str) -> dict:
    """Fill in sensible defaults for a brand-new extraction."""
    result = {key: parsed_data.get(key, "") for key in FIELD_KEYS}
    if not result["description"]:
        result["description"] = original_text
    if not result["complaintDate"]:
        result["complaintDate"] = DEFAULT_COMPLAINT_DATE
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


def validate_and_coerce(result: dict, fallback: dict | None = None) -> dict:
    """Guard against the model returning an out-of-enum value for any
    constrained field. Falls back to `fallback` (the prior record, for
    corrections) or a safe default (for fresh extractions) instead of
    silently letting a bad value reach the frontend/DB.
    """
    fallback = fallback or {}
    if result.get("initialSeverity") not in VALID_SEVERITY:
        result["initialSeverity"] = fallback.get("initialSeverity", "Medium")
    if result.get("priority") not in VALID_PRIORITY:
        result["priority"] = fallback.get("priority", "Medium")
    if result.get("suggestedSeverity") not in VALID_SUGGESTED_SEVERITY:
        result["suggestedSeverity"] = fallback.get("suggestedSeverity", "Major")
    return result