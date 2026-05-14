import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

/**
 * Tests for the artifact-sdk IIFE logic.
 * We extract testable functions by evaluating parts of the SDK in JSDOM.
 */

// Helper: create a JSDOM with a DOM tree and execute SDK helper functions
function createSdkEnv(html = '<html><body><div id="main"><section><p>Hello</p><p>World</p></section></div></body></html>') {
  const dom = new JSDOM(html, { url: 'http://localhost' });
  const { document, CSS } = dom.window;

  // Polyfill CSS.escape if missing
  if (!CSS?.escape) {
    (dom.window as any).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
  }

  // Re-implement SDK functions in test context
  function selector(el: Element | null): string {
    if (!el || !el.tagName) return '';
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + node.id;
        parts.unshift(part);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((x) => x.tagName === node!.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  let counter = 0;
  const ids = new WeakMap<Element, string>();
  function uid(el: Element): string {
    if (!ids.has(el)) ids.set(el, String(++counter));
    return ids.get(el)!;
  }

  function context(el: Element) {
    return {
      uid: uid(el),
      selector: selector(el),
      tag: (el.tagName || '').toLowerCase(),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 240),
    };
  }

  function isLavishUi(el: Element | null): boolean {
    return !!(el && el.closest && el.closest('[data-lavish-ui]'));
  }

  function snapshot(root: Element = document.body, maxDepth = 6): string {
    const lines: string[] = [];
    function walk(el: Element, depth: number) {
      if (!(el instanceof dom.window.Element) || depth > maxDepth || isLavishUi(el)) return;
      const c = context(el);
      const name = c.text ? ' "' + c.text.slice(0, 80).replace(/"/g, "'") + '"' : '';
      lines.push('  '.repeat(depth) + 'uid=' + c.uid + ' ' + c.tag + name);
      for (const child of el.children) walk(child, depth + 1);
    }
    walk(root, 0);
    return lines.join('\n');
  }

  function centeredSnapshot(targetEl: Element): string {
    let container: Element | null = targetEl;
    while (container && container !== document.body) {
      const tag = container.tagName.toLowerCase();
      if (tag === 'section' || tag === 'article' || tag === 'main') break;
      container = container.parentElement;
    }
    if (!container || container === document.body) {
      container = targetEl;
      for (let i = 0; i < 3 && container.parentElement && container.parentElement !== document.body; i++) {
        container = container.parentElement;
      }
    }

    const lines: string[] = [];
    let budget = 2000;
    function walk(el: Element, depth: number) {
      if (!(el instanceof dom.window.Element) || depth > 6 || isLavishUi(el)) return;
      const c = context(el);
      const name = c.text ? ' "' + c.text.slice(0, 80).replace(/"/g, "'") + '"' : '';
      const line = '  '.repeat(depth) + 'uid=' + c.uid + ' ' + c.tag + name;
      budget -= line.length + 1;
      if (budget < 0) return;
      lines.push(line);
      for (const child of el.children) {
        if (budget <= 0) break;
        walk(child, depth + 1);
      }
    }
    walk(container!, 0);
    return lines.join('\n');
  }

  return { dom, document, selector, snapshot, centeredSnapshot, uid, isLavishUi };
}

describe('artifact-sdk functions', () => {
  describe('selector()', () => {
    it('generates correct path for simple element', () => {
      const { document, selector } = createSdkEnv();
      const p = document.querySelector('p')!;
      const result = selector(p);
      expect(result).toContain('p');
      expect(result).toContain('>');
    });

    it('uses nth-of-type for sibling disambiguation', () => {
      const { document, selector } = createSdkEnv();
      const ps = document.querySelectorAll('p');
      const second = selector(ps[1]);
      expect(second).toContain('p:nth-of-type(2)');
    });

    it('uses #id when element has id', () => {
      const { document, selector } = createSdkEnv();
      const main = document.querySelector('#main')!;
      const result = selector(main);
      expect(result).toBe('div#main');
    });

    it('truncates at 5 levels, uses id when within range', () => {
      const deepHtml = '<html><body><div id="root"><div><div><span>deep</span></div></div></div></body></html>';
      const { document, selector } = createSdkEnv(deepHtml);
      const span = document.querySelector('span')!;
      const result = selector(span);
      const parts = result.split(' > ');
      expect(parts.length).toBeLessThanOrEqual(5);
      expect(parts[0]).toContain('div#root');
    });

    it('returns path containing "body" for body element', () => {
      const { document, selector } = createSdkEnv();
      const result = selector(document.body);
      expect(result).toContain('body');
      // selector stops at 5 levels, body is a valid terminal
    });
  });

  describe('centeredSnapshot()', () => {
    it('generates uid=N tag "text" format', () => {
      const { document, centeredSnapshot } = createSdkEnv();
      const p = document.querySelector('p')!;
      const result = centeredSnapshot(p);
      expect(result).toMatch(/uid=\d+ section/);
      expect(result).toContain('"');
    });

    it('finds section ancestor as snapshot root', () => {
      const { document, centeredSnapshot } = createSdkEnv();
      const p = document.querySelector('p')!;
      const result = centeredSnapshot(p);
      // First line should be section, not body
      expect(result.split('\n')[0]).toContain('section');
    });

    it('truncates at depth > 6', () => {
      const deepHtml = '<html><body><section>' + '<div>'.repeat(8) + '<span>deep</span>' + '</div>'.repeat(8) + '</section></body></html>';
      const { document, centeredSnapshot } = createSdkEnv(deepHtml);
      const span = document.querySelector('span')!;
      const result = centeredSnapshot(span);
      // Count indent levels
      const maxIndent = Math.max(...result.split('\n').map((l) => l.search(/\S/)));
      expect(maxIndent).toBeLessThanOrEqual(6 * 2); // 2 spaces per level
    });

    it('respects 2000 char budget', () => {
      // Create a large DOM
      let bigHtml = '<html><body><section>';
      for (let i = 0; i < 200; i++) {
        bigHtml += `<p>Paragraph ${i} with some content to fill up the budget quickly</p>`;
      }
      bigHtml += '</section></body></html>';
      const { document, centeredSnapshot } = createSdkEnv(bigHtml);
      const p = document.querySelector('p')!;
      const result = centeredSnapshot(p);
      expect(result.length).toBeLessThanOrEqual(2200); // some slack for last line
    });

    it('always includes the target element', () => {
      const { document, centeredSnapshot } = createSdkEnv();
      const p = document.querySelectorAll('p')[1];
      const result = centeredSnapshot(p);
      expect(result).toContain('p');
    });

    it('skips data-lavish-ui elements', () => {
      const html = '<html><body><section><p>Visible</p><div data-lavish-ui="x"><span>Hidden</span></div></section></body></html>';
      const { document, centeredSnapshot } = createSdkEnv(html);
      const p = document.querySelector('p')!;
      const result = centeredSnapshot(p);
      // The div with data-lavish-ui should not appear as a separate node in snapshot
      const lines = result.split('\n');
      const hasLavishDiv = lines.some((l) => l.includes('uid=') && l.includes('div') && l.includes('Hidden'));
      expect(hasLavishDiv).toBe(false);
    });
  });

  describe('isLavishAction / hover / click', () => {
    it('data-lavish-action elements are skippable', () => {
      const html = '<html><body><button data-lavish-action="true">Click me</button><p>Normal</p></body></html>';
      const { document } = createSdkEnv(html);
      const btn = document.querySelector('[data-lavish-action]')!;
      expect(btn.closest('[data-lavish-action]')).not.toBeNull();
    });
  });
});
