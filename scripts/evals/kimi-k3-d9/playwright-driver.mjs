import { digestTaskIdentity } from './desktop-driver.mjs';

export const DESKTOP_SELECTOR_CONTRACT_V1 = Object.freeze({
  promptInput: 'textarea[aria-label]:visible',
  submitFromPrompt: 'xpath=ancestor::form',
  submitButton: 'button[type="submit"]:visible',
  completedAssistant: '[class~="group/assistantmsg"]',
  streamingAssistant: '.space-y-6 > [class~="max-w-[663px]"]',
});

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const MAX_EVENT_TYPES = 64;

function fail(code) {
  throw new Error(code);
}

function boundedSnapshot(taskId, snapshot) {
  if (
    typeof snapshot !== 'object'
    || snapshot === null
    || !TERMINAL_STATUSES.has(snapshot.status)
    || !Array.isArray(snapshot.events)
  ) {
    fail('KIMI_D9_DESKTOP_SNAPSHOT_INVALID');
  }
  const events = snapshot.events.slice(0, MAX_EVENT_TYPES);
  const eventTypes = events
    .map(event => event?.type)
    .filter(type => typeof type === 'string');
  return Object.freeze({
    taskIdDigest: digestTaskIdentity(taskId),
    status: snapshot.status,
    eventTypes: Object.freeze(eventTypes),
    usagePresent: events.some(event => (
      typeof event?.usage === 'object' && event.usage !== null
    )),
    toolResultCount: events.filter(event => (
      event?.type === 'tool_result'
      || event?.type === 'tool_completed'
      || event?.type === 'canvas_tool_result'
    )).length,
    durableCanaryCount: events.filter(event => (
      event?.type === 'durable_canary'
    )).length,
  });
}

function wait(delayMs) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export async function runPackagedRendererTask({
  page,
  prompt,
  expectedMarker,
  timeoutMs,
  pollIntervalMs,
}) {
  if (
    typeof prompt !== 'string'
    || prompt.length === 0
    || typeof expectedMarker !== 'string'
    || expectedMarker.length === 0
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || !Number.isSafeInteger(pollIntervalMs)
    || pollIntervalMs < 0
  ) {
    fail('KIMI_D9_DESKTOP_AUTOMATION_INPUT_INVALID');
  }

  const promptInput = page.locator(DESKTOP_SELECTOR_CONTRACT_V1.promptInput);
  await promptInput.fill(prompt);
  const submitButton = promptInput
    .locator(DESKTOP_SELECTOR_CONTRACT_V1.submitFromPrompt)
    .locator(DESKTOP_SELECTOR_CONTRACT_V1.submitButton);
  const submittedAt = performance.now();
  await submitButton.click();

  await page.waitForFunction(
    () => Boolean(window.xiaokDesktop?.getActiveTask),
    null,
    { timeout: timeoutMs },
  );
  const deadline = Date.now() + timeoutMs;
  let activeTask = null;
  do {
    activeTask = await page.evaluate(async () => (
      window.xiaokDesktop.getActiveTask()
    ));
    if (typeof activeTask?.taskId === 'string' && activeTask.taskId.length > 0) {
      break;
    }
    await wait(pollIntervalMs);
  } while (Date.now() < deadline);
  if (typeof activeTask?.taskId !== 'string' || activeTask.taskId.length === 0) {
    fail('KIMI_D9_DESKTOP_TASK_NOT_CREATED');
  }

  let timeToFirstUserVisibleAssistantContentMs = null;
  let expectedMarkerMatched = false;
  do {
    const [completedTexts, streamingTexts] = await Promise.all([
      page.locator(
        DESKTOP_SELECTOR_CONTRACT_V1.completedAssistant,
      ).allInnerTexts(),
      page.locator(
        DESKTOP_SELECTOR_CONTRACT_V1.streamingAssistant,
      ).allInnerTexts(),
    ]);
    const assistantTexts = [...completedTexts, ...streamingTexts];
    if (
      timeToFirstUserVisibleAssistantContentMs === null
      && assistantTexts.some(text => text.trim().length > 0)
    ) {
      timeToFirstUserVisibleAssistantContentMs = Math.max(
        0,
        performance.now() - submittedAt,
      );
    }
    if (assistantTexts.some(text => text.includes(expectedMarker))) {
      expectedMarkerMatched = true;
      break;
    }
    await wait(pollIntervalMs);
  } while (Date.now() < deadline);

  if (
    timeToFirstUserVisibleAssistantContentMs === null
    || !expectedMarkerMatched
  ) {
    fail('KIMI_D9_DESKTOP_TASK_TIMEOUT');
  }

  do {
    const recovered = await page.evaluate(async taskId => (
      window.xiaokDesktop.recoverTask(taskId)
    ), activeTask.taskId);
    if (TERMINAL_STATUSES.has(recovered?.snapshot?.status)) {
      return Object.freeze({
        ...boundedSnapshot(activeTask.taskId, recovered.snapshot),
        timeToFirstUserVisibleAssistantContentMs,
        totalLatencyMs: Math.max(0, performance.now() - submittedAt),
      });
    }
    await wait(pollIntervalMs);
  } while (Date.now() < deadline);

  fail('KIMI_D9_DESKTOP_TASK_TIMEOUT');
}
