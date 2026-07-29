export const PRODUCT_SELECTOR_CONTRACT_V1 = Object.freeze({
  promptInput: 'textarea[aria-label]:visible',
  submitFromPrompt: 'xpath=ancestor::form',
  submitButton: 'button[type="submit"]:visible',
});

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function fail(code) {
  throw new Error(code);
}

function wait(delayMs) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

/**
 * Drives one product turn: fill the prompt, submit, wait for the task to reach
 * a terminal status, and return the FULL recoverTask snapshot (the product
 * scorers need filePath/toolName, so no bounded projection here).
 *
 * Throws with an INFRA-prefixed code when the UI contract itself fails
 * (selector missing / task never created), so callers can classify
 * infra-error separately from product failure.
 */
export async function runProductRendererTurn({
  page,
  prompt,
  timeoutMs,
  pollIntervalMs = 500,
}) {
  if (
    typeof prompt !== 'string'
    || prompt.length === 0
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
  ) {
    fail('PRODUCT_EVAL_TURN_INPUT_INVALID');
  }

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  let promptInput;
  try {
    promptInput = page.locator(PRODUCT_SELECTOR_CONTRACT_V1.promptInput);
    await promptInput.fill(prompt, { timeout: Math.min(timeoutMs, 15000) });
    const submitButton = promptInput
      .locator(PRODUCT_SELECTOR_CONTRACT_V1.submitFromPrompt)
      .locator(PRODUCT_SELECTOR_CONTRACT_V1.submitButton);
    await submitButton.click({ timeout: Math.min(timeoutMs, 15000) });
  } catch (error) {
    const wrapped = new Error('PRODUCT_EVAL_INFRA_SELECTOR_FAILED');
    wrapped.cause = error;
    throw wrapped;
  }

  await page.waitForFunction(
    () => Boolean(window.xiaokDesktop?.getActiveTask),
    null,
    { timeout: timeoutMs },
  ).catch(() => fail('PRODUCT_EVAL_INFRA_BRIDGE_MISSING'));

  let taskId = null;
  while (Date.now() < deadline) {
    const activeTask = await page.evaluate(async () => (
      window.xiaokDesktop.getActiveTask()
    )).catch(() => null);
    if (typeof activeTask?.taskId === 'string' && activeTask.taskId.length > 0) {
      taskId = activeTask.taskId;
      break;
    }
    await wait(pollIntervalMs);
  }
  if (taskId === null) fail('PRODUCT_EVAL_INFRA_TASK_NOT_CREATED');

  let firstVisibleAt = null;
  while (Date.now() < deadline) {
    const recovered = await page.evaluate(async id => (
      window.xiaokDesktop.recoverTask(id)
    ), taskId).catch(() => null);
    const snapshot = recovered?.snapshot;
    if (firstVisibleAt === null && Array.isArray(snapshot?.events)) {
      const hasVisibleContent = snapshot.events.some(event => (
        typeof event?.text === 'string' && event.text.trim().length > 0
      ));
      if (hasVisibleContent) firstVisibleAt = Date.now();
    }
    if (TERMINAL_STATUSES.has(snapshot?.status)) {
      return Object.freeze({
        taskId,
        snapshot,
        timeToFirstUserVisibleAssistantContentMs:
          firstVisibleAt === null ? null : firstVisibleAt - startedAt,
        totalLatencyMs: Date.now() - startedAt,
      });
    }
    await wait(pollIntervalMs);
  }
  fail('PRODUCT_EVAL_TURN_TIMEOUT');
}
