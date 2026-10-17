import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Test payload only: run a real child through the production shell tool. */
export function shellNodeFixture(root: string, code: string): string {
  const script = join(root, `shell-payload-${randomUUID()}.cjs`);
  writeFileSync(script, code);
  const quote = (value: string) => process.platform === 'win32'
    ? `"${value}"`
    : `'${value.replaceAll("'", "'\\''")}'`;
  return `${quote(process.execPath)} ${quote(script)}`;
}
