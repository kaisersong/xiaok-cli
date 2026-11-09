# Desktop MCP runtime dependency closure

The restored actual Main context MCP endpoint imports @modelcontextprotocol/node and @modelcontextprotocol/server. Declare the original historical exact pins 2.1.1 / 2.3.0 directly in Desktop runtime dependencies so packaging does not rely on the development checkout's root node_modules fallback.

Actual npm package-lock-only/ignore-scripts/save-exact succeeded (8.560s). Strict JSON comparison: zero existing lock package nodes changed; five added nodes are the two direct packages plus @hono/node-server, hono and server's private zod. A private COW dependency tree npm install/ignore-scripts/no-audit/no-fund succeeded (1.812s), adding five packages; package and lock hashes remained identical. No shared dependency tree was modified.

Actual SDK smoke on Node24.16.0 and minimum22.14.0 each exited0 (.555s each), asserted Desktop-local resolution and exact versions, constructed real McpServer and WebStandardStreamableHTTPServerTransport, connected and closed the actual SDK. No listener, credentials, Source/Native qualification or task was created. Raw script/logs/population receipts are in task evidence; all roots naturally exited, zero signals and zero sampled descendants remained. Full Main/renderer builds, Windows and installed artifact verification remain for the final aggregate HEAD.

Codex implementation; official deepseek-v4-pro through actual xiaok production adapter independently reviewed the complete two-file diff and raw validation summary: no reachable blocker. No runtime permissions, four Native denials, baselines or existing dependency versions were changed.
