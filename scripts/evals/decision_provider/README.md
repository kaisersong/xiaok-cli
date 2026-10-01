# Archived decision-provider experiment

Status: archived on 2026-09-30. This package is an isolated evaluation harness,
not a production tool-recommendation feature. It is not imported by CLI or
Desktop startup. The current Laya scalar-Noul recommendation protocol did not
meet the relevance/no-answer requirements and is not being integrated.

`DecisionService` exposes explicit `prepare`, `evaluate`, and `close` operations.
The Laya adapter supports Noul, Choice, and Score on the registered local
runtimes; the Jev worker currently advertises Noul only and requires explicit
remote authorization and `TYPESAFE_API_KEY`. Jev live service behavior has not
been verified. Windows is explicitly unsupported. Scores are uncalibrated.

The regression suite uses the real service, spawned worker transport, codecs,
and cleanup implementation. It needs Python 3.10+ and the standard library;
it does not download models or make live API calls:

```sh
python3 -m unittest scripts.evals.decision_provider.test_decision_service -v
```

The model-backed smoke/catalog scripts additionally require the exact runtime
versions and verified model assets in `laya-manifest.json`. Model preparation is
explicit, and output paths must not already exist. No weights, virtual
environments, credentials, or private transcript corpus belong in this package.

Design/review history and the closure decision are in the separate docs
repository under `xiaok-cli/analysis/2026-09-30-tool-recommendation-closure.md`.
The keyword rewrite probe is exploratory; it does not establish P0/P1 acceptance
or authorize production recommendations. Private evaluation inputs remain local.
