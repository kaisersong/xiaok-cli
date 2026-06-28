import { describe, expect, it } from 'vitest';
import { applyEditPatch, markManualEdit } from '../../renderer/src/lib/html-edit/source-patcher';
import type { EditPatch, EditTarget } from '../../renderer/src/lib/html-edit/types';

function target(overrides: Partial<EditTarget>): EditTarget {
  return {
    id: 'target-1',
    kind: 'text',
    tagName: 'h1',
    selector: 'h1',
    text: 'Old',
    outerHtml: '<h1>Old</h1>',
    sourceOccurrence: 0,
    ...overrides,
  };
}

describe('html edit source patcher', () => {
  it('replaces only the selected text element and escapes user text', () => {
    const source = '<!doctype html>\n<html><body>\n<h1>Old</h1>\n<p>Keep me</p>\n</body></html>';
    const patch: EditPatch = {
      targetId: 'target-1',
      kind: 'set-text',
      payload: { text: '5 < 8 & ok' },
    };

    const result = applyEditPatch(source, patch, target({}));

    expect(result.source).toContain('<h1>5 &lt; 8 &amp; ok</h1>');
    expect(result.source).toContain('<p>Keep me</p>');
    expect(result.source).not.toContain('data-xk-edit-id');
    expect(result.updatedTarget.outerHtml).toBe('<h1>5 &lt; 8 &amp; ok</h1>');
  });

  it('updates link text and href without rewriting the rest of the document', () => {
    const source = '<main>\n  <a class="cta" href="/old">Old link</a>\n  <p>Unchanged</p>\n</main>';
    const patch: EditPatch = {
      targetId: 'target-1',
      kind: 'set-link',
      payload: { text: 'Read more', href: 'https://example.com?a=1&b=2' },
    };

    const result = applyEditPatch(source, patch, target({
      kind: 'link',
      tagName: 'a',
      text: 'Old link',
      href: '/old',
      outerHtml: '<a class="cta" href="/old">Old link</a>',
    }));

    expect(result.source).toBe('<main>\n  <a class="cta" href="https://example.com?a=1&amp;b=2">Read more</a>\n  <p>Unchanged</p>\n</main>');
    expect(result.updatedTarget.href).toBe('https://example.com?a=1&b=2');
  });

  it('falls back to the selected tag text when browser outerHTML differs from source formatting', () => {
    const source = [
      '<section data-summary="Old summary">',
      '  <p data-kind="intro" class="fade-in-up">Old summary</p>',
      '  <p class="fade-in-up">Keep me</p>',
      '</section>',
    ].join('\n');
    const patch: EditPatch = {
      targetId: 'target-1',
      kind: 'set-text',
      payload: { text: 'New summary' },
    };

    const result = applyEditPatch(source, patch, target({
      tagName: 'p',
      selector: 'section > p:nth-of-type(1)',
      text: 'Old summary',
      outerHtml: '<p class="fade-in-up" data-kind="intro">Old summary</p>',
    }));

    expect(result.source).toContain('data-summary="Old summary"');
    expect(result.source).toContain('<p data-kind="intro" class="fade-in-up">New summary</p>');
    expect(result.source).toContain('<p class="fade-in-up">Keep me</p>');
  });

  it('updates nested slide text selected from a span inside a data-export-role slide', () => {
    const source = [
      '<section class="slide enterprise-dashboard" id="slide-1" data-export-role="kpi_dashboard">',
      '  <div class="slide-content">',
      '    <h1 class="ent-hero-title reveal"><span class="ent-accent-blue">我们用错了时代的操作系统</span></h1>',
      '  </div>',
      '</section>',
    ].join('\n');
    const patch: EditPatch = {
      targetId: 'target-1',
      kind: 'set-text',
      payload: { text: '我们需要新的操作系统' },
    };

    const result = applyEditPatch(source, patch, target({
      tagName: 'span',
      selector: 'section#slide-1 > div > h1 > span',
      text: '我们用错了时代的操作系统',
      outerHtml: '<span class="ent-accent-blue">我们用错了时代的操作系统</span>',
    }));

    expect(result.source).toContain('<span class="ent-accent-blue">我们需要新的操作系统</span>');
    expect(result.source).toContain('data-export-role="kpi_dashboard"');
  });

  it('adds a manual edit meta marker without duplicating it', () => {
    const source = '<html><head><title>Report</title></head><body><h1>Report</h1></body></html>';

    const once = markManualEdit(source, '2026-06-25T10:30:00.000Z');
    const twice = markManualEdit(once, '2026-06-25T10:31:00.000Z');

    expect(once).toContain('<meta name="xk-manual-edit" content="true" data-edit-time="2026-06-25T10:30:00.000Z">');
    expect(twice.match(/name="xk-manual-edit"/g)).toHaveLength(1);
    expect(twice).toContain('data-edit-time="2026-06-25T10:31:00.000Z"');
  });

  it('removes only the selected component', () => {
    const source = '<main><section><h2>Keep</h2></section><section><h2>Remove</h2></section></main>';
    const patch = {
      targetId: 'target-1',
      kind: 'remove-element',
      payload: {},
    } as EditPatch;

    const result = applyEditPatch(source, patch, target({
      tagName: 'section',
      text: 'Remove',
      outerHtml: '<section><h2>Remove</h2></section>',
    }));

    expect(result.source).toBe('<main><section><h2>Keep</h2></section></main>');
  });

  it('inserts a sanitized image figure after the selected component', () => {
    const source = '<main><h2>Intro</h2><p>Next</p></main>';
    const patch = {
      targetId: 'target-1',
      kind: 'insert-image-after',
      payload: {
        imageUrl: 'https://example.com/a.png?x=1&y=2',
        imageAlt: 'A <diagram>',
        caption: 'Caption & note',
      },
    } as EditPatch;

    const result = applyEditPatch(source, patch, target({
      tagName: 'h2',
      text: 'Intro',
      outerHtml: '<h2>Intro</h2>',
    }));

    expect(result.source).toBe('<main><h2>Intro</h2><figure class="xk-inserted-image"><img src="https://example.com/a.png?x=1&amp;y=2" alt="A &lt;diagram&gt;"><figcaption>Caption &amp; note</figcaption></figure><p>Next</p></main>');
  });

  it('inserts sanitized svg and removes script/event handlers', () => {
    const source = '<main><h2>Chart</h2></main>';
    const patch = {
      targetId: 'target-1',
      kind: 'insert-svg-after',
      payload: {
        svgSource: '<svg viewBox="0 0 10 10" onclick="alert(1)"><script>alert(1)</script><circle cx="5" cy="5" r="4" onmouseover="bad()"/></svg>',
      },
    } as EditPatch;

    const result = applyEditPatch(source, patch, target({
      tagName: 'h2',
      text: 'Chart',
      outerHtml: '<h2>Chart</h2>',
    }));

    expect(result.source).toContain('<figure class="xk-inserted-svg"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg></figure>');
    expect(result.source).not.toContain('<script>');
    expect(result.source).not.toContain('onclick');
    expect(result.source).not.toContain('onmouseover');
  });

  it('merges editable text style fields into the selected element', () => {
    const source = '<main><h2 style="margin:0; color:#111">Title</h2></main>';
    const patch = {
      targetId: 'target-1',
      kind: 'set-style',
      payload: {
        style: {
          color: '#e11d48',
          fontSize: '28px',
          fontFamily: 'Inter',
          fontWeight: '700',
        },
      },
    } as EditPatch;

    const result = applyEditPatch(source, patch, target({
      tagName: 'h2',
      text: 'Title',
      outerHtml: '<h2 style="margin:0; color:#111">Title</h2>',
    }));

    expect(result.source).toBe('<main><h2 style="margin: 0; color: #e11d48; font-size: 28px; font-family: Inter; font-weight: 700">Title</h2></main>');
  });
});
