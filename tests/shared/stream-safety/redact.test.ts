import { describe, expect, it } from 'vitest';
import {
  MODEL_OUTPUT_CAP,
  SENSITIVE_FILE_REDACTION,
  capForModel,
  isSensitiveFilePath,
  redactSecrets,
  sanitizeToolOutput,
} from '../../../src/shared/stream-safety/redact.js';

describe('stream safety redaction', () => {
  it('redacts common secret formats without leaving raw values', () => {
    const input = [
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      'https://api.example.test/v1?api_key=sk-test_abcdefghijklmnopqrstuvwxyz&mode=1',
      'x-api-key: sk-live_abcdefghijklmnopqrstuvwxyz',
      'provider=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----',
      'postgres://reporter:secretPassword@example.test:5432/app',
    ].join('\n');

    const result = redactSecrets(input);

    expect(result.redacted).toBe(true);
    expect(result.text).toContain('Authorization: Bearer <redacted>');
    expect(result.text).toContain('api_key=<redacted>');
    expect(result.text).toContain('x-api-key: <redacted>');
    expect(result.text).toContain('provider=<redacted>');
    expect(result.text).toContain('AWS_ACCESS_KEY_ID=<redacted>');
    expect(result.text).toContain('<redacted:pem-private-key>');
    expect(result.text).toContain('postgres://reporter:<redacted>@example.test:5432/app');
    expect(result.text).not.toContain('secretPassword');
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('is idempotent and does not nest redaction markers', () => {
    const input = 'Authorization: Bearer sk-live_abcdefghijklmnopqrstuvwxyz';
    const once = redactSecrets(input).text;
    const twice = redactSecrets(once).text;

    expect(twice).toBe(once);
    expect(twice).toBe('Authorization: Bearer <redacted>');
  });

  it('does not redact common non-secret opaque identifiers', () => {
    const input = [
      'git=0123456789abcdef0123456789abcdef01234567',
      'sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'digest=sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'url=https://example.test/public/path?search=plain',
      'code=const id = "abcdef0123456789";',
    ].join('\n');

    const result = redactSecrets(input);

    expect(result.text).toBe(input);
    expect(result.redacted).toBe(false);
  });

  it('caps model-facing output at the configured boundary', () => {
    const exact = 'a'.repeat(MODEL_OUTPUT_CAP);
    const over = `${exact}b`;

    expect(capForModel('').text).toBe('');
    expect(capForModel(exact)).toEqual({ text: exact, truncated: false });

    const capped = capForModel(over);
    expect(capped.truncated).toBe(true);
    expect(capped.text).toContain('输出已截断');
    expect(capped.text.startsWith(exact)).toBe(true);
  });

  it('detects sensitive file names for fail-closed reads', () => {
    expect(isSensitiveFilePath('/tmp/.env')).toBe(true);
    expect(isSensitiveFilePath('/tmp/.env.local')).toBe(true);
    expect(isSensitiveFilePath('/tmp/service.pem')).toBe(true);
    expect(isSensitiveFilePath('/tmp/private.key')).toBe(true);
    expect(isSensitiveFilePath('/tmp/id_rsa_backup')).toBe(true);
    expect(isSensitiveFilePath('/tmp/credentials.json')).toBe(true);
    expect(isSensitiveFilePath('/tmp/client.p12')).toBe(true);
    expect(isSensitiveFilePath('/tmp/readme.md')).toBe(false);
  });

  it('keeps suspicious key-value output but emits a warning', () => {
    const result = sanitizeToolOutput('config password=hunter2');

    expect(result.text).toBe('config password=hunter2');
    expect(result.warnings).toContain('possible secret-like field: password');
    expect(SENSITIVE_FILE_REDACTION).toBe('<file redacted: sensitive file type>');
  });
});
