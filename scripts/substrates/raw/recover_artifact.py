#!/usr/bin/env python3
"""Recover a mode artifact JSON object from raw provider content.

Strategies (first win):
  1. Whole content is a JSON object (response_format=json_object)
  2. Artifact nested under AEGIS_ARTIFACT_BEGIN as a JSON key
  3. Classic marker sandwich BEGIN ... END (with optional key-noise)
  4. First balanced {...} that parses as an object

Reads provider content from stdin. Prints compact JSON on success; exit 1 on failure.
Env: BEGIN_MARKER, END_MARKER (defaults match harness config).
"""

from __future__ import annotations

import json
import os
import re
import sys

BEGIN = os.environ.get("BEGIN_MARKER", "AEGIS_ARTIFACT_BEGIN")
END = os.environ.get("END_MARKER", "AEGIS_ARTIFACT_END")

ARTIFACT_KEYS = {
    "observations",
    "rationale",
    "required_evidence",
    "status",
    "repair_candidates",
    "findings",
    "verdict",
    "basis",
    "mode",
    "candidate_result",
}


def dumps_ok(obj: object) -> str | None:
    if not isinstance(obj, dict):
        return None
    return json.dumps(obj, ensure_ascii=False)


def try_loads(text: str | None) -> str | None:
    if text is None:
        return None
    s = text.strip()
    if not s:
        return None

    # Strip markdown fences.
    s = re.sub(r"^```[a-zA-Z0-9_-]*\s*\n?", "", s)
    s = re.sub(r"\n?```\s*$", "", s)
    s = s.strip()

    # Noise from marker-as-key sandwich:
    #   ": { ... }, "   or leading quotes/colons
    s = re.sub(r'^[\"\s]*:\s*', "", s)
    s = re.sub(r',\s*\"?\s*$', "", s)
    s = s.strip().rstrip(",").strip()

    try:
        return dumps_ok(json.loads(s))
    except Exception:
        pass

    # Unquoted keys → quoted (simple identifiers only).
    fixed = re.sub(
        r"(?<=\{|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:",
        r' "\1":',
        s,
    )
    try:
        return dumps_ok(json.loads(fixed))
    except Exception:
        pass

    # Close truncated braces/brackets.
    stack: list[str] = []
    in_str = False
    escape = False
    for ch in fixed:
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch in "{[":
            stack.append(ch)
        elif ch == "}" and stack and stack[-1] == "{":
            stack.pop()
        elif ch == "]" and stack and stack[-1] == "[":
            stack.pop()

    closers = {"[": "]", "{": "}"}
    if stack:
        candidate = fixed.rstrip().rstrip(",") + "".join(
            closers[c] for c in reversed(stack)
        )
        try:
            return dumps_ok(json.loads(candidate))
        except Exception:
            pass
    return None


def first_balanced_object(text: str) -> str | None:
    start = text.find("{")
    while start != -1:
        depth = 0
        in_str = False
        escape = False
        for i in range(start, len(text)):
            ch = text[i]
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    chunk = text[start : i + 1]
                    got = try_loads(chunk)
                    if got is not None:
                        return got
                    break
        start = text.find("{", start + 1)
    return None


def unwrap_marker_keyed(obj: dict) -> str | None:
    if BEGIN in obj and isinstance(obj[BEGIN], dict):
        return dumps_ok(obj[BEGIN])
    for k, v in obj.items():
        if not isinstance(v, dict):
            continue
        norm = k.replace(" ", "_").upper()
        if BEGIN in norm or norm == BEGIN:
            return dumps_ok(v)
    if ARTIFACT_KEYS.intersection(obj.keys()):
        return dumps_ok(obj)
    return None


def recover(raw: str) -> str | None:
    # 1) Entire content is JSON.
    got = try_loads(raw)
    if got is not None:
        try:
            obj = json.loads(got)
            unwrapped = unwrap_marker_keyed(obj)
            if unwrapped is not None:
                return unwrapped
        except Exception:
            return got

    # 2) Classic marker sandwich (possibly with key-noise after BEGIN).
    if BEGIN in raw and END in raw:
        mid = raw.split(BEGIN, 1)[1].split(END, 1)[0]
        got = try_loads(mid)
        if got is not None:
            return got
        got = first_balanced_object(mid)
        if got is not None:
            return got

    # 3) BEGIN without END.
    if BEGIN in raw:
        tail = raw.split(BEGIN, 1)[1]
        got = try_loads(tail) or first_balanced_object(tail)
        if got is not None:
            return got

    # 4) First balanced object anywhere.
    return first_balanced_object(raw)


def main() -> int:
    raw = sys.stdin.read()
    result = recover(raw)
    if result is None:
        return 1
    print(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
