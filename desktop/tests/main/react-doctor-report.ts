import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const desktopRoot = join(__dirname, '..', '..');

export type ReactDoctorDiagnostic = {
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

export async function readReactDoctorDiagnostics(maxBuffer = 80 * 1024 * 1024): Promise<ReactDoctorDiagnostic[]> {
  const { stdout } = await execFileAsync(
    join(desktopRoot, 'node_modules', '.bin', 'react-doctor'),
    ['--json', '--no-score', '--fail-on', 'none'],
    {
      cwd: desktopRoot,
      encoding: 'utf8',
      maxBuffer,
    },
  );
  const report = JSON.parse(stdout) as ReactDoctorReport;
  return report.projects.flatMap((project) => project.diagnostics);
}
