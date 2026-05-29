import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopRoot = join(__dirname, '..', '..');

type ReactDoctorDiagnostic = {
  severity: string;
  category: string;
  rule: string;
  filePath: string;
  line: number;
  message: string;
};

type ReactDoctorReport = {
  projects: Array<{
    diagnostics: ReactDoctorDiagnostic[];
  }>;
};

function readDiagnostics(): ReactDoctorDiagnostic[] {
  const output = execFileSync(
    join(desktopRoot, 'node_modules', '.bin', 'react-doctor'),
    ['--json', '--no-score', '--fail-on', 'none'],
    {
      cwd: desktopRoot,
      encoding: 'utf8',
      maxBuffer: 80 * 1024 * 1024,
    },
  );
  const report = JSON.parse(output) as ReactDoctorReport;
  return report.projects.flatMap((project) => project.diagnostics);
}

describe('React Doctor button and accessibility remediation', () => {
  it('has no button elements missing an explicit type', { timeout: 90_000 }, () => {
    const diagnostics = readDiagnostics();
    const buttonTypeWarnings = diagnostics.filter((diagnostic) => diagnostic.rule === 'button-has-type');

    expect(buttonTypeWarnings).toEqual([]);
  });

  it('has no labels missing an associated form control', { timeout: 90_000 }, () => {
    const diagnostics = readDiagnostics();
    const labelWarnings = diagnostics.filter((diagnostic) => diagnostic.rule === 'label-has-associated-control');

    expect(labelWarnings).toEqual([]);
  });
});
