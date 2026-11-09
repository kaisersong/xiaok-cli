# Desktop release source and draft gates

The release workflow prepares a draft. It does not publish or mark anything Latest.

`RELEASE_TAG` is validated as a stable `desktop-vX.Y.Z` tag before checkout. The create job resolves one full commit SHA, checks actual HEAD, both package versions and fresh origin/master ancestry, and verifies the current remote lightweight/annotated tag via `git ls-remote`. Every later job checks out that SHA. Every upload and draft asset validation repeats the fresh remote check and refuses a published release. Runs for one tag are serialized and never cancel an ongoing release preparation.

The Node helper uses structured Git/gh argv. Only an actual HTTP404 may create a draft. Authentication, transport, malformed JSON and wrong release identity all fail. The local bare-Git/fake-gh tests are integrity tests, not evidence that an installer or release actually works. The captured `gh --include` test fixture came from a private loopback HTTP server with dummy credentials and an empty private GH configuration.

## Operator handoff

After the automated draft checks, quality must still validate the actual dmg/exe installation, packaged runtime and CLI tgz on the exact full release SHA. Run the CLI build, pack and verify sequence required by AGENTS.md; CLI/Desktop versions must match the tag. A release titled CLI & Desktop must also have the corresponding npm version. Record explicitly any untested platform or deferred gate.

Only after formal installer smoke and written approval may the operator explicitly promote the already verified draft. There is no workflow bypass flag and no synthetic smoke receipt. After that manual promotion, run the original published/latest validator from the same commit:

```sh
node scripts/verify-desktop-release.mjs desktop-v1.6.3
```

The original validator remains unchanged. Passing `--prepublish` is asset/metadata validation of a draft, not the published/latest or formal installer gate. No signing, tag creation, npm publication, GitHub release publication or system installation is performed by local implementation tests.

Remote/tag and release-state checks are point-in-time checks. They do not claim atomic exclusion of an external repository administrator changing a tag/release after a check, nor rewrite unsafe workflows stored in historical commits. They assume the actual fixed actions/checkout origin for this repository, not an arbitrary caller-supplied Source or OS authority proof.

Both desktop workflows pin the reviewed plugin, KSwarm and Broker commits. `scripts/check-desktop-sibling-pins.mjs` remains the common check for every original clone occurrence.

## Known publication window

The GitHub draft check and asset upload are separate requests. If an external administrator or another publisher promotes the release after the check, uploaded assets and updater metadata can become public before the immediate post-upload check returns. A later failure cannot undo that visibility. The same-tag concurrency group coordinates this workflow only; it does not lock external publishers. This is an unresolved external coordination boundary, not a risk acceptance or an installer-smoke pass.

Keep the release draft until both platform uploads, asset checks and formal quality approval are complete. If premature publication is detected, stop promotion and record the actual public version/assets; do not automatically reset the release, delete assets or claim nothing was exposed. The upload branch checks immediately before and after upload and reports that upload may already have completed if the latter check fails; the combined verifier checks again after both platforms finish. There is no claim of a post-upload atomic transaction.

The parser also replays an actual private-loopback gh 302-to-200 observation. Unexpected multiple HTTP status blocks are intentionally rejected; a first 404 in an ambiguous payload is not evidence that a release is absent.
