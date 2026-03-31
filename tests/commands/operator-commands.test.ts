import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Command } from 'commander';
import { runDoctorCommand, registerDoctorCommands } from '../../src/commands/doctor.js';
import { runInitCommand, registerInitCommands } from '../../src/commands/init.js';

describe('operator commands', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-operator-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = join(testDir, '.config');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('runDoctorCommand reports config, credentials, and git availability', async () => {
    mkdirSync(process.env.XIAOK_CONFIG_DIR!, { recursive: true });
    writeFileSync(join(process.env.XIAOK_CONFIG_DIR!, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      defaultModel: 'claude',
      models: { claude: { model: 'claude-opus-4-6' } },
      defaultMode: 'interactive',
      contextBudget: 4000,
      channels: {},
    }));

    const result = await runDoctorCommand(testDir);

    expect(result).toContain('Config');
    expect(result).toContain('Credentials');
    expect(result).toContain('Git');
    expect(result).toContain('claude');
  });

  it('runInitCommand creates project settings scaffold', async () => {
    const result = await runInitCommand(testDir);
    const settingsPath = join(testDir, '.xiaok', 'settings.json');

    expect(result).toContain('.xiaok/settings.json');
    expect(readFileSync(settingsPath, 'utf8')).toContain('"permissions"');
  });

  it('registers doctor and init top-level commands', () => {
    const program = new Command();

    registerDoctorCommands(program);
    registerInitCommands(program);

    const commandNames = program.commands.map((command) => command.name());
    expect(commandNames).toContain('doctor');
    expect(commandNames).toContain('init');
  });
});
