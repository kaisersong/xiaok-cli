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
    const runtimeStateSource = readFileSync(join(process.cwd(), 'src', 'ui', 'tui', 'runtime-state.ts'), 'utf8');

    expect(source).toContain('formatSubmittedInput');
    expect(source).toContain('formatToolActivity');
    expect(source).toContain('ToolExplorer');
    expect(source).toContain('beginActivity');
    expect(source).toContain('stopLiveActivityTimer()');
    expect(source).toContain('TuiRuntimeState');
    expect(source).toContain('TurnLayout');
    expect(source).toContain('consumeAssistantLeadIn');
    expect(runtimeStateSource).toContain('getReassuranceTick');
  });

  it('should let InputReader own the prompt rendering to avoid slash-menu redraw corruption', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("input = await inputReader.read('> ')");
    expect(source).not.toContain('renderInputPrompt();');
  });

  it('should not show an input-ready footer before stdin is owned by the next read', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');
    const readIndex = source.indexOf("input = await inputReader.read('> ');");
    expect(readIndex).toBeGreaterThan(-1);

    const beforeRead = source.slice(Math.max(0, readIndex - 320), readIndex);
    expect(beforeRead).toContain('runtimeState.markInputReady();');
    expect(beforeRead).not.toContain('renderFooterChrome();');

    const cleanupStart = source.lastIndexOf('runtimeState.deactivateTurn();');
    const cleanupEnd = source.indexOf('// Live activity is stopped when content streaming starts', cleanupStart);
    const cleanupSource = source.slice(cleanupStart, cleanupEnd);
    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    expect(cleanupSource).toContain('scrollRegion.clearActivityState();');
    expect(cleanupSource).not.toContain('runtimeState.markInputReady();');
    expect(cleanupSource).toContain('renderFooterChrome();');

    expect(source).not.toContain([
      'if (deferredInput === null) {',
      '        runtimeState.markInputReady();',
      '        renderFooterChrome();',
      '      }',
      '    } catch (e) {',
    ].join('\n'));
  });

  it('keeps busy capture alive across post-turn cleanup until the next loop owns stdin', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('stashQueuedInputIfAny({ stopCapture: false });');
    expect(source).toContain('stashQueuedInputIfAny({ stopCapture: result.deferredInput !== null || result.exitRequested });');
    expect(source).toContain([
      "        input = await inputReader.read('> ');",
    ].join('\n'));
    const loopStart = source.indexOf('interactiveLoop: while (true) {');
    const refreshIndex = source.indexOf('await refreshSkills();', loopStart);
    const stashIndex = source.indexOf('stashQueuedInputIfAny({ stopCapture: false });', refreshIndex);
    const inputDeclIndex = source.indexOf('let input: string | null;', stashIndex);
    const markReadyIndex = source.indexOf('runtimeState.markInputReady();', inputDeclIndex);
    const readStart = source.indexOf("        input = await inputReader.read('> ');", markReadyIndex);
    expect(loopStart).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(loopStart);
    expect(stashIndex).toBeGreaterThan(refreshIndex);
    expect(inputDeclIndex).toBeGreaterThan(stashIndex);
    expect(markReadyIndex).toBeGreaterThan(inputDeclIndex);
    expect(readStart).toBeGreaterThan(markReadyIndex);
    const readEnd = source.indexOf('      }', readStart);
    expect(source.slice(readStart, readEnd)).not.toContain('stopBusyCapture();');
  });

  it('renders an empty prompt while InputReader owns stdin', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("const placeholder = frame.placeholder === '> ' ? '' : frame.placeholder;");
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

  it('wires ESC abort controllers through chat runtime turns and auto-continue', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("import { isAbortError } from '../ai/runtime/abort-utils.js';");
    expect(source).toContain('let currentTurnAbortController: AbortController | null = null;');
    expect(source).toContain('const requestCurrentTurnAbort = (): void => {');
    expect(source).toContain('onAbortRequest: requestCurrentTurnAbort');
    expect(source).toContain('controller.signal');
    expect(source).toContain("runtimeHooks.on('turn_stop'");
    expect(source).toContain("event.reason === 'user_aborted'");
    expect(source).toContain('autoContinueController.signal');
    expect(source).toContain('isAbortError(e)');
  });

  it('does not render AbortError as a failed turn error after ESC', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('const handleTurnAbort = (): void => {');
    expect(source).toContain('if (isAbortError(e)) {\n            handleTurnAbort();');
    expect(source).toContain('if (isAbortError(e)) {\n        handleTurnAbort();');
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
    expect(source).toContain("inputReader.setForcePlainMode(false);");
    expect(source).not.toContain("终端的富交互刷新出了问题，已退回普通输出模式");
  });

  it('should pause and then restore live activity around blocking approval prompts', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');
    const runtimeStateSource = readFileSync(join(process.cwd(), 'src', 'ui', 'tui', 'runtime-state.ts'), 'utf8');

    expect(source).toContain('new TuiRuntimeState(');
    expect(source).toContain('runtimeState.withPausedLiveActivity(action)');
    expect(runtimeStateSource).toContain('getActivitySnapshot()');
    expect(runtimeStateSource).toContain('beginActivity(snapshot.label, true, snapshot.startedAt);');
  });

  it('should bootstrap new intent plans into the ledger before the model starts the turn', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('bootstrapTurnIntentPlan');
    expect(source).toContain("turnIntentPlan.continuationMode === 'new_intent'");
    expect(source).toContain('activeIntentReminderBlock = buildIntentReminderBlock');
  });

  it('should ignore completed intents when priming reminders for the next input, while still collecting completion feedback', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("status === 'completed' || status === 'failed' || status === 'cancelled'");
    expect(source).toContain("intent.overallStatus === 'waiting_user'");
    expect(source).toContain('getWaitingUserIntentForInput');
    expect(source).toContain('finalizeCurrentTurnIntentIfNeeded');
  });

  it('should suppress compatibility-mode input separators and keep the busy state out of the input prompt row', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');
    const runtimeStateSource = readFileSync(join(process.cwd(), 'src', 'ui', 'tui', 'runtime-state.ts'), 'utf8');

    expect(source).toContain('!scrollRegion.isActive() && !terminalUiSuspended');
    expect(source).toContain('runtimeState.getFooterInputPrompt()');
    expect(source).toContain("scrollRegion.clearLastInput({ inputPrompt: getFooterInputPrompt() })");
    expect(source).toContain('if (scrollRegion.isActive() && !terminalUiSuspended) {');
    expect(runtimeStateSource).toContain("return this.snapshot.footerMode === 'busy' ? 'Finishing response...' : 'Type your message...';");
  });

  it('should attach busy input capture before rendering a busy footer prompt', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    const helperStart = source.indexOf('function ensureBusyInputCapture(): void {');
    const helperEnd = source.indexOf('let askUserQuestionPromptActive = false;', helperStart);
    const helperSource = source.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(helperSource).toContain('if (activeBusyCapture?.isActive()) {');
    expect(helperSource).toContain('return;');
    expect(helperSource).toContain('inputReader.startBusyCapture');

    const turnChromeStart = source.indexOf('const beginNormalInputTurnChrome = (submittedInput: string): void => {');
    const turnChromeEnd = source.indexOf("runtimeHooks.on('turn_started'", turnChromeStart);
    const turnChromeSource = source.slice(turnChromeStart, turnChromeEnd);
    const beginTurnIndex = turnChromeSource.indexOf("runtimeState.beginTurn('Thinking', { deferActivity: true })");
    const busyCaptureIndex = turnChromeSource.indexOf('ensureBusyInputCapture();');
    const clearInputIndex = turnChromeSource.indexOf('scrollRegion.clearLastInput({ inputPrompt: getFooterInputPrompt() })');
    const submittedInputIndex = turnChromeSource.indexOf('scrollRegion.writeSubmittedInput(formatSubmittedInput(submittedInput));');
    const activityIndex = turnChromeSource.indexOf("beginActivity('Thinking', true)");

    expect(turnChromeStart).toBeGreaterThan(-1);
    expect(turnChromeEnd).toBeGreaterThan(turnChromeStart);
    expect(beginTurnIndex).toBeGreaterThan(-1);
    expect(busyCaptureIndex).toBeGreaterThan(-1);
    expect(clearInputIndex).toBeGreaterThan(-1);
    expect(submittedInputIndex).toBeGreaterThan(-1);
    expect(activityIndex).toBeGreaterThan(-1);
    expect(beginTurnIndex).toBeLessThan(busyCaptureIndex);
    expect(busyCaptureIndex).toBeLessThan(clearInputIndex);
    expect(clearInputIndex).toBeLessThan(submittedInputIndex);
    expect(submittedInputIndex).toBeLessThan(activityIndex);

    const turnStartedStart = source.indexOf("runtimeHooks.on('turn_started'");
    const turnStartedEnd = source.indexOf("runtimeHooks.on('tool_started'", turnStartedStart);
    const turnStartedSource = source.slice(turnStartedStart, turnStartedEnd);

    expect(turnStartedStart).toBeGreaterThan(-1);
    expect(turnStartedEnd).toBeGreaterThan(turnStartedStart);
    expect(turnStartedSource).toContain('if (!normalTurnChromePrimed) {');
    expect(turnStartedSource).toContain("beginNormalInputTurnChrome('');");

    const askExitStart = source.indexOf('const exitAskUserQuestionPrompt = (): void => {');
    const askExitEnd = source.indexOf('// Wire up lazy callbacks for AskUserQuestion interactive prompt.', askExitStart);
    const askExitSource = source.slice(askExitStart, askExitEnd);
    const askBusyCaptureIndex = askExitSource.indexOf('ensureBusyInputCapture();');
    const askActivityIndex = askExitSource.indexOf("runtimeState.beginActivity(describeLiveActivity('AskUserQuestion', {}), true)");

    expect(askExitStart).toBeGreaterThan(-1);
    expect(askExitEnd).toBeGreaterThan(askExitStart);
    expect(askBusyCaptureIndex).toBeGreaterThan(-1);
    expect(askActivityIndex).toBeGreaterThan(-1);
    expect(askBusyCaptureIndex).toBeLessThan(askActivityIndex);

    const normalInputStart = source.indexOf('// 普通输入');
    const normalInputEnd = source.indexOf('// UserPromptSubmit hook', normalInputStart);
    const normalInputSource = source.slice(normalInputStart, normalInputEnd);

    expect(normalInputStart).toBeGreaterThan(-1);
    expect(normalInputEnd).toBeGreaterThan(normalInputStart);
    expect(normalInputSource).toContain('beginNormalInputTurnChrome(trimmed);');
  });

  it('should construct a dedicated tui runtime-state owner instead of keeping timer ownership inside chat.ts', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("from '../ui/tui/runtime-state.js'");
    expect(source).toContain('const runtimeState = new TuiRuntimeState({');
    expect(source).not.toContain('let liveActivityTimer: NodeJS.Timeout | null = null;');
    expect(source).not.toContain('let resumeActivityTimer: NodeJS.Timeout | null = null;');
    expect(source).not.toContain('let reassuranceTimer: NodeJS.Timeout | null = null;');
    expect(source).not.toContain('let footerBusy = false;');
  });

  it('should keep completed-intent feedback disabled by default to avoid footer/input collisions', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('const COMPLETED_INTENT_FEEDBACK_ENABLED = false;');
    expect(source).toContain('maybeCollectCompletedIntentFeedback');
    expect(source).toContain('skillScoreStore.recordFeedback');
    expect(source).toContain('observation.actualSkillName');
    expect(source).toContain('这次结果是否满足预期？ [y] 满意 / [n] 不满意 / [s] 跳过');
    expect(source).toContain('const answer = await inputReader.read(');
    expect(source).toContain("overlayKind: 'feedback'");
    expect(source).not.toContain('Feedback [y/n/s]: ');
    expect(source).not.toContain('这次 skill 路由是否合适？');
    expect(source).not.toContain('主要问题更接近需求理解错了吗？');
    expect(source).toContain('if (!COMPLETED_INTENT_FEEDBACK_ENABLED) {');
    expect(source).toContain('renderIntentSummaryLine();');
  });

  it('should always keep a reserved footer status row even when status text is blank', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain("lines.push(statusLine || ' ')");
  });

  it('should render submitted input before the intent orchestration block in interactive chat', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    const inputWrite = source.indexOf('beginNormalInputTurnChrome(trimmed);');
    const intentPrime = source.indexOf('await primeTurnIntentPlan(true);');

    expect(inputWrite).toBeGreaterThan(-1);
    expect(intentPrime).toBeGreaterThan(-1);
    expect(inputWrite).toBeLessThan(intentPrime);
    expect(source).toContain('scrollRegion.writeSubmittedInput(formatSubmittedInput(submittedInput));');
  });

  it('should route resume replay and stop-hook auto-continue transcript writes through the scroll region instead of raw stdout', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain('scrollRegion.writeAtContentCursor(chunk);');
    expect(source).toContain('scrollRegion.writeSubmittedInput(formatSubmittedInput(stopResult.message));');
    expect(source).toContain("if (scrollRegion.isActive() && !terminalUiSuspended) {");
  });

  it('describes --auto as low-risk auto approval instead of unconditional execution', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'commands', 'chat.ts'), 'utf8');

    expect(source).toContain(".option('--auto', '自动批准低风险工具调用，高风险命令仍需确认或被阻断')");
    expect(source).not.toContain(".option('--auto', '自动执行所有工具，无需确认（适用于 CI）')");
  });
});
