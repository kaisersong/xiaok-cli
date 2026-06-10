import { describe, expect, it } from 'vitest';
import { classifyMcpStartupError } from '../../electron/mcp-error-classifier';

describe('classifyMcpStartupError', () => {
  it('detects required Python version from package metadata', () => {
    const detail = 'ERROR: Package slide-renderer requires Python >=3.10 but the running Python is 3.9.6';
    const result = classifyMcpStartupError(detail, 'python3');
    expect(result.category).toBe('python_version_too_old');
    expect(result.requiredVersion).toBe('3.10');
  });

  it('detects detected Python version from runtime message', () => {
    const detail = 'Python 3.9 is not supported by this MCP server';
    const result = classifyMcpStartupError(detail, '/usr/bin/python3');
    expect(result.category).toBe('python_version_too_old');
    expect(result.detectedVersion).toBe('3.9');
  });

  it('detects ModuleNotFoundError as missing module', () => {
    const detail = "ModuleNotFoundError: No module named 'mcp_server_slide_renderer'";
    const result = classifyMcpStartupError(detail, 'python3');
    expect(result.category).toBe('python_module_missing');
    expect(result.missingModule).toBe('mcp_server_slide_renderer');
  });

  it('detects walrus operator SyntaxError as version too old', () => {
    const detail = 'File "server.py", line 10\n    if (n := len(items)) > 0:\nSyntaxError: invalid syntax (walrus operator)';
    const result = classifyMcpStartupError(detail, 'python3');
    expect(result.category).toBe('python_version_too_old');
  });

  it('detects python command not found when command is python', () => {
    const detail = 'spawn python3 ENOENT';
    const result = classifyMcpStartupError(detail, 'python3');
    expect(result.category).toBe('python_version_too_old');
  });

  it('returns null category for unrelated errors', () => {
    const detail = 'connect ECONNREFUSED 127.0.0.1:8080';
    const result = classifyMcpStartupError(detail, 'node');
    expect(result.category).toBeNull();
  });

  it('does not classify ENOENT for non-python commands as python issue', () => {
    const detail = 'spawn node ENOENT';
    const result = classifyMcpStartupError(detail, 'node');
    expect(result.category).toBeNull();
  });
});
