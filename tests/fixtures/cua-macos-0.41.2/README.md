# macOS CUA Driver 0.41.2 catalog

Captured on macOS with `cua-driver --version` = `cua-driver 0.41.2` and MCP `tools/list` on 2026-11-07. Of the 62 tools, this fixture retains the same 12 operations as the 0.33.1 fixture. Only names, required sets, and property type/enum metadata are retained; no user data or action results are included.

`double_click` and `right_click` now require `[]`; `set_value` requires `[value]`. The host continues requiring an explicit pid for these public actions. Additional backend properties are not exposed by the wrapper.
