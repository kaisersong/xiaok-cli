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
    summary: {
      errorCount: number;
      warningCount: number;
    };
  }>;
};

describe('React Doctor first remediation batch', () => {
  it('has no remaining React Doctor errors or iframe sandbox warning', { timeout: 90_000 }, () => {
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
    const diagnostics = report.projects.flatMap((project) => project.diagnostics);
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    const iframeSandboxWarnings = diagnostics.filter((diagnostic) => diagnostic.rule === 'iframe-missing-sandbox');

    expect(errors).toEqual([]);
    expect(iframeSandboxWarnings).toEqual([]);
  });
});
