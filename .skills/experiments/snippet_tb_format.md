
## Whole-file reply (required shape)

Your reply must be a **whole-file** edit of the target, not empty fences.

Valid pattern (structure only — replace body with the real implementation):

```
src/tokenBucket.ts
<<<<<<< SEARCH
=======
// full file content here
>>>>>>> REPLACE
```

Or the aider whole-format for the loaded file.  
**Never** output an empty `diff` / empty SEARCH/REPLACE. If you cannot edit, output nothing (do not claim success).
