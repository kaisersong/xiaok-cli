import { basename, extname } from 'node:path';
export const MODEL_OUTPUT_CAP = 256 * 1024;
export const MODEL_OUTPUT_TRUNCATION_MARKER = '\n[…输出已截断，仅保留前 256KB]';
export const SENSITIVE_FILE_REDACTION = '<file redacted: sensitive file type>';
const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g;
const REDACTION_PATTERNS = [
    [PEM_PRIVATE_KEY_PATTERN, '<redacted:pem-private-key>'],
    [/\b(Authorization\s*[:=]\s*(?:Bearer|Basic|Token)\s+)([A-Za-z0-9._~+/=-]{8,})/gi, '$1<redacted>'],
    [/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|token|password|passwd)=)([^&#\s"'<>]+)/gi, '$1<redacted>'],
    [/\b((?:x[-_])?(?:api[-_]?key|auth[-_]?token|access[-_]?token|secret[-_]?key)\s*[:=]\s*)([^\s"'<>;&]+)/gi, '$1<redacted>'],
    [/\b((?:AWS_)?ACCESS_KEY_ID\s*[:=]\s*)(A(?:KI|SI)A[0-9A-Z]{16})\b/g, '$1<redacted>'],
    [/\b(A(?:KI|SI)A[0-9A-Z]{16})\b/g, '<redacted>'],
    [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '<redacted>'],
    [/\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|gh[opsur]_[0-9A-Za-z]{30,}|xox[abprs]-[0-9A-Za-z-]{20,})\b/g, '<redacted>'],
    [
        /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|amqps):\/\/[^:\s/@]+:)([^@<>\s]+)(@[\w.-][^\s]*)/gi,
        '$1<redacted>$3',
    ],
];
const WARNING_FIELD_PATTERN = /\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*([^\s"'<>]+)/gi;
export function redactSecrets(input) {
    let text = input;
    let redacted = false;
    for (const [pattern, replacement] of REDACTION_PATTERNS) {
        text = text.replace(pattern, (...args) => {
            redacted = true;
            return replacement.replace(/\$(\d+)/g, (_, index) => args[Number(index)] ?? '');
        });
    }
    return {
        text,
        redacted,
        warnings: detectSuspiciousFields(text),
    };
}
export function capForModel(input, maxChars = MODEL_OUTPUT_CAP) {
    if (input.length <= maxChars) {
        return { text: input, truncated: false };
    }
    return {
        text: `${input.slice(0, maxChars)}${MODEL_OUTPUT_TRUNCATION_MARKER}`,
        truncated: true,
    };
}
export function sanitizeToolOutput(input, options = {}) {
    const redacted = redactSecrets(input);
    const capped = options.cap === false
        ? { text: redacted.text, truncated: false }
        : capForModel(redacted.text, options.maxChars ?? MODEL_OUTPUT_CAP);
    return {
        text: capped.text,
        redacted: redacted.redacted,
        warnings: redacted.warnings,
        truncated: capped.truncated,
    };
}
export function isSensitiveFilePath(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    const name = basename(normalized).toLowerCase();
    const extension = extname(name);
    return (name === '.env' ||
        name.startsWith('.env.') ||
        extension === '.pem' ||
        extension === '.key' ||
        extension === '.p12' ||
        /^id_rsa(?:$|[._-])/.test(name) ||
        /^credentials(?:$|\.)/.test(name));
}
function detectSuspiciousFields(text) {
    const fields = new Set();
    for (const match of text.matchAll(WARNING_FIELD_PATTERN)) {
        fields.add(match[1].toLowerCase());
    }
    return [...fields].map((field) => `possible secret-like field: ${field}`);
}
