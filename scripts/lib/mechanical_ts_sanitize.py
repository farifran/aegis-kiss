#!/usr/bin/env python3
"""Sanitize Briefing→TS materialization for Math.* / bigint foot-guns.

Domain-agnostic: any class/function, any field names. Reads TS from stdin,
writes sanitized TS to stdout.

Fixes:
  Math.floor/ceil/round/trunc/abs(<expr with bigint>)  → Number(arg)
  Math.min/max(a,b) when either side is bigint-ish       → ternary
  BigInt(bigintish * this.numberField)                   → BigInt product
  timeDiff-like * this.numberField                       → BigInt product

Does not invent Number(timeDiff) on pure bigint*bigint products that are
already type-safe.
"""
from __future__ import annotations

import re
import sys

BIGINT_MARK = re.compile(r"BigInt\s*\(|\b\d+n\b")
# Class fields only — require access modifier or #private so params like
# `update(timeDiff: bigint)` are never treated as fields.
FIELD_DECL = re.compile(
    r"(?:^|[\n;{])\s*"
    r"(?:(?:private|public|protected|readonly|static|declare)\s+)+"
    r"(?:readonly\s+)?"
    r"([A-Za-z_][\w]*)\s*:\s*(number|bigint)\b"
    r"|"
    r"(?:^|[\n;{])\s*"
    r"#([A-Za-z_][\w]*)\s*:\s*(number|bigint)\b"
)
TIME_LOCALS = (
    r"timeDiff|time_diff|delta|elapsed|diff|now|duration|age|lag|dt|"
    r"tickDelta|tick_delta"
)


def skip_string(s: str, i: int) -> int:
    q = s[i]
    i += 1
    n = len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == q:
            return i + 1
        i += 1
    return n


def match_paren(s: str, open_idx: int) -> int:
    """open_idx points at '('; return index of matching ')' or -1."""
    depth = 0
    i = open_idx
    n = len(s)
    while i < n:
        c = s[i]
        if c in "\"'`":
            i = skip_string(s, i)
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def split_top_level_commas(arg: str):
    parts = []
    buf = []
    depth = 0
    i = 0
    n = len(arg)
    while i < n:
        c = arg[i]
        if c in "\"'`":
            j = skip_string(arg, i)
            buf.append(arg[i:j])
            i = j
            continue
        if c == "(":
            depth += 1
            buf.append(c)
        elif c == ")":
            depth -= 1
            buf.append(c)
        elif c == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(c)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def has_bigint_literal(expr: str) -> bool:
    return bool(BIGINT_MARK.search(expr))


def has_bigint(expr: str, bigint_fields=None) -> bool:
    if has_bigint_literal(expr):
        return True
    if not bigint_fields:
        return False
    # Only this.field — bare names are locals/params and may be number.
    for name in bigint_fields:
        if re.search(rf"\bthis\.{re.escape(name)}\b", expr):
            return True
    return False


def is_number_call(expr: str) -> bool:
    e = expr.strip()
    if not e.startswith("Number(") or not e.endswith(")"):
        return False
    return match_paren(e, e.index("(")) == len(e) - 1


def collect_fields(text: str):
    numbers = set()
    bigints = set()
    for m in FIELD_DECL.finditer(text):
        if m.group(1) is not None:
            name, kind = m.group(1), m.group(2)
        else:
            name, kind = m.group(3), m.group(4)
        if kind == "number":
            numbers.add(name)
        else:
            bigints.add(name)
    return numbers, bigints


def strip_outer_number_calls(expr: str) -> str:
    """Replace Number(...) subexpressions with 0 so nested safe casts do not re-wrap."""
    pat = re.compile(r"\bNumber\s*\(")
    prev = None
    cur = expr
    while prev != cur:
        prev = cur
        out = []
        i = 0
        n = len(cur)
        while i < n:
            m = pat.search(cur, i)
            if not m:
                out.append(cur[i:])
                break
            out.append(cur[i : m.start()])
            open_i = m.end() - 1
            close_i = match_paren(cur, open_i)
            if close_i < 0:
                out.append(cur[m.start() :])
                break
            out.append("0")
            i = close_i + 1
        cur = "".join(out)
    return cur


def rewrite_math_unary(text: str, bigint_fields) -> str:
    pat = re.compile(r"\bMath\.(floor|ceil|round|trunc|abs)\s*\(")
    out = []
    i = 0
    n = len(text)
    while i < n:
        m = pat.search(text, i)
        if not m:
            out.append(text[i:])
            break
        out.append(text[i : m.start()])
        open_i = m.end() - 1
        close_i = match_paren(text, open_i)
        if close_i < 0:
            out.append(text[m.start() :])
            break
        fn = m.group(1)
        arg = text[open_i + 1 : close_i]
        # Skip if whole arg is Number(...), or bigint only appears inside Number(...).
        residual = strip_outer_number_calls(arg)
        needs = (
            not is_number_call(arg)
            and has_bigint(residual, bigint_fields)
        )
        if needs:
            out.append(f"Math.{fn}(Number({arg}))")
        else:
            out.append(text[m.start() : close_i + 1])
        i = close_i + 1
    return "".join(out)


