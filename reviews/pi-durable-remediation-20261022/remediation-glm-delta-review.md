**APPROVE** (for this narrow delta only).

Reasons:

1. **Fix is real and correct.** Previously, a failed dynamic `import()` (e.g., missing `dist/main/...` for the `emitted` variant) would throw after `createOwnedWorkflowNetworkFixture(null)` had allocated a real private server/network fixture, skipping the `finally` and leaking the fixture and its port. Moving both the module import and `moduleFile` resolution above fixture allocation eliminates that leak path.

2. **No assertion is weakened.** All assertions are unchanged; only evaluation order of setup statements changed. The `source`/`emitted` variant semantics and the `moduleFile` hash logging are preserved.

3. **No new leak path introduced.** If the import now throws, nothing has been allocated or mutated yet (fixture, `globalThis.fetch`, `process.env.KSWARM_SERVER_PATH` are all untouched), so no cleanup is required — safe. If fixture creation itself throws, that was already the pre-existing behavior and the fixture's own constructor is responsible for its internal state.

4. **`finally` remains sound.** `module` is guaranteed initialized when the `try` begins (import precedes it), so `module.sealAndDrainKSwarmServiceInstance` in `finally` cannot hit an uninitialized binding. `prior` env/fetch capture still precedes all mutations.

5. **Prior contracts unchanged.** This is a test-file-only ordering change; no production source, security invariants, or prior approvals are affected.

Consistent with the prior APPROVE on the packet; noting per your framing that full suites and the four registered-recipe files remain pending, so this is not an all-green or release-ready claim.
