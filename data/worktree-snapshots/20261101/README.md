# Worktree snapshots - 2026-11-01

These archives preserve pending work before deleting ten old local worktrees. They are historical checkpoints, not qualified product changes. Do not merge or release their contents without review and regression tests.

Each archive contains `snapshot.json`, a binary-capable `tracked.patch` against `baselineCommit`, and `files/` with the exact pending source file contents (one fixture with an existing local username is represented only by its zero-context patch). `snapshot.json` records deletions, modes, and SHA-256 hashes. The baseline commits are retained on the `archive/worktrees-20261101/*` branches.

To recover: fetch the baseline branch, create a new worktree at its exact baseline commit, and extract the archive into a separate temporary directory. Apply `tracked.patch` with `git apply --unidiff-zero --binary` in the recovered worktree. Copy paths listed as originally untracked from `files/`, or use all `files/` entries to restore the final pending file state. Entries marked `patch-only` are restored by applying the patch against the baseline. Remove paths marked `deleted`; preserve executable modes and symlinks. Verify file hashes against the manifest before continuing development. The old staging split and merge metadata are retained only in the local cleanup archive.

Dependencies, test compilation caches, installed bundles, local profiles, handoff evidence, and two diagnostic JSON files containing a local username are kept only in the local cleanup archive. They are not uploaded.

Validation performed: SHA-256 round-trip verification of every pending source file, isolated Git-index patch-application checks against every baseline, Gitleaks scan with reviewed synthetic-test/hash findings, pre-commit hooks, and live GitHub ref/blob checks. Product regression tests, Windows installation checks, independent security review, and release qualification have not been run for these archived changes.
