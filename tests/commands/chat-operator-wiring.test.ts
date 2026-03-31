import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat operator wiring', () => {
  it('wires doctor/init/settings/context as built-in commands before slash skill dispatch', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("from './doctor.js'");
    expect(source).toContain("from './init.js'");
    expect(source).toContain("trimmed === '/doctor'");
    expect(source).toContain("trimmed === '/init'");
    expect(source).toContain("trimmed === '/settings'");
    expect(source).toContain("trimmed === '/context'");
    expect(source).toContain('runDoctorCommand');
    expect(source).toContain('runInitCommand');

    const doctorIndex = source.indexOf("trimmed === '/doctor'");
    const slashIndex = source.indexOf('const slash = parseSlashCommand(trimmed);');
    expect(doctorIndex).toBeGreaterThan(-1);
    expect(doctorIndex).toBeLessThan(slashIndex);
  });
});
