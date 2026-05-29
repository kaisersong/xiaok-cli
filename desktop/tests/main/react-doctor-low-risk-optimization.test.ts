import { beforeAll, describe, expect, it } from 'vitest';
import { readReactDoctorDiagnostics, type ReactDoctorDiagnostic } from './react-doctor-report';

let diagnostics: ReactDoctorDiagnostic[] = [];

beforeAll(async () => {
  diagnostics = await readReactDoctorDiagnostics(120 * 1024 * 1024);
}, 90_000);

function diagnosticsForRule(rule: string): ReactDoctorDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.rule === rule);
}

describe('React Doctor low-risk optimization batch', () => {
  it('does not scan generated or packaged desktop output', () => {
    const generatedDiagnostics = diagnostics.filter((diagnostic) => {
      const filePath = diagnostic.filePath;
      return (
        filePath.startsWith('release/') ||
        filePath.startsWith('dist/') ||
        filePath.startsWith('.generated/') ||
        /^e2e-.*\.[cm]?[jt]sx?$/.test(filePath)
      );
    });

    expect(generatedDiagnostics).toEqual([]);
  });

  it('clears mechanical accessibility control semantics diagnostics', () => {
    expect(diagnosticsForRule('control-has-associated-label')).toEqual([]);
    expect(diagnosticsForRule('click-events-have-key-events')).toEqual([]);
    expect(diagnosticsForRule('no-static-element-interactions')).toEqual([]);
  });

  it('clears mechanical Tailwind shorthand diagnostics', () => {
    expect(diagnosticsForRule('design-no-redundant-size-axes')).toEqual([]);
    expect(diagnosticsForRule('design-no-redundant-padding-axes')).toEqual([]);
  });

  it('clears lazy state initializer diagnostics', () => {
    expect(diagnosticsForRule('rerender-lazy-state-init')).toEqual([]);
  });

  it('clears repeated Intl formatter construction diagnostics', () => {
    expect(diagnosticsForRule('js-hoist-intl')).toEqual([]);
  });

  it('clears mechanical map/filter compaction diagnostics', () => {
    expect(diagnosticsForRule('js-flatmap-filter')).toEqual([]);
  });

  it('keeps repeated collection lookup diagnostics limited to reviewed low-risk leftovers', () => {
    expect(diagnosticsForRule('js-set-map-lookups').length).toBeLessThanOrEqual(4);
  });

  it('has a global reduced-motion fallback for desktop animations', () => {
    expect(diagnosticsForRule('require-reduced-motion')).toEqual([]);
  });

  it('reduces barrel imports to the remaining ambiguous cases', () => {
    expect(diagnosticsForRule('no-barrel-import').length).toBeLessThanOrEqual(20);
  });
});
