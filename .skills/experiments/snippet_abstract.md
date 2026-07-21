
## Technique: Abstract → concrete

1. Lift each demand statement to a **kind** (unit dual, timing, encoding, direction, named op, formula, Change step) — not to a product domain story.  
2. For each kind, pick one **witness pattern** in code (param+convert, call-time path, bit ops, A→B formula, method, literal).  
3. Implement witnesses first; fill details second.  
4. If a statement cannot lift to a kind, ignore it as prose.  

Never invent kinds the demand did not state. Edits only.
