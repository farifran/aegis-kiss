#!/usr/bin/env python3
"""Score TokenBucket-like deliverable against abstract demand constraints (matrix)."""
from __future__ import annotations

import re
import sys
from pathlib import Path


def score(path: Path) -> dict:
    t = path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""
    checks = {
        "has_export_class_or_fn": bool(
            re.search(r"export\s+(class|function|\{)", t)
        ),
        "has_consume": bool(re.search(r"\bconsume\b", t)),
        "has_encode_state": bool(re.search(r"\bencodeState\b", t)),
        "has_bigint": bool(re.search(r"\bBigInt\b|\b0n\b|:\s*bigint\b", t)),
        "has_public_rate_units": bool(
            re.search(
                r"rateMBps|MB/s|MBps|capacityMB|Mbps|megabyte|bit/ms|bitsPerMs|ratePerMs|rateBits",
                t,
                re.I,
            )
        ),
        "has_lazy_refill": bool(
            re.search(r"\brefill\b|lastRefill|refillTimestamp|elapsed", t, re.I)
        ),
        "has_bitmask_ops": bool(
            re.search(r"<<\s*0|<<\s*1|0x0[12]|0b0|bit\s*0|bit0|state\s*\|=", t, re.I)
        ),
        "consume_debits": bool(
            re.search(r"tokens\s*-=|this\.tokens\s*-=|accumulation\s*-=", t)
        ),
    }
    # Domain-quality composite (0-8)
    keys = list(checks.keys())
    s = sum(1 for k in keys if checks[k])
    checks["score"] = s
    checks["max"] = len(keys)
    checks["pct"] = round(100.0 * s / len(keys), 1)
    return checks


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: score_fidelity.py <file.ts>")
        return 2
    p = Path(sys.argv[1])
    c = score(p)
    print(f"file={p}")
    for k, v in c.items():
        if k in ("score", "max", "pct"):
            continue
        print(f"  {k}={v}")
    print(f"  SCORE={c['score']}/{c['max']} ({c['pct']}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
