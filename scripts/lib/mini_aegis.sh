#!/usr/bin/env bash
# scripts/lib/mini_aegis.sh — Lightweight Discovery, Forensics & Epistemic Prompt Synthesizer

set -euo pipefail

mini_aegis_discover_json() {
  local target_paths=("$@")
  python3 - "${target_paths[@]}" << 'EOF'
import sys, json, os, re

target_paths = sys.argv[1:]
results = []

for target in target_paths:
    if not target:
        continue
    if os.path.isfile(target):
        size_bytes = os.path.getsize(target)
        token_est = (size_bytes + 3) // 4
        is_truncated = size_bytes > 4096
        
        with open(target, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read(4096 if is_truncated else size_bytes)
        
        exports = []
        export_pattern = re.compile(r'^\s*export\s+(?:class|function|interface|type|const|enum)\s+([a-zA-Z0-9_$]+)', re.MULTILINE)
        exports = export_pattern.findall(content)
        
        results.append({
            "path": target,
            "exists": True,
            "sizeBytes": size_bytes,
            "exports": exports,
            "snippet": content,
            "truncated": is_truncated,
            "tokenEstimate": token_est
        })
    else:
        results.append({
            "path": target,
            "exists": False,
            "sizeBytes": 0,
            "exports": [],
            "snippet": "",
            "truncated": False,
            "tokenEstimate": 0
        })

print(json.dumps(results))
EOF
}

mini_aegis_synthesize_prompt() {
  local demand_text="${1-}"
  shift || true
  local target_paths=("$@")

  local evidence_json
  evidence_json="$(mini_aegis_discover_json "${target_paths[@]}")"

  python3 - "${demand_text}" "${evidence_json}" << 'EOF'
import sys, json, os

demand_text = sys.argv[1]
evidence = json.loads(sys.argv[2])

def read_file(path):
    if os.path.isfile(path):
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    return ""

agents_doc = read_file("AGENTS.md")
arch_doc = read_file("ARCHITECTURE.md")
skill_doc = read_file(".skills/briefing.md")

existing_count = sum(1 for e in evidence if e["exists"])
missing_count = sum(1 for e in evidence if not e["exists"])
total_bytes = sum(e["sizeBytes"] for e in evidence)
est_tokens = sum(e["tokenEstimate"] for e in evidence)

status = "clean"
if existing_count > 0 and missing_count == 0:
    status = "has_targets"
elif existing_count > 0 and missing_count > 0:
    status = "partial"

print("# AEGIS COGNITIVE HANDOVER\n")
print("## 1. System & Cognitive Governance\n")
print("### AGENTS.md")
print(agents_doc if agents_doc else "(empty / not found)")
print("\n### ARCHITECTURE.md")
print(arch_doc if arch_doc else "(empty / not found)")
print("\n### .skills/briefing.md")
print(skill_doc if skill_doc else "(empty / not found)")

print("\n## 2. Workspace Forensics & Evidence\n")
print(f"- Status: **{status.upper()}**")
print(f"- Existing targets: {existing_count} | Missing targets: {missing_count}")
print(f"- Total Target Bytes: {total_bytes} (~{est_tokens} tokens)")
print("- Findings:")
for e in evidence:
    if e["exists"]:
        exports_str = ", ".join(e["exports"]) if e["exports"] else "none"
        print(f"  * [TARGET-EXISTING] {e['path']} ({e['sizeBytes']} bytes, exports: {exports_str})")
    else:
        print(f"  * [TARGET-MISSING] {e['path']} (file does not exist in workspace)")

print("\n### Target Files Deep Inspection")
for e in evidence:
    print(f"\n#### `{e['path']}`")
    print(f"- Exists: {e['exists']} | Size: {e['sizeBytes']} bytes | Truncated: {e['truncated']}")
    print(f"- Exports: {json.dumps(e['exports'])}")
    if e["snippet"]:
        print("```ts\n" + e["snippet"] + "\n```")

print("\n## 3. Received Software Demand\n")
print(demand_text)
EOF
}

# Standalone CLI Entrypoint
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -lt 1 ]]; then
    printf 'Usage: %s "<demand_text>" [target_file1 target_file2 ...]\n' "$0" >&2
    exit 1
  fi
  demand="$1"
  shift || true
  mini_aegis_synthesize_prompt "${demand}" "$@"
fi
