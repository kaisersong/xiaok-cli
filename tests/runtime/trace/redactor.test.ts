import { describe, expect, it } from 'vitest';
import { redactString, redactTraceValue } from '../../../src/runtime/trace/redactor.js';

describe('trace redactor', () => {
  it('redacts provider keys, bearer tokens, cookies, private keys, and home paths', () => {
    const input = [
      'OPENAI_API_KEY=sk-test-123456789',
      'Authorization: Bearer abc.def.ghi',
      'Cookie: sessionid=abc; x-user=foo',
      '/Users/song/projects/xiaok-cli',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'secret-body',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n');

    const result = redactString(input, 'tool.output');

    expect(result.value).toContain('OPENAI_API_KEY=[REDACTED:api_key]');
    expect(result.value).toContain('Authorization: Bearer [REDACTED:bearer]');
    expect(result.value).toContain('Cookie: [REDACTED:cookie]');
    expect(result.value).toContain('/Users/[USER]/projects/xiaok-cli');
    expect(result.value).toContain('[REDACTED:private_key]');
    expect(result.value).not.toContain('sk-test-123456789');
    expect(result.value).not.toContain('abc.def.ghi');
    expect(result.value).not.toContain('secret-body');
    expect(result.redactions.map((r) => r.type)).toEqual(
      expect.arrayContaining(['api_key', 'bearer', 'cookie', 'home_path', 'private_key']),
    );
  });

  it('redacts high-frequency secret environment values and GitHub tokens', () => {
    const input = [
      'DATABASE_URL=postgres://user:pass@localhost:5432/db',
      'AWS_SECRET_ACCESS_KEY=abcd1234secret',
      'AWS_SESSION_TOKEN=session-token',
      'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz',
      'github_pat_11ABCDEF',
      'REDIS_URL=redis://:pass@localhost:6379',
      'CUSTOM_PASSWORD=hunter2',
    ].join('\n');

    const result = redactString(input, 'tool.output');

    expect(result.value).toContain('DATABASE_URL=[REDACTED:database_url]');
    expect(result.value).toContain('AWS_SECRET_ACCESS_KEY=[REDACTED:secret_env]');
    expect(result.value).toContain('AWS_SESSION_TOKEN=[REDACTED:secret_env]');
    expect(result.value).toContain('GITHUB_TOKEN=[REDACTED:secret_env]');
    expect(result.value).toContain('[REDACTED:github_token]');
    expect(result.value).toContain('REDIS_URL=[REDACTED:redis_url]');
    expect(result.value).toContain('CUSTOM_PASSWORD=[REDACTED:secret_env]');
    expect(result.value).not.toContain('postgres://user:pass');
    expect(result.value).not.toContain('abcd1234secret');
    expect(result.value).not.toContain('ghp_');
    expect(result.value).not.toContain('github_pat_');
    expect(result.value).not.toContain('hunter2');
  });

  it('redacts nested trace values without keeping raw secrets in redaction records', () => {
    const result = redactTraceValue({
      toolInput: {
        command: 'curl -H "Authorization: Bearer token-value" https://example.test',
      },
      env: {
        DATABASE_URL: 'postgres://user:pass@localhost/db',
      },
    });

    expect(JSON.stringify(result.value)).not.toContain('token-value');
    expect(JSON.stringify(result.value)).not.toContain('postgres://user:pass');
    expect(JSON.stringify(result.redactions)).not.toContain('token-value');
    expect(JSON.stringify(result.redactions)).not.toContain('postgres://user:pass');
    expect(result.redactions.length).toBeGreaterThanOrEqual(2);
  });
});
