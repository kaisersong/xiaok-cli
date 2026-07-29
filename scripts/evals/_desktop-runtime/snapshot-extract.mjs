const ARTIFACT_EVENT = 'artifact_recorded';
const TOOL_CALL_EVENT = 'canvas_tool_call';
const TOOL_RESULT_EVENT = 'canvas_tool_result';

function fail(code) {
  throw new Error(code);
}

/**
 * Extracts product-eval signals from a FULL recoverTask snapshot.
 *
 * Normative artifact source is snapshot.events[] (type === 'artifact_recorded'):
 * the result.artifacts merge upstream is guarded by `&& snapshot.result` and can
 * drop artifacts in single-turn tasks, so snapshot.result is intentionally ignored.
 * An empty-string filePath is treated as missing.
 */
export function extractSessionSignals(snapshot) {
  if (
    typeof snapshot !== 'object'
    || snapshot === null
    || typeof snapshot.status !== 'string'
    || !Array.isArray(snapshot.events)
  ) {
    fail('PRODUCT_EVAL_SNAPSHOT_INVALID');
  }

  const artifacts = [];
  const toolInvocations = [];

  for (const event of snapshot.events) {
    if (typeof event !== 'object' || event === null) continue;
    if (event.type === ARTIFACT_EVENT) {
      if (typeof event.filePath === 'string' && event.filePath.length > 0) {
        artifacts.push(Object.freeze({
          artifactId: typeof event.artifactId === 'string' ? event.artifactId : '',
          kind: typeof event.kind === 'string' ? event.kind : 'other',
          label: typeof event.label === 'string' ? event.label : '',
          filePath: event.filePath,
        }));
      }
      continue;
    }
    if (event.type === TOOL_CALL_EVENT) {
      if (typeof event.toolName === 'string') {
        toolInvocations.push(Object.freeze({
          type: 'call',
          toolName: event.toolName,
          input: event.input,
        }));
      }
      continue;
    }
    if (event.type === TOOL_RESULT_EVENT) {
      if (typeof event.toolName === 'string') {
        toolInvocations.push(Object.freeze({
          type: 'result',
          toolName: event.toolName,
          ok: event.ok === true,
          response: typeof event.response === 'string' ? event.response : '',
        }));
      }
    }
  }

  return Object.freeze({
    status: snapshot.status,
    artifacts: Object.freeze(artifacts),
    toolInvocations: Object.freeze(toolInvocations),
  });
}
