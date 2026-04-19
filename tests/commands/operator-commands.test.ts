import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Command } from 'commander';
import { runDoctorCommand, registerDoctorCommands } from '../../src/commands/doctor.js';
import { runInitCommand, registerInitCommands } from '../../src/commands/init.js';
import { runTranscriptCommand, registerTranscriptCommands } from '../../src/commands/transcript.js';

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
    expect(result).toContain('defaultProvider=anthropic');
    expect(result).toContain('defaultModelId=anthropic-default');
  });

  it('runInitCommand creates project settings scaffold', async () => {
    const result = await runInitCommand(testDir);
    const settingsPath = join(testDir, '.xiaok', 'settings.json');
    const settingsText = readFileSync(settingsPath, 'utf8');

    expect(result).toContain(settingsPath);
    expect(settingsText).toContain('"permissions"');
    expect(settingsText).toContain('"statusBar"');
  });

  it('registers doctor and init top-level commands', () => {
    const program = new Command();

    registerDoctorCommands(program);
    registerInitCommands(program);
    registerTranscriptCommands(program);

    const commandNames = program.commands.map((command) => command.name());
    expect(commandNames).toContain('doctor');
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('transcript');
  });

  it('runTranscriptCommand reports repeated prompt growth from a transcript file', async () => {
    const transcriptDir = join(process.env.XIAOK_CONFIG_DIR!, 'transcripts');
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(
      join(transcriptDir, 'sess_demo.jsonl'),
      [
        JSON.stringify({ type: 'output', stream: 'stdout', raw: '> /\n', normalized: '> /\n', timestamp: 1 }),
        JSON.stringify({ type: 'output', stream: 'stdout', raw: '> /k\n', normalized: '> /k\n', timestamp: 2 }),
        JSON.stringify({ type: 'output', stream: 'stdout', raw: '> /ka\n', normalized: '> /ka\n', timestamp: 3 }),
        JSON.stringify({ type: 'output', stream: 'stdout', raw: '⚡ xiaok 想要执行以下操作\n', normalized: '⚡ xiaok 想要执行以下操作\n', timestamp: 4 }),
        JSON.stringify({ type: 'output', stream: 'stdout', raw: '⚡ xiaok 想要执行以下操作\n', normalized: '⚡ xiaok 想要执行以下操作\n', timestamp: 5 }),
      ].join('\n') + '\n',
    );

    const result = await runTranscriptCommand('sess_demo');

    expect(result).toContain('Transcript Analysis');
    expect(result).toContain('slashPromptGrowth=2');
    expect(result).toContain('approvalTitleRepeats=1');
  });
});
