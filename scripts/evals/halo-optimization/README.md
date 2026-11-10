# Halo optimization numerical evidence

`paired-statistics.mjs` implements six-cell matched-trajectory bootstrap statistics for the macOS acceptance scope authorized on 2026-11-01. Per cell there must be at least30 matched pairs and100 post-warmup complete wake chains per group; each operation kind has exactly the frozen group length. Cell/pair identity, positive finite values and fixed RNG schedule are checked. Each bootstrap sample resamples complete matched trajectories, jointly for all three operation kinds. The estimator is the ratio of within-cell pooled nearest-rank p95, not an average of trajectory p95s.

`evaluateCells` returns `qualified:false` even when all18 statistical criteria pass. It does not validate application/runtime provenance, raw warmup/cycle/authority fingerprints, managed peers, costs/resources or actual App scenarios. A complete Halo evidence validator must additionally prove all those gates; numerical fixtures alone cannot authorize a rollout. No candidate effects have been measured in the current study.

Run: `node --test scripts/evals/halo-optimization/paired-statistics.test.mjs`. Tests compare the weighted rank against physically expanded actual resamples, verify fixed-seed output including a noisy5% boundary, and reject missing bins, malformed pairing, pseudo-independent operations and invalid data.
