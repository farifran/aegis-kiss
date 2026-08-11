#!/usr/bin/env bash
# =========================================================
# AEGIS HARNESS — MECHANICAL LANGUAGE DETECTOR & ADAPTER
# =========================================================
#
# Source-only library. Detects target project language mechanics,
# maps default capabilities, and prompts operator in TTY if ambiguous.
#
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "[AEGIS][FATAL] language_detector_lib_not_invocable" >&2
  exit 1
fi

aegis_detect_target_language() {
  local target_dir="${1:-.}"

  # 1. Inspect sentinel configuration files inside target_dir FIRST
  if [[ -f "${target_dir}/tsconfig.json" ]] || [[ -f "${target_dir}/package.json" ]]; then
    printf 'typescript\n'
    return 0
  fi

  if [[ -f "${target_dir}/pyproject.toml" ]] || [[ -f "${target_dir}/requirements.txt" ]] \
     || [[ -f "${target_dir}/setup.py" ]] || [[ -f "${target_dir}/Pipfile" ]]; then
    printf 'python\n'
    return 0
  fi

  if [[ -f "${target_dir}/Cargo.toml" ]]; then
    printf 'rust\n'
    return 0
  fi

  if [[ -f "${target_dir}/go.mod" ]]; then
    printf 'go\n'
    return 0
  fi

  if [[ -f "${target_dir}/pom.xml" ]] || [[ -f "${target_dir}/build.gradle" ]]; then
    printf 'java\n'
    return 0
  fi

  if [[ -f "${target_dir}/CMakeLists.txt" ]]; then
    printf 'cpp\n'
    return 0
  fi

  # 2. Inspect predominant file extensions in target_dir
  if [[ -d "${target_dir}" ]]; then
    local py_count rs_count go_count ts_count
    py_count="$(find "${target_dir}" -maxdepth 3 -name '*.py' 2>/dev/null | wc -l | tr -d ' ')"
    rs_count="$(find "${target_dir}" -maxdepth 3 -name '*.rs' 2>/dev/null | wc -l | tr -d ' ')"
    go_count="$(find "${target_dir}" -maxdepth 3 -name '*.go' 2>/dev/null | wc -l | tr -d ' ')"
    ts_count="$(find "${target_dir}" -maxdepth 3 -name '*.ts' 2>/dev/null | wc -l | tr -d ' ')"

    if [[ "${py_count}" -gt 0 ]] && [[ "${py_count}" -ge "${ts_count}" ]]; then
      printf 'python\n'
      return 0
    elif [[ "${rs_count}" -gt 0 ]]; then
      printf 'rust\n'
      return 0
    elif [[ "${go_count}" -gt 0 ]]; then
      printf 'go\n'
      return 0
    elif [[ "${ts_count}" -gt 0 ]]; then
      printf 'typescript\n'
      return 0
    fi
  fi

  # 3. Fall back to root-level sentinels if target_dir is ambiguous
  if [[ -f "tsconfig.json" ]] || [[ -f "package.json" ]]; then
    printf 'typescript\n'
    return 0
  fi

  if [[ -f "pyproject.toml" ]] || [[ -f "requirements.txt" ]]; then
    printf 'python\n'
    return 0
  fi

  if [[ -f "Cargo.toml" ]]; then
    printf 'rust\n'
    return 0
  fi

  if [[ -f "go.mod" ]]; then
    printf 'go\n'
    return 0
  fi

  # 4. Interactive fallback in TTY mode when ambiguous
  if [[ -t 0 ]] && [[ "${AEGIS_NON_INTERACTIVE:-0}" != "1" ]]; then
    echo "[AEGIS] Could not automatically detect project language for '${target_dir}'." >&2
    echo "Select target language:" >&2
    echo "  [1] TypeScript / JavaScript" >&2
    echo "  [2] Python" >&2
    echo "  [3] Rust" >&2
    echo "  [4] Go" >&2
    echo "  [5] Java" >&2
    echo "  [6] C / C++" >&2
    echo "  [7] Generic / Multi-language" >&2
    printf "Option [1-7]: " >&2
    read -r choice < /dev/tty || choice="7"
    case "${choice}" in
      1) printf 'typescript\n' ;;
      2) printf 'python\n' ;;
      3) printf 'rust\n' ;;
      4) printf 'go\n' ;;
      5) printf 'java\n' ;;
      6) printf 'cpp\n' ;;
      *) printf 'generic\n' ;;
    esac
    return 0
  fi

  # Default fallback
  printf 'generic\n'
  return 0
}
