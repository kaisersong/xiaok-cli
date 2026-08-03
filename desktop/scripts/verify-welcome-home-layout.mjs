#!/usr/bin/env node

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const CDP_URL = process.env.XIAOK_DESKTOP_CDP_URL || 'http://127.0.0.1:9222';
const EXPECTED_VIEWPORT = { width: 1280, height: 820 };
const TOP_SCREENSHOT = join(tmpdir(), 'xiaok-welcome-home-layout-top.png');
const BOTTOM_SCREENSHOT = join(tmpdir(), 'xiaok-welcome-home-layout-bottom.png');

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const page = browser.contexts()
    .flatMap(context => context.pages())
    .find(candidate => candidate.url().includes('index') || candidate.url().includes('renderer'));
  if (!page) {
    throw new Error(`No Xiaok renderer page at ${CDP_URL}; launch the installed app with --remote-debugging-port=9222`);
  }

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await page.evaluate(() => {
      window.location.hash = '#/';
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="welcome-home"]', { timeout: 15_000 });
    await page.waitForTimeout(2_000);

    const topMetrics = await page.evaluate(() => {
      const main = document.querySelector('main');
      const home = document.querySelector('[data-testid="welcome-home"]');
      const outer = home?.parentElement;
      if (!main || !home || !outer) throw new Error('Welcome home layout nodes are missing');
      main.scrollTop = 0;

      const rect = selector => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing layout selector: ${selector}`);
        const value = element.getBoundingClientRect();
        return { top: Math.round(value.top), bottom: Math.round(value.bottom), height: Math.round(value.height) };
      };
      const layoutNodes = [outer, home, ...home.querySelectorAll(':scope > section')];

      return {
        viewport: { width: innerWidth, height: innerHeight },
        main: {
          clientHeight: main.clientHeight,
          scrollHeight: main.scrollHeight,
          clientWidth: main.clientWidth,
          scrollWidth: main.scrollWidth,
          overflowY: getComputedStyle(main).overflowY,
        },
        homePaddingBottom: getComputedStyle(home).paddingBottom,
        title: rect('[data-testid="welcome-home"] h1'),
        quickPrompts: rect('[data-testid="quick-prompts"]'),
        overview: rect('#welcome-overview-title'),
        continuation: rect('#welcome-continue-title'),
        layoutScrollOwners: layoutNodes
          .map(node => ({
            tag: node.tagName,
            testId: node.getAttribute('data-testid'),
            overflowY: getComputedStyle(node).overflowY,
          }))
          .filter(item => item.overflowY === 'auto' || item.overflowY === 'scroll'),
        documentHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    await page.screenshot({ path: TOP_SCREENSHOT });

    const bottomMetrics = await page.evaluate(async () => {
      const main = document.querySelector('main');
      const home = document.querySelector('[data-testid="welcome-home"]');
      const attention = document.querySelector('[aria-labelledby="welcome-continue-title"]');
      if (!main || !home || !attention) throw new Error('Welcome home scroll nodes are missing');

      main.scrollTop = main.scrollHeight;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const mainRect = main.getBoundingClientRect();
      const homeRect = home.getBoundingClientRect();
      const buttons = [...attention.querySelectorAll('button')];
      const finalContent = buttons.at(-1) || attention.lastElementChild;
      if (!finalContent) throw new Error('Welcome attention content is missing');
      const finalRect = finalContent.getBoundingClientRect();

      return {
        scrollTop: main.scrollTop,
        maxScrollTop: main.scrollHeight - main.clientHeight,
        reachedBottom: Math.abs(main.scrollTop - (main.scrollHeight - main.clientHeight)) <= 1,
        finalContentVisible: finalRect.bottom <= mainRect.bottom + 1,
        bottomBreathingRoom: Math.round(mainRect.bottom - finalRect.bottom),
        contentOwnedBreathingRoom: Math.round(homeRect.bottom - finalRect.bottom),
      };
    });
    await page.screenshot({ path: BOTTOM_SCREENSHOT });

    const { main, viewport, title, overview, layoutScrollOwners } = topMetrics;
    const { bottomBreathingRoom } = bottomMetrics;
    const checks = {
      viewportMatches: viewport.width === EXPECTED_VIEWPORT.width && viewport.height === EXPECTED_VIEWPORT.height,
      titleTop: title.top >= 145 && title.top <= 155,
      overviewTop: overview.top >= 600 && overview.top <= 625,
      scrollable: main.scrollHeight > main.clientHeight && bottomMetrics.reachedBottom,
      bottomSpace: bottomBreathingRoom >= 80 && bottomMetrics.contentOwnedBreathingRoom >= 80,
      finalContentVisible: bottomMetrics.finalContentVisible,
      noHorizontalOverflow: main.scrollWidth <= main.clientWidth && !topMetrics.documentHorizontalOverflow,
      singleScrollOwner: main.overflowY === 'auto' && layoutScrollOwners.length === 0,
      noRuntimeErrors: consoleErrors.length === 0 && pageErrors.length === 0,
    };
    const result = {
      cdpUrl: CDP_URL,
      screenshots: { top: TOP_SCREENSHOT, bottom: BOTTOM_SCREENSHOT },
      topMetrics,
      bottomMetrics,
      consoleErrors,
      pageErrors,
      checks,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    if (Object.values(checks).some(value => !value)) {
      throw new Error(`Welcome home layout verification failed: ${JSON.stringify(checks)}`);
    }
  } finally {
    await page.evaluate(() => {
      document.querySelector('main')?.scrollTo({ top: 0 });
    }).catch(() => {});
    await browser.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
