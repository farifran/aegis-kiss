#!/usr/bin/env bash
# scripts/lib/mini_aegis.sh — Canonical High-Speed Discovery, Forensics & Epistemic Prompt Synthesizer

set -euo pipefail

mini_aegis_discover_context() {
  local targets_raw="${1:-}"
  local targets=() t

  # 1. Normaliza targets delimitados por vírgula ou espaço
  for t in $(printf '%s' "${targets_raw}" | tr ',' ' '); do
    if [[ -n "${t}" ]]; then
      targets+=("${t}")
    fi
  done

  # 2. Se o entry point principal existir (ex: src/index.ts) e não estiver na lista, inclui
  for ec in src/index.ts src/mod.ts src/main.ts index.ts; do
    if [[ -f "${ec}" ]]; then
      if [[ " ${targets[*]:-} " != *" ${ec} "* ]]; then
        targets+=("${ec}")
      fi
      break
    fi
  done

  # 3. Executa varredura atômica de alta performance (Python puro em < 15ms)
  python3 - "${targets[@]}" << 'EOF'
import sys, json, os, re, subprocess

target_paths = sys.argv[1:]
results = []

for target in target_paths:
    if not target:
        continue
    if os.path.isfile(target):
        size_bytes = os.path.getsize(target)
        is_truncated = size_bytes > 16384
        
        with open(target, 'r', encoding='utf-8', errors='ignore') as f:
            full_content = f.read()
            snippet = full_content[:16384] if is_truncated else full_content
        
        exports = []
        for line in full_content.splitlines():
            m = re.match(r'^\s*export\s+(?:(?:default\s+)?(?:async\s+)?(?:class|function|interface|type|const|let|var|enum))\s+([a-zA-Z0-9_$]+)', line)
            if m:
                exports.append(m.group(1))
            else:
                m_alias = re.match(r'^\s*export\s+\{([^}]+)\}', line)
                if m_alias:
                    tokens = [tok.strip().split()[-1] for tok in m_alias.group(1).split(',') if tok.strip()]
                    exports.extend(tokens)
        
        # Deduplicate preserving order
        seen = set()
        dedup_exports = []
        for exp in exports:
            if exp not in seen and re.match(r'^[a-zA-Z0-9_$]+$', exp):
                seen.add(exp)
                dedup_exports.append(exp)
        
        token_est = (size_bytes + 3) // 4
        
        results.append({
            "path": target,
            "exists": True,
            "sizeBytes": size_bytes,
            "bytes": size_bytes,
            "exports": dedup_exports,
            "snippet": snippet,
            "truncated": is_truncated,
            "tokenEstimate": token_est
        })
    else:
        results.append({
            "path": target,
            "exists": False,
            "sizeBytes": 0,
            "bytes": 0,
            "exports": [],
            "snippet": "",
            "truncated": False,
            "tokenEstimate": 0
        })

# Topology from git or directory
topology = []
try:
    git_files = subprocess.check_output(["git", "ls-files", "*.ts", "*.tsx", "*.js", "*.jsx"], stderr=subprocess.DEVNULL).decode("utf-8")
    topology = [line.strip() for line in git_files.splitlines() if line.strip()][:50]
except Exception:
    topology = [t["path"] for t in results if t["exists"]]

output = {
    "targets": results,
    "topology": topology
}

print(json.dumps(output))
EOF
}

mini_aegis_discover_json() {
  local targets_raw="$*"
  mini_aegis_discover_context "${targets_raw}" | jq -c '.targets'
}

mini_aegis_synthesize_prompt() {
  local demand_text="${1-}"
  shift || true
  local target_paths=("$@")

  local context_json
  context_json="$(mini_aegis_discover_context "${target_paths[*]}")"

  python3 - "${demand_text}" "${context_json}" << 'EOF'
import sys, json, os

demand_text = sys.argv[1]
context = json.loads(sys.argv[2])
evidence = context.get("targets", [])

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
total_bytes = sum(e.get("bytes", 0) for e in evidence)
est_tokens = sum(e.get("tokenEstimate", 0) for e in evidence)

status = "clean"
if existing_count > 0 and missing_count == 0:
    status = "has_targets"
elif existing_count > 0 and missing_count > 0:
    status = "partial"

print("<AEGIS_COGNITIVE_HANDOVER version=\"2.0\">")
print("<SYSTEM_CONSTRAINTS_AND_AXIOMS priority=\"ABSOLUTE_OVERRIDE\">")
print("<!-- Any violation of these invariants triggers immediate rejection by the AST Tribunal -->\n")
print("<cognitive_contract file=\"AGENTS.md\">")
print(agents_doc if agents_doc else "(empty / not found)")
print("</cognitive_contract>\n")
print("<architecture_invariants file=\"ARCHITECTURE.md\">")
print(arch_doc if arch_doc else "(empty / not found)")
print("</architecture_invariants>\n")
print("<formal_axioms file=\".skills/briefing.md\">")
print(skill_doc if skill_doc else "(empty / not found)")
print("</formal_axioms>")
print("</SYSTEM_CONSTRAINTS_AND_AXIOMS>\n")

print(f"<WORKSPACE_EVIDENCE status=\"{status.upper()}\" existing_targets=\"{existing_count}\" missing_targets=\"{missing_count}\" total_bytes=\"{total_bytes}\" token_estimate=\"{est_tokens}\">")
print("## Target Files Deep Inspection\n")
for e in evidence:
    tag = "TARGET-EXISTING" if e["exists"] else "TARGET-MISSING"
    print(f"### [{tag}] `{e['path']}` (exists={e['exists']}, bytes={e['bytes']}, truncated={e['truncated']})")
    if e["exports"]:
        print(f"- Exports: {json.dumps(e['exports'])}")
    if e["snippet"]:
        print("```ts\n" + e["snippet"] + "\n```")
print("</WORKSPACE_EVIDENCE>\n")

print("<RECEIVED_SOFTWARE_DEMAND>")
print(demand_text)
print("</RECEIVED_SOFTWARE_DEMAND>")
print("</AEGIS_COGNITIVE_HANDOVER>")
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
