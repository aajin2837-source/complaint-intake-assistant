r"""
LangGraph orchestration for complaint extraction.

Graph shape:

                  +-------+
       START ---->| route |
                  +---+---+
                      |
            mode == "correction"?
               /                \
              v                  v
    +------------------+  +----------------+
    | extract_          |  | extract_       |
    | correction        |  | fresh          |
    +---------+---------+  +--------+-------+
              \                    /
               v                  v
                 +----------------+
                 |    finalize    |
                 +--------+-------+
                          |
                         END

`route` decides whether this is a brand-new extraction or a
correction to an existing record. `extract_fresh` / `extract_correction`
call the LLM with the appropriate prompt. `finalize` merges/validates
the parsed fields into the record shape the frontend expects.

Nodes only read/write the shared `ComplaintState` dict, so each one
is easy to test, log, or swap out independently later (e.g. add a
"flag for human review" node, or a node that cross-checks the batch
number against a recall database, without touching the others).
"""

import logging
from typing import Optional, TypedDict

from groq import Groq
from langgraph.graph import StateGraph, START, END

from complaint_shared import (
    FIELD_KEYS,
    extract_json,
    build_fresh_extraction_prompt,
    build_correction_prompt,
    finalize_fresh_result,
    validate_and_coerce,
)

logger = logging.getLogger("ai-voa.agent")


class ComplaintState(TypedDict, total=False):
    text: str
    mode: Optional[str]           # "fresh" | "correction", set by the route node
    current_data: Optional[dict]  # existing record, only used for corrections
    parsed_data: dict             # raw JSON the model returned
    result: dict                  # final, validated record


def _call_model(client: Groq, model_name: str, prompt: str) -> dict:
    """Call Groq, retrying once without strict JSON mode if that fails."""
    try:
        completion = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=2048,
            response_format={"type": "json_object"},
        )
        content = completion.choices[0].message.content or ""
        return extract_json(content)
    except Exception as strict_err:
        logger.warning(
            "Strict JSON mode failed (%s), retrying without response_format",
            strict_err,
        )
        completion = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=2048,
        )
        content = completion.choices[0].message.content or ""
        return extract_json(content)


def build_agent_graph(client: Groq, model_name: str):
    """Compile the LangGraph state graph once (e.g. at FastAPI startup).
    The compiled graph is cheap to `.invoke()` repeatedly per request.
    """

    def route(state: ComplaintState) -> ComplaintState:
        is_correction = state.get("mode") == "correction" and bool(state.get("current_data"))
        state["mode"] = "correction" if is_correction else "fresh"
        logger.info("[agent] routed to '%s'", state["mode"])
        return state

    def route_edge(state: ComplaintState) -> str:
        return "extract_correction" if state["mode"] == "correction" else "extract_fresh"

    def extract_fresh(state: ComplaintState) -> ComplaintState:
        prompt = build_fresh_extraction_prompt(state["text"])
        state["parsed_data"] = _call_model(client, model_name, prompt)
        return state

    def extract_correction(state: ComplaintState) -> ComplaintState:
        prompt = build_correction_prompt(state["text"], state["current_data"])
        state["parsed_data"] = _call_model(client, model_name, prompt)
        return state

    def finalize(state: ComplaintState) -> ComplaintState:
        parsed = state.get("parsed_data") or {}
        if state["mode"] == "correction":
            current = state.get("current_data") or {}
            result = {key: (parsed.get(key) or current.get(key, "")) for key in FIELD_KEYS}
            result = validate_and_coerce(result, fallback=current)
        else:
            result = finalize_fresh_result(parsed, state["text"])
            result = validate_and_coerce(result)
        state["result"] = result
        return state

    graph = StateGraph(ComplaintState)
    graph.add_node("route", route)
    graph.add_node("extract_fresh", extract_fresh)
    graph.add_node("extract_correction", extract_correction)
    graph.add_node("finalize", finalize)

    graph.add_edge(START, "route")
    graph.add_conditional_edges(
        "route",
        route_edge,
        {"extract_fresh": "extract_fresh", "extract_correction": "extract_correction"},
    )
    graph.add_edge("extract_fresh", "finalize")
    graph.add_edge("extract_correction", "finalize")
    graph.add_edge("finalize", END)

    return graph.compile()


def run_extraction(
    compiled_graph,
    text: str,
    mode: Optional[str] = None,
    current_data: Optional[dict] = None,
) -> dict:
    """Convenience wrapper so callers don't need to know about
    ComplaintState internals — mirrors the old `_call_model(prompt)`
    call site in server.py almost exactly."""
    initial_state: ComplaintState = {
        "text": text,
        "mode": mode,
        "current_data": current_data,
    }
    final_state = compiled_graph.invoke(initial_state)
    return final_state["result"]