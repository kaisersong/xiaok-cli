# A2UI 1.0 protocol fixtures

The three JSON schemas are unmodified Apache-2.0 upstream fixtures from
https://github.com/a2ui-project/a2ui/tree/07aa6a72f9a81ec8d1f9461957af90b40cc75761/specification/v1_0/json
(`agent_to_renderer.json`, `common_types.json`, `catalog_definition.json`).
The upstream license is included in this directory.

Tests validate the xiaok-safe/1.0 catalog against the official catalog definition,
then use that catalog with the official message envelope to validate real compiler
output. The application supports a restricted analysis catalog and rejects RPC,
remote catalogs, arbitrary styles, URLs and event handlers. This does not assert
support for every upstream catalog, renderer function or transport.
