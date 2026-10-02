const AUTHORIZATION_PATTERNS = [
    /permission\s+(?:denied|missing|required)/i,
    /approval\s+(?:denied|required|missing)/i,
    /authorization[^\n]*(?:denied|revoked|expired|invalid)/i,
    /policy[^\n]*(?:denied|revoked|disabled|invalid)/i,
    /disabled\s+by\s+(?:the\s+)?user/i,
];
const SESSION_ENDED_PATTERNS = [
    /session\s+['"][^'"]+['"]\s+has\s+ended/i,
    /call\s+start_session[^\n]*\brevive\b/i,
];
const TRANSPORT_CLOSED_PATTERNS = [
    /\btransport\s+(?:is\s+)?closed\b/i,
    /\bconnection\s+(?:is\s+)?closed\b/i,
    /\bbroken\s+pipe\b/i,
    /\bepipe\b/i,
    /\beconnreset\b/i,
];
function messageFromFailure(value) {
    if (typeof value === 'string')
        return value;
    if (value instanceof Error)
        return value.message;
    if (!value || typeof value !== 'object')
        return null;
    const result = value;
    if ('isError' in result && result.isError !== true)
        return null;
    if (typeof result.summary === 'string' && result.summary)
        return result.summary;
    if (typeof result.text === 'string' && result.text)
        return result.text;
    if (typeof result.message === 'string' && result.message)
        return result.message;
    return null;
}
/**
 * Classifies only failures that invalidate CUA authorization/session/transport
 * health. It is deliberately platform-neutral: this module is imported by the
 * cross-platform public wrapper and must never import macOS or driver bindings.
 */
export function classifyCuaRuntimeFailure(value) {
    const message = messageFromFailure(value);
    if (!message)
        return null;
    // Authorization has priority over lifecycle/transport words that may appear
    // in the same driver error. Recovery must never rotate a connection to bypass
    // an explicit deny.
    if (AUTHORIZATION_PATTERNS.some((pattern) => pattern.test(message))) {
        return { kind: 'authorization_denied', message };
    }
    const structured = value && typeof value === 'object' ? value.structuredContent : undefined;
    const refusal = structured && typeof structured === 'object' ? structured.refusal : undefined;
    if (refusal?.code === 'session_ended')
        return { kind: 'session_ended', message };
    if (SESSION_ENDED_PATTERNS.some((pattern) => pattern.test(message))) {
        return { kind: 'session_ended', message };
    }
    if (TRANSPORT_CLOSED_PATTERNS.some((pattern) => pattern.test(message))) {
        return { kind: 'transport_closed', message };
    }
    const normalized = message.toLowerCase();
    const mentionsCuaSocket = normalized.includes('cua-driver.sock');
    const daemonUnreachable = normalized.includes('cua-driver daemon not reachable')
        || (mentionsCuaSocket && normalized.includes('daemon not reachable'))
        || (mentionsCuaSocket && normalized.includes('connect enoent'))
        || (mentionsCuaSocket && normalized.includes('econnrefused'));
    return daemonUnreachable ? { kind: 'daemon_unreachable', message } : null;
}
/** Default-deny replay guard for calls whose first execution result is unknown. */
const OBSERVATION_FIELDS = Object.freeze({
    list_apps: Object.freeze(['session']),
    list_windows: Object.freeze(['pid', 'on_screen_only', 'session']),
    get_window_state: Object.freeze([
        'pid', 'window_id', 'capture_mode', 'include_screenshot', 'max_depth',
        'max_elements', 'query', 'session',
    ]),
});
export function isReplaySafeCuaCall(operation, input) {
    const allowed = Object.hasOwn(OBSERVATION_FIELDS, operation) ? OBSERVATION_FIELDS[operation] : undefined;
    // Check field presence, including empty values. Unknown future fields may
    // mutate state, so they require a deliberate contract update before replay.
    return Boolean(allowed && Object.keys(input).every(field => allowed.includes(field)));
}
