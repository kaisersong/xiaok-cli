import { createRequire } from 'node:module';
import { join } from 'node:path';

function fail(code) {
  throw new Error(code);
}

function wait(delayMs) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function loadPlaywright(desktopRoot) {
  const requireFromDesktop = createRequire(join(desktopRoot, 'package.json'));
  return requireFromDesktop('playwright');
}

/**
 * Connects to the packaged app over CDP and returns { browser, page } where
 * page is the renderer page exposing window.xiaokDesktop.
 */
export async function connectToRenderer({
  desktopRoot,
  debuggingPort,
  timeoutMs = 30000,
  pollIntervalMs = 250,
  playwrightModule,
}) {
  const playwright = playwrightModule ?? loadPlaywright(desktopRoot);
  const endpoint = `http://127.0.0.1:${debuggingPort}`;
  const deadline = Date.now() + timeoutMs;
  let browser = null;
  while (Date.now() < deadline) {
    try {
      browser = await playwright.chromium.connectOverCDP(endpoint);
      break;
    } catch {
      await wait(pollIntervalMs);
    }
  }
  if (!browser) fail('PRODUCT_EVAL_CDP_CONNECT_TIMEOUT');
  try {
    while (Date.now() < deadline) {
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          const hasBridge = await page.evaluate(
            () => Boolean(window.xiaokDesktop),
          ).catch(() => false);
          if (hasBridge) {
            return { browser, page };
          }
        }
      }
      await wait(pollIntervalMs);
    }
  } catch {
    await browser.close().catch(() => {});
    fail('PRODUCT_EVAL_RENDERER_PROBE_FAILED');
  }
  await browser.close().catch(() => {});
  fail('PRODUCT_EVAL_RENDERER_NOT_FOUND');
}
