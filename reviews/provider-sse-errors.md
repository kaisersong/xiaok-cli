# OpenAI-compatible SSE error repair

## Production evidence

The CLI received SDK APIError `NoRoom` from an HTTP 200 SSE response before executing tools. The runtime has no HTTP failure status to classify; adapter retry policy does not recognize the SDK's `server_error` type, outer model recovery sees no transient marker, and runtime fallback labels it `tool_failed`. The configured TensorFold service separately logged `NoRoom`, then CUDA illegal-address errors. A fresh minimal request returned SSE `server_error: CudaFailed` while `/health` claimed healthy. Restarting the idle existing container is recovery, not a proven fix for the upstream allocator/kernel defect.

## Design

Only the OpenAI adapter SDK boundary converts exact base-constructor status-less SDK APIErrors to a safe stream-failure shape. Preserve fixed-vocabulary error type and detail (`NoRoom`, `CudaFailed` only); never carry arbitrary message, body, headers, cause, endpoint, request or credentials. Do not change strict Kimi's existing redaction contract. Preserve APIUserAbortError/APIConnectionError/APIConnectionTimeoutError identities and causes. Classify this owned shape and recovery-window exhaustion as model_failed. Reuse existing retryable flags in adapter and recovery owner: capacity NoRoom/server_error is transient; sticky CudaFailed is terminal and requires service recovery; authentication/request/quota are terminal. An explicit permanent status/abort/caller cancellation must win. No tool dispatch happens before model stream commit.

## Adversarial review checklist

- Only actual SDK APIError without HTTP status enters the conversion. Plain tool Error('NoRoom') remains tool_failed, not a broad message match.
- Arbitrary provider text/type/code cannot enter logs or UI. Fixed diagnostics have revalidation at the sink; strict Kimi remains private.
- A failed stream may contain buffered tools: recovery drops uncommitted tools and cannot re-execute already completed tool effects.
- Cleanup, caller abort, permanent HTTP status, insufficient_quota and retryable=false remain authoritative. CudaFailed must not cause a 30-minute retry loop.
- Real HTTP + real OpenAI SDK regression must cover NoRoom then success, CudaFailed/no retry, unknown/private error fields and tool payload not dispatched. Exercise real runtime classification; retain baseline suites.

## Delivery

Use an isolated checkout and exact staging. Apply only reviewed changed source/compiled modules to the canonical CLI checkout after confirming it is idle/unchanged, preserving concurrent repository updates and existing entrypoint links. Verify the actual local CLI and configured service; do not publish or merge without current session authorization.

## Independent pre-implementation review

gpt-6-astra (explicit model routing) identified two P1 cases, both accepted before implementation: SDK transport/abort subclasses must not be converted; recovery-window exhaustion needs an owned error code so its final normalization stays model_failed. Tests include both SSE forms, real SDK subclass identity, and persistent NoRoom exhaustion.

## Verified existing timeout boundary

The real SDK7.7 timeout carries an internal AbortError cause. With SDK HTTP retries disabled, the existing outer recovery treats that cause as terminal. This patch preserves its original class/cause and does not change that pre-existing policy; the real HTTP test asserts identity rather than claiming timeout recovery. Real disconnects separately exercise outer recovery. Generic adapter completion still commits on finish_reason, not HTTP EOF.

Final independent review caught a missing permanent `invalid_api_key` code under a `server_error` wrapper. Added it to both whitelists and parameterized the real HTTP precedence test across all seven permanent codes before live installation.
