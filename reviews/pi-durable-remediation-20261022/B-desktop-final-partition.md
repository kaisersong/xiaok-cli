# Desktop final evidence partition

Local: 824 complete files, 10159 passed / 0 failed / 8 skipped cases.

Population: 828 = 823 original local selection + 1 signed Loop file + 4 strict-recipe files pending actual qualified execution.

The four pending files originally contain128 cases, including1 original skip. They are not claimed green or counted as local skips.

| Whole-file replacement | Old P/F/S | Final P/F/S | Actual run |
| --- | --- | --- | --- |
| tests/main/desktop-post-seal-process.bdd.test.ts | 16/1/0 | 17/0/0 | B-D6-family-green |
| tests/main/conversation-activity-store.test.ts | 15/1/0 | 16/0/0 | root-activity-five-node24 |
| tests/main/loop-business-projection-independent.test.ts | 4/0/0 | 4/0/0 | B-loop-payload-green |
| tests/main/loop-business-projection.test.ts | 21/0/0 | 21/0/0 | B-loop-payload-green |
| tests/main/loop-output-consumers.test.ts | 7/0/0 | 7/0/0 | B-loop-payload-green |
| tests/main/loop-published-artifacts.test.ts | 33/0/0 | 33/0/0 | B-loop-payload-green |
| tests/main/desktop-multi-agent-activity-admission.bdd.test.ts | 23/0/0 | 23/0/0 | C-usage-related-final-node24 |
| tests/main/desktop-multi-agent-activity-boundaries.bdd.test.ts | 11/0/0 | 11/0/0 | C-usage-related-final-node24 |
| tests/main/desktop-multi-agent-activity-factory.bdd.test.ts | 14/1/0 | 18/0/0 | C-usage-related-final-node24 |
| tests/main/desktop-multi-agent-activity-service.bdd.test.ts | 67/0/0 | 67/0/0 | C-usage-related-final-node24 |
| tests/main/desktop-multi-agent-mailbox.bdd.test.ts | 13/1/0 | 14/0/0 | C-usage-related-final-node24 |

Loop8 is added once. Complete-file replacements remove the old whole-file counts first; no targeted result is added twice.

Original four failures, all raw/JSON hashes, per-file counts, actual Node22.22 C9 skips, drift and source coverage limits are in the adjacent JSON.

This is a combined evidence partition, not a claim that the original823 executed on one final source freeze. Other host runtime code is byte-identical by the recorded AST audit; its changed trusted-read path has fresh complete sibling65 and signed8 coverage. Root8 dependency closure is accounted by A separately.

Lowest Node22.22 signed Loop8 still requires actual CI; this summary does not infer it from local Node24. Remote recipe128 remains pending.
