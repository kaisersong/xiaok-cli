import { describe, expect, it } from 'vitest';
import { readReactDoctorDiagnostics } from './react-doctor-report';

describe('React Doctor first remediation batch', () => {
  it('has no remaining React Doctor errors or iframe sandbox warning', { timeout: 90_000 }, async () => {
    const diagnostics = await readReactDoctorDiagnostics();
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    const iframeSandboxWarnings = diagnostics.filter((diagnostic) => diagnostic.rule === 'iframe-missing-sandbox');

    expect(errors).toEqual([]);
    expect(iframeSandboxWarnings).toEqual([]);
  });
});
