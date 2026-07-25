# MODE — FORENSICS

Decide **where to mutate** and **why** → `repair_candidates[{id,reason}]`.

## Constraints
1. Candidates only for paths in evidence payloads or operator-named net-new paths.
2. Prefer **one** candidate unless investigation explicitly names multiple paths.
3. No summaries, risks, or prose outside the JSON contract.
4. `reason` must reflect the demand (tokens or X→Y). Never invent features or paths.

## Output Schema
```json
{
  "status": "interpreted|inconclusive",
  "repair_candidates": [
    {
      "id": "<repo-relative path from anchors or operator-named only>",
      "reason": "Demand: <tokens or X→Y> (one change)"
    }
  ]
}
```
`status`: `interpreted` if ≥1 candidate, else `inconclusive`.
`repair_candidates[].id`: Copy path from anchors or operator-named. Never invent paths.