def rewrite_math_minmax(text: str, bigint_fields) -> str:
    pat = re.compile(r"\bMath\.(min|max)\s*\(")
    out = []
    i = 0
    n = len(text)
    while i < n:
        m = pat.search(text, i)
        if not m:
            out.append(text[i:])
            break
        out.append(text[i : m.start()])
        open_i = m.end() - 1
        close_i = match_paren(text, open_i)
        if close_i < 0:
            out.append(text[m.start() :])
            break
        fn = m.group(1)
        arg = text[open_i + 1 : close_i]
        parts = split_top_level_commas(arg)
        if len(parts) == 2 and any(has_bigint(p, bigint_fields) for p in parts):
            a, b = parts[0], parts[1]
            if fn == "min":
                out.append(f"(({a}) < ({b}) ? ({a}) : ({b}))")
            else:
                out.append(f"(({a}) > ({b}) ? ({a}) : ({b}))")
        else:
            out.append(text[m.start() : close_i + 1])
        i = close_i + 1
    return "".join(out)


def is_bigintish_operand(expr: str, bigint_fields) -> bool:
    e = expr.strip()
    if not e:
        return False
    if has_bigint_literal(e):
        return True
    m = re.fullmatch(r"this\.([#A-Za-z_][\w]*)", e)
    if m and m.group(1) in bigint_fields:
        return True
    if re.fullmatch(rf"(?:{TIME_LOCALS})", e):
        return True
    return False


def is_number_field_ref(expr: str, number_fields):
    if not number_fields:
        return None
    m = re.fullmatch(r"this\.([#A-Za-z_][\w]*)", expr.strip())
    if not m:
        return None
    name = m.group(1)
    if name in number_fields:
        return name
    return None


def rewrite_mixed_arith(text: str) -> str:
    number_fields, bigint_fields = collect_fields(text)
    if not number_fields:
        return text

    def fix_bigint_wrap(s: str) -> str:
        pat = re.compile(r"\bBigInt\s*\(")
        out = []
        i = 0
        n = len(s)
        while i < n:
            m = pat.search(s, i)
            if not m:
                out.append(s[i:])
                break
            out.append(s[i : m.start()])
            open_i = m.end() - 1
            close_i = match_paren(s, open_i)
            if close_i < 0:
                out.append(s[m.start() :])
                break
            inner = s[open_i + 1 : close_i].strip()
            mul_at = -1
            depth = 0
            j = 0
            while j < len(inner):
                c = inner[j]
                if c in "\"'`":
                    j = skip_string(inner, j)
                    continue
                if c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                elif c == "*" and depth == 0:
                    mul_at = j
                    break
                j += 1
            rewritten = False
            if mul_at >= 0:
                left = inner[:mul_at].strip()
                right = inner[mul_at + 1 :].strip()
                field_name = None
                other = None
                nf = is_number_field_ref(right, number_fields)
                if nf and is_bigintish_operand(left, bigint_fields):
                    field_name, other = nf, left
                else:
                    nf = is_number_field_ref(left, number_fields)
                    if nf and is_bigintish_operand(right, bigint_fields):
                        field_name, other = nf, right
                if field_name and other is not None and field_name not in bigint_fields:
                    out.append(f"(({other}) * BigInt(Math.floor(this.{field_name})))")
                    rewritten = True
            if not rewritten:
                out.append(s[m.start() : close_i + 1])
            i = close_i + 1
        return "".join(out)

    s = fix_bigint_wrap(text)

    for fname in sorted(number_fields, key=len, reverse=True):
        if bigint_fields:
            bf_alt = "|".join(
                re.escape(b) for b in sorted(bigint_fields, key=len, reverse=True)
            )
            s = re.sub(
                rf"\bthis\.({bf_alt})\s*\*\s*this\.{re.escape(fname)}\b",
                lambda m, fn=fname: f"this.{m.group(1)} * BigInt(Math.floor(this.{fn}))",
                s,
            )
            s = re.sub(
                rf"\bthis\.{re.escape(fname)}\s*\*\s*this\.({bf_alt})\b",
                lambda m, fn=fname: f"BigInt(Math.floor(this.{fn})) * this.{m.group(1)}",
                s,
            )
        s = re.sub(
            rf"\b({TIME_LOCALS})\s*\*\s*this\.{re.escape(fname)}\b",
            lambda m, fn=fname: f"{m.group(1)} * BigInt(Math.floor(this.{fn}))",
            s,
        )
        s = re.sub(
            rf"\bthis\.{re.escape(fname)}\s*\*\s*({TIME_LOCALS})\b",
            lambda m, fn=fname: f"BigInt(Math.floor(this.{fn})) * {m.group(1)}",
            s,
        )
    return s


def collapse_double_floor_bigint(text: str) -> str:
    prev = None
    cur = text
    pat = re.compile(
        r"BigInt\s*\(\s*Math\.floor\s*\(\s*BigInt\s*\(\s*Math\.floor\s*\(([^()]+)\)\s*\)\s*\)\s*\)"
    )
    while prev != cur:
        prev = cur
        cur = pat.sub(r"BigInt(Math.floor(\1))", cur)
    return cur


def sanitize(src: str) -> str:
    if not src:
        return src
    src = rewrite_mixed_arith(src)
    _number_fields, bigint_fields = collect_fields(src)
    src = rewrite_math_unary(src, bigint_fields)
    src = rewrite_math_minmax(src, bigint_fields)
    src = collapse_double_floor_bigint(src)
    return src


def main() -> None:
    src = sys.stdin.read()
    sys.stdout.write(sanitize(src))


if __name__ == "__main__":
    main()
