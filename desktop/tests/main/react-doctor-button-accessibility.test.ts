import { describe, expect, it } from 'vitest';
import { readReactDoctorDiagnostics } from './react-doctor-report';

describe('React Doctor button and accessibility remediation', () => {
  it('has no button elements missing an explicit type', { timeout: 90_000 }, async () => {
    const diagnostics = await readReactDoctorDiagnostics();
    const buttonTypeWarnings = diagnostics.filter((diagnostic) => diagnostic.rule === 'button-has-type');

    expect(buttonTypeWarnings).toEqual([]);
  });

  it('has no labels missing an associated form control', { timeout: 90_000 }, async () => {
    const diagnostics = await readReactDoctorDiagnostics();
    const labelWarnings = diagnostics.filter((diagnostic) => diagnostic.rule === 'label-has-associated-control');

    expect(labelWarnings).toEqual([]);
  });
});
