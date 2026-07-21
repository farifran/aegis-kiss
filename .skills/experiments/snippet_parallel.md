
## Technique: Parallel constraints

Do **not** implement the first Acceptance name and stop.

1. In one mental pass, collect **all** constraints from Goal + Change + ALVO + FEEDBACK in parallel.  
2. Draft the **single** public export shape that can host every constraint (class with methods or one function — as demand implies).  
3. Write the full file so **every** constraint has a witness in the same edit — avoid multi-pass “I’ll add units later”.  
4. Final scan: any constraint without a line that witnesses it → still not done.  

One export. No parallel APIs. Edits only.
