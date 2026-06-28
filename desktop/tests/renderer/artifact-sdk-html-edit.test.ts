import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { ARTIFACT_SDK_CODE } from '../../renderer/src/lib/artifact-sdk';

interface SdkDomOptions {
  rectForElement?: (el: Element, win: Window & typeof globalThis) => {
    x: number;
    y: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  requestAnimationFrame?: Window['requestAnimationFrame'];
}

function createSdkDom(bodyHtml: string, options: SdkDomOptions = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${bodyHtml}</body></html>`, {
    url: 'http://localhost',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  const messages: unknown[] = [];

  Object.defineProperty(win, 'parent', {
    configurable: true,
    value: {
      postMessage: (message: unknown) => {
        messages.push(message);
      },
    },
  });

  if (!win.CSS) {
    Object.defineProperty(win, 'CSS', {
      configurable: true,
      value: {},
    });
  }
  win.CSS.escape ||= (value: string) => value.replace(/([^\w-])/g, '\\$1');
  Object.defineProperty(win.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() {
      return this.textContent ?? '';
    },
  });
  Object.defineProperty(win.Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      if (options.rectForElement) {
        const rect = options.rectForElement(this as Element, win);
        return {
          ...rect,
          toJSON() {
            return {};
          },
        };
      }
      return {
        x: 10,
        y: 10,
        left: 10,
        top: 10,
        right: 210,
        bottom: 50,
        width: 200,
        height: 40,
        toJSON() {
          return {};
        },
      };
    },
  });
  win.getComputedStyle = (() => ({
    display: 'block',
    visibility: 'visible',
  })) as Window['getComputedStyle'];
  if (options.requestAnimationFrame) {
    win.requestAnimationFrame = options.requestAnimationFrame;
  }

  win.eval(ARTIFACT_SDK_CODE);

  return { dom, win, messages };
}

describe('artifact html edit sdk', () => {
  it('keeps edit selection boxes synced when the iframe scrolls or resizes', () => {
    expect(ARTIFACT_SDK_CODE).toContain('function syncEditBoxes');
    expect(ARTIFACT_SDK_CODE).toContain("window.addEventListener('scroll'");
    expect(ARTIFACT_SDK_CODE).toContain("window.addEventListener('resize'");
    expect(ARTIFACT_SDK_CODE).toContain('requestAnimationFrame');
  });

  it('allows editing text inside slide sections that carry export metadata', () => {
    const { dom, win, messages } = createSdkDom([
      '<section id="slide-1" data-export-role="kpi_dashboard">',
      '<div class="slide-content">',
      '<h1>我们用错了时代的操作系统</h1>',
      '</div>',
      '</section>',
    ].join(''));

    win.dispatchEvent(new win.MessageEvent('message', {
      data: { type: 'xiaok:setEditMode', enabled: true },
    }));
    win.document.querySelector('h1')?.dispatchEvent(new win.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));

    expect(messages).toContainEqual(expect.objectContaining({
      type: 'xiaok:editSelect',
      payload: expect.objectContaining({
        tagName: 'h1',
        text: '我们用错了时代的操作系统',
      }),
    }));

    dom.window.close();
  });

  it('keeps the selected edit box aligned when requestAnimationFrame does not flush after iframe scroll', async () => {
    const { dom, win } = createSdkDom([
      '<section id="slide-1" data-export-role="kpi_dashboard">',
      '<div class="slide-content">',
      '<h1 id="slide-title">我们用错了时代的操作系统</h1>',
      '</div>',
      '</section>',
    ].join(''), {
      requestAnimationFrame: (() => 1) as Window['requestAnimationFrame'],
      rectForElement: (el, currentWindow) => {
        const top = el.id === 'slide-title' ? 140 - currentWindow.scrollY : 10;
        return {
          x: 24,
          y: top,
          left: 24,
          top,
          right: 224,
          bottom: top + 40,
          width: 200,
          height: 40,
        };
      },
    });

    win.dispatchEvent(new win.MessageEvent('message', {
      data: { type: 'xiaok:setEditMode', enabled: true },
    }));
    win.document.querySelector('#slide-title')?.dispatchEvent(new win.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));

    const selectedBox = () => win.document
      .querySelector('[data-lavish-ui="annotation-root"]')
      ?.shadowRoot
      ?.querySelector('.xiaok-edit-selected-box') as HTMLElement | null;
    expect(parseFloat(selectedBox()?.style.top ?? '')).toBeCloseTo(140, 0);

    Object.defineProperty(win, 'scrollY', {
      configurable: true,
      value: 80,
    });
    win.dispatchEvent(new win.Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(parseFloat(selectedBox()?.style.top ?? '')).toBeCloseTo(60, 0);

    dom.window.close();
  });
});
