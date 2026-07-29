import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

function runDriver(source: string): any {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    '..',
    'scripts/evals/kimi-k3-d9/playwright-driver.mjs',
  )).href;
  const output = execFileSync(process.execPath, [
    '--input-type=module',
    '--eval',
    [
      `import * as subject from ${JSON.stringify(moduleUrl)};`,
      source,
    ].join('\n'),
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
    },
  });
  return JSON.parse(output.trim());
}

describe('Kimi K3 D9 packaged renderer automation contract', () => {
  it('submits through visible controls and reads only a bounded preload snapshot', async () => {
    const run = runDriver(`
      const calls = [];
      let evaluateCount = 0;
      const submitButton = {
        async click() { calls.push('click:submit'); },
      };
      const form = {
        locator(selector) {
          calls.push('locator:form:' + selector);
          return submitButton;
        },
      };
      const textarea = {
        async fill(value) { calls.push('fill:' + value); },
        locator(selector) {
          calls.push('locator:textarea:' + selector);
          return form;
        },
      };
      const assistant = {
        async allInnerTexts() {
          calls.push('read:assistant');
          return ['D9_EXPECTED_MARKER'];
        },
      };
      const page = {
        locator(selector) {
          calls.push('locator:page:' + selector);
          if (selector.includes('assistantmsg')) return assistant;
          if (selector.includes('space-y-6')) return assistant;
          return textarea;
        },
        async waitForFunction() { calls.push('wait:preload'); },
        async evaluate() {
          evaluateCount += 1;
          calls.push(
            evaluateCount <= 2
              ? 'preload:getActiveTask'
              : 'preload:recoverTask',
          );
          if (evaluateCount === 1) return null;
          if (evaluateCount === 2) return { taskId: 'task-d9' };
          return {
            snapshot: {
              id: 'task-d9',
              status: 'completed',
              events: [
                { type: 'assistant_delta', text: 'SECRET_RAW_OUTPUT' },
                {
                  type: 'canvas_tool_result',
                  output: 'SECRET_RAW_TOOL_OUTPUT',
                },
                {
                  type: 'task_completed',
                  usage: { inputTokens: 7, outputTokens: 2 },
                },
              ],
              result: { summary: 'SECRET_RAW_SUMMARY' },
            },
          };
        },
      };
      const result = await subject.runPackagedRendererTask({
        page,
        prompt: 'D9_VISIBLE_PROMPT',
        expectedMarker: 'D9_EXPECTED_MARKER',
        timeoutMs: 100,
        pollIntervalMs: 0,
      });
      console.log(JSON.stringify({
        selectors: subject.DESKTOP_SELECTOR_CONTRACT_V1,
        calls,
        result,
      }));
    `);

    expect(run.selectors).toEqual({
      promptInput: 'textarea[aria-label]:visible',
      submitFromPrompt: 'xpath=ancestor::form',
      submitButton: 'button[type="submit"]:visible',
      completedAssistant: '[class~="group/assistantmsg"]',
      streamingAssistant: '.space-y-6 > [class~="max-w-[663px]"]',
    });
    expect(run.calls).toEqual([
      'locator:page:textarea[aria-label]:visible',
      'fill:D9_VISIBLE_PROMPT',
      'locator:textarea:xpath=ancestor::form',
      'locator:form:button[type="submit"]:visible',
      'click:submit',
      'wait:preload',
      'preload:getActiveTask',
      'preload:getActiveTask',
      'locator:page:[class~="group/assistantmsg"]',
      'read:assistant',
      'locator:page:.space-y-6 > [class~="max-w-[663px]"]',
      'read:assistant',
      'preload:recoverTask',
    ]);
    expect(run.result).toEqual({
      taskIdDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      status: 'completed',
      eventTypes: ['assistant_delta', 'canvas_tool_result', 'task_completed'],
      usagePresent: true,
      toolResultCount: 1,
      durableCanaryCount: 0,
      timeToFirstUserVisibleAssistantContentMs: expect.any(Number),
      totalLatencyMs: expect.any(Number),
    });
    expect(JSON.stringify(run.result)).not.toContain('SECRET_RAW');
  });

  it('binds the real renderer to preload, IPC, main, and task snapshot methods', () => {
    const repoRoot = join(process.cwd(), '..');
    const welcome = readFileSync(join(
      repoRoot,
      'desktop/renderer/src/components/WelcomePage.tsx',
    ), 'utf8');
    const bridge = readFileSync(join(
      repoRoot,
      'desktop/renderer/src/api/bridge.ts',
    ), 'utf8');
    const preload = readFileSync(join(
      repoRoot,
      'desktop/electron/preload.cjs',
    ), 'utf8');
    const mainIpc = readFileSync(join(
      repoRoot,
      'desktop/electron/ipc.ts',
    ), 'utf8');

    expect(welcome).toContain('<ChatInput');
    expect(welcome).toContain('api.createTask({ prompt: text, materials: [] })');
    expect(bridge).toContain('window.xiaokDesktop.createTask(input)');
    expect(preload).toContain(
      "createTask: (input) => ipcRenderer.invoke('desktop:createTask', input)",
    );
    expect(mainIpc).toContain(
      "ipcMain.handle('desktop:createTask', async (_event, input) =>",
    );
    expect(mainIpc).toContain('services.createTask(input)');
    expect(preload).toContain(
      "recoverTask: (taskId) => ipcRenderer.invoke('desktop:recoverTask', { taskId })",
    );
    expect(mainIpc).toContain('services.recoverTask(input.taskId)');
  });
});
