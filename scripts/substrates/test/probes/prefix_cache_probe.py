#!/usr/bin/env python3
"""
Prefix-cache probe for the Aegis prompt design.

Replays REAL captured Aegis request payloads against a provider that
reports cache usage, twice each, and reports the cache-read counter.

Three arms, because a bare "cached == 0" reading is uninterpretable:

  A  as-shipped   the payload exactly as Aegis builds it today
  B  normalised   same payload with execution_id / generated_at /
                  manifest_hash neutralised (the design's ceiling)
  C  control      a deliberately long, obviously-cacheable prompt.
                  If C does not register a hit, the harness or the
                  account is the problem and A/B prove nothing.

Usage:
  OPENAI_API_KEY=sk-...  ./replay_cache_probe.py captures --provider openai
  ANTHROPIC_API_KEY=sk-ant-... ./replay_cache_probe.py captures --provider anthropic
"""
import argparse, glob, json, os, re, sys, time, urllib.request

VOL = [(r'"execution_id":"[^"]*"', '"execution_id":"fixed"'),
       (r'"generated_at":"[^"]*"', '"generated_at":"fixed"'),
       (r'"manifest_hash":"[^"]*"', '"manifest_hash":"fixed"'),
       (r'\b\d{10}-\d{3,6}\b', 'fixed-exec-id'),
       (r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', '2000-01-01T00:00:00Z')]


def normalise(s):
    for p, r in VOL:
        s = re.sub(p, r, s)
    return s


def post(url, payload, headers, timeout=120):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def openai_call(sys_msg, usr_msg, model, key):
    body = post("https://api.openai.com/v1/chat/completions",
                {"model": model, "max_tokens": 16, "temperature": 0,
                 "messages": [{"role": "system", "content": sys_msg},
                              {"role": "user", "content": usr_msg}]},
                {"Authorization": f"Bearer {key}"})
    u = body.get("usage", {})
    return (u.get("prompt_tokens"),
            (u.get("prompt_tokens_details") or {}).get("cached_tokens"))


def anthropic_call(sys_msg, usr_msg, model, key, cache_control):
    # Anthropic caching is EXPLICIT. Aegis sends no cache_control today,
    # so cache_control=False reproduces current behaviour (always 0) and
    # cache_control=True measures what the design could get.
    sys_block = [{"type": "text", "text": sys_msg}]
    if cache_control:
        sys_block[0]["cache_control"] = {"type": "ephemeral"}
    body = post("https://api.anthropic.com/v1/messages",
                {"model": model, "max_tokens": 16, "system": sys_block,
                 "messages": [{"role": "user", "content": usr_msg}]},
                {"x-api-key": key, "anthropic-version": "2023-06-01"})
    u = body.get("usage", {})
    return (u.get("input_tokens"), u.get("cache_read_input_tokens"))


def run_arm(name, sys_msg, usr_msg, args, key):
    print(f"\n--- arm {name} ---")
    results = []
    for i in (1, 2):
        try:
            if args.provider == "openai":
                pt, ct = openai_call(sys_msg, usr_msg, args.model, key)
            else:
                pt, ct = anthropic_call(sys_msg, usr_msg, args.model, key,
                                        args.anthropic_cache_control)
        except Exception as e:
            print(f"  call {i}: FAILED {e}")
            return None
        print(f"  call {i}: prompt_tokens={pt}  cached={ct}")
        results.append((pt, ct))
        if i == 1:
            time.sleep(args.gap)
    second = results[1][1] or 0
    print(f"  => second-call cache read: {second} tokens "
          f"{'HIT' if second > 0 else 'NO HIT'}")
    return second


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("captures")
    ap.add_argument("--provider", choices=["openai", "anthropic"], required=True)
    ap.add_argument("--model", default=None)
    ap.add_argument("--gap", type=float, default=3.0,
                    help="seconds between the two calls of an arm")
    ap.add_argument("--anthropic-cache-control", action="store_true",
                    help="add cache_control (Aegis does NOT do this today)")
    args = ap.parse_args()

    if args.model is None:
        args.model = ("gpt-4.1-mini" if args.provider == "openai"
                      else "claude-sonnet-4-5")
    keyvar = "OPENAI_API_KEY" if args.provider == "openai" else "ANTHROPIC_API_KEY"
    key = os.environ.get(keyvar)
    if not key:
        sys.exit(f"{keyvar} not set")

    files = sorted(glob.glob(os.path.join(args.captures, "request_*.json")))
    if not files:
        sys.exit("no captures found")
    req = json.load(open(files[0]))
    sys_msg = req["messages"][0]["content"]
    usr_msg = req["messages"][1]["content"]

    print("=" * 66)
    print(f"PREFIX-CACHE PROBE — {args.provider} / {args.model}")
    print(f"payload: {os.path.basename(files[0])}")
    print("=" * 66)

    a = run_arm("A  as-shipped", sys_msg, usr_msg, args, key)
    b = run_arm("B  normalised", normalise(sys_msg), normalise(usr_msg), args, key)

    filler = ("The following is inert padding used only to push this prompt "
              "well past the provider minimum cacheable prefix length. ") * 200
    c = run_arm("C  control (long, obviously cacheable)",
                filler, "Reply with the single word: ok.", args, key)

    print("\n" + "=" * 66)
    print("VERDICT")
    print("=" * 66)
    if c == 0 or c is None:
        print("INVALID RUN — the positive control did not register a cache hit.")
        print("Nothing can be concluded about arms A or B. Check the model,")
        print("the account, and that the two calls ran close enough together.")
        return
    print(f"control confirms the harness can observe cache reads ({c} tok).")
    print(f"  A as-shipped : {a} tok -> "
          f"{'prefix reuse IS happening' if a else 'NO reuse on the shipped prompt'}")
    print(f"  B normalised : {b} tok -> "
          f"{'reuse unlocked by removing volatile stamps' if b else 'still no reuse'}")
    if not a and b:
        print("\nCONCLUSION: the ordering discipline is not what blocks reuse —")
        print("the per-execution identity stamps are. Fix those first.")
    elif a:
        print("\nCONCLUSION: prefix discipline is load-bearing. Quantify per stage.")
    else:
        print("\nCONCLUSION: prefix reuse does not occur even at the design's")
        print("ceiling. The frozen-zone constraints buy nothing here.")


if __name__ == "__main__":
    main()
