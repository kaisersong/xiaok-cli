import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('chat terminal layout', () => {
  it('should not use bottom-fixed input cursor positioning sequences', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).not.toContain('\\x1b[1;${rows - 3}r');
    expect(source).not.toContain('\\x1b[${rows - 2};1H\\x1b[K');
    expect(source).not.toContain('\\x1b[${rows - 1};1H\\x1b[K');
    expect(source).not.toContain('\\x1b[${termRows - 3};1H');
  });

  it('should use compact helpers for submitted input and tool activity output', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('formatSubmittedInput');
    expect(source).toContain('formatToolActivity');
    expect(source).toContain('ToolExplorer');
    expect(source).toContain('beginActivity');
    expect(source).toContain('renderLive');
    expect(source).toContain('Answering');
    expect(source).toContain('getReassuranceTick');
    expect(source).toContain('TurnLayout');
    expect(source).toContain('consumeAssistantLeadIn');
  });

  it('should let InputReader own the prompt rendering to avoid slash-menu redraw corruption', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("const input = await inputReader.read('> ')");
    expect(source).not.toContain('renderInputPrompt();');
  });

  it('should clear the active input line before rendering the submitted bubble', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('replRenderer.prepareBlockOutput();');
  });

  it('should stop live activity and reset assistant rendering when a turn fails', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("runtimeHooks.on('turn_failed'");
    expect(source).toContain("runtimeHooks.on('turn_aborted'");
    expect(source).toContain('const handleTurnFailure = (error: unknown): void => {');
    expect(source).toContain('stopActivity();');
    expect(source).toContain('toolExplorer.reset();');
    expect(source).toContain('turnLayout.reset();');
    expect(source).toContain('mdRenderer.reset();');

    const failureHandlerUses = source.match(/handleTurnFailure\(e\);/g)?.length ?? 0;
    expect(failureHandlerUses).toBeGreaterThanOrEqual(2);
  });

  it('should render the status line inside the prompt renderer instead of after assistant output', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('inputReader.setStatusLineProvider');
    expect(source).not.toContain("const statusLine = statusBar.getStatusLine();\n          if (statusLine) process.stdout.write(statusLine + '\\n');");
    expect(source).not.toContain("const statusLine = statusBar.getStatusLine();\n      if (statusLine) process.stdout.write(statusLine + '\\n');");
  });

  it('should source the sticky current-intent summary from orchestration helpers instead of the status bar', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("from '../ui/orchestration.js'");
    expect(source).toContain('formatCurrentIntentSummaryLine');
    expect(source).toContain('summaryLine');
    expect(source).not.toContain("trimmed === '/tasks'");
    expect(source).not.toContain("trimmed === '/task'");
    expect(source).not.toContain("trimmed.startsWith('/task ')");
  });

  it('should expose an explicit takeover path for stale owned sessions', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain(".option('--takeover <id>'");
    expect(source).toContain("ownershipMode === 'takeover'");
    expect(source).toContain('takeoverSessionOwnership');
  });

  it('should reroute terminal output to the surviving tty stream when one ui stream errors', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('terminalUiFallbackStream');
    expect(source).toContain('getFallbackWriter');
    expect(source).toContain("stream === process.stdout ? 'stderr' : 'stdout'");
    expect(source).toContain("终端富交互输出已切换为兼容模式");
  });

  it('should pause and then restore live activity around blocking approval prompts', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('const withPausedLiveActivity = async');
    expect(source).toContain('statusBar.getActivitySnapshot()');
    expect(source).toContain('return withPausedLiveActivity(async () => {');
  });

  it('should bootstrap new intent plans into the ledger before the model starts the turn', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('bootstrapTurnIntentPlan');
    expect(source).toContain("turnIntentPlan.continuationMode === 'new_intent'");
    expect(source).toContain('activeIntentReminderBlock = buildIntentReminderBlock');
  });

  it('should collect sparse completed-intent feedback and feed contextual skill reranking', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('maybeCollectCompletedIntentFeedback');
    expect(source).toContain('skillEvalStore.markPromptedIntent');
    expect(source).toContain('skillScoreStore.recordFeedback');
    expect(source).toContain('observation.actualSkillName');
  });

  it('should render submitted input before the intent orchestration block in interactive chat', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    const inputWrite = source.indexOf('scrollRegion.writeSubmittedInput(formatSubmittedInput(trimmed));');
    const intentPrime = source.indexOf('await primeTurnIntentPlan(true);');

    expect(inputWrite).toBeGreaterThan(-1);
    expect(intentPrime).toBeGreaterThan(-1);
    expect(inputWrite).toBeLessThan(intentPrime);
  });
});
