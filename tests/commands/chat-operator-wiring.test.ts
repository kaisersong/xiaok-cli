import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat operator wiring', () => {
  it('keeps settings/context built-in and redirects doctor/init before slash skill dispatch', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("trimmed === '/doctor'");
    expect(source).toContain("trimmed === '/init'");
    expect(source).toContain("trimmed === '/settings'");
    expect(source).toContain("trimmed === '/context'");
    expect(source).toContain('chat 中已不再支持 /doctor');
    expect(source).toContain('chat 中已不再支持 /init');
    expect(source).not.toContain("from './doctor.js'");
    expect(source).not.toContain("from './init.js'");
    expect(source).not.toContain('runDoctorCommand');
    expect(source).not.toContain('runInitCommand');

    const doctorIndex = source.indexOf("trimmed === '/doctor'");
    const slashIndex = source.indexOf('const slash = parseSlashCommand(trimmed);');
    expect(doctorIndex).toBeGreaterThan(-1);
    expect(doctorIndex).toBeLessThan(slashIndex);
  });
});
