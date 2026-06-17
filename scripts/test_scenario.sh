#!/usr/bin/env bash
set -e

scenario="$1"

AEGIS_INVESTIGATION_INPUT="analyze repository topology" \
bash runtime_aegis.sh discovery \
"tests/scenarios/${scenario}"

cp .harness/runtime/epistemic_handover.json \
"/tmp/${scenario}_discovery.json"

bash runtime_aegis.sh forensics

cp .harness/runtime/epistemic_handover.json \
"/tmp/${scenario}_forensics.json"

diff \
  <(jq -S . "/tmp/${scenario}_discovery.json") \
  <(jq -S . "tests/golden/${scenario}/golden_discovery.json")

diff \
  <(jq -S . "/tmp/${scenario}_forensics.json") \
  <(jq -S . "tests/golden/${scenario}/golden_forensics.json")