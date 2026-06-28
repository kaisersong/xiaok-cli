import type { EditPatch, EditPatchResult, EditTarget, InlineStylePatch } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos' || lower === '#39') return "'";
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return entity;
  });
}

function visibleTextFromFragment(fragment: string): string {
  return decodeHtmlEntities(fragment)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readAttribute(fragment: string, attrName: string): string | undefined {
  const open = fragment.match(/^<[^>]+>/);
  if (!open) return undefined;
  const attrPattern = new RegExp(`\\s${escapeRegExp(attrName)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  const match = open[0].match(attrPattern);
  return match ? decodeHtmlEntities(match[2]) : undefined;
}

function findNth(source: string, needle: string, occurrence = 0): number {
  if (!needle) return -1;
  let from = 0;
  for (let i = 0; i <= occurrence; i += 1) {
    const found = source.indexOf(needle, from);
    if (found < 0) return -1;
    if (i === occurrence) return found;
    from = found + needle.length;
  }
  return -1;
}

function findSourceFragment(source: string, target: EditTarget): { start: number; outerHtml: string } | null {
  const exactStart = findNth(source, target.outerHtml, target.sourceOccurrence ?? 0);
  if (exactStart >= 0) return { start: exactStart, outerHtml: target.outerHtml };

  const normalizedTargetText = target.text.replace(/\s+/g, ' ').trim();
  if (!normalizedTargetText || !target.tagName) return null;

  const tagName = escapeRegExp(target.tagName.toLowerCase());
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi');
  const candidates: Array<{ start: number; outerHtml: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source)) !== null) {
    const fragment = match[0];
    if (visibleTextFromFragment(fragment) !== normalizedTargetText) continue;
    if (target.kind === 'link' && typeof target.href === 'string') {
      const href = readAttribute(fragment, 'href');
      if (typeof href === 'string' && href !== target.href) continue;
    }
    candidates.push({ start: match.index, outerHtml: fragment });
  }

  if (candidates.length === 0) return null;
  const occurrence = target.sourceOccurrence ?? 0;
  return candidates[Math.min(Math.max(occurrence, 0), candidates.length - 1)];
}

function replaceInnerHtml(fragment: string, tagName: string, nextText: string): string {
  const open = fragment.match(/^<[^>]+>/);
  if (!open) return fragment;
  const closeToken = `</${tagName.toLowerCase()}>`;
  const close = fragment.toLowerCase().lastIndexOf(closeToken);
  if (close < open[0].length) return fragment;
  return `${fragment.slice(0, open[0].length)}${escapeHtml(nextText)}${fragment.slice(close)}`;
}

function replaceAttribute(fragment: string, attrName: string, value: string): string {
  const open = fragment.match(/^<[^>]+>/);
  if (!open) return fragment;
  const opening = open[0];
  const escaped = escapeAttribute(value);
  const attrPattern = new RegExp(`(\\s${attrName}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, 'i');
  const nextOpening = attrPattern.test(opening)
    ? opening.replace(attrPattern, `$1"${escaped}"`)
    : opening.replace(/\s*\/?>$/, (end) => ` ${attrName}="${escaped}"${end.trimStart()}`);
  return `${nextOpening}${fragment.slice(opening.length)}`;
}

function removeAttribute(fragment: string, attrName: string): string {
  const open = fragment.match(/^<[^>]+>/);
  if (!open) return fragment;
  const opening = open[0];
  const attrPattern = new RegExp(`\\s${attrName}\\s*=\\s*(["'])[\\s\\S]*?\\1`, 'i');
  const nextOpening = opening.replace(attrPattern, '');
  return `${nextOpening}${fragment.slice(opening.length)}`;
}

function normalizeStyleDeclarations(styleValue: string | undefined): Map<string, string> {
  const declarations = new Map<string, string>();
  if (!styleValue) return declarations;
  for (const part of styleValue.split(';')) {
    const [rawName, ...rawValueParts] = part.split(':');
    const name = rawName?.trim().toLowerCase();
    const value = rawValueParts.join(':').trim();
    if (!name || !value) continue;
    declarations.set(name, value);
  }
  return declarations;
}

function serializeStyleDeclarations(declarations: Map<string, string>): string {
  return Array.from(declarations.entries())
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');
}

function sanitizeColor(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
  if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(trimmed)) return trimmed;
  if (/^[a-z]+$/i.test(trimmed)) return trimmed;
  return '';
}

function sanitizeFontSize(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  return /^\d+(?:\.\d+)?(?:px|rem|em|%)$/i.test(trimmed) ? trimmed : '';
}

function sanitizeFontFamily(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  return trimmed.replace(/[;"<>]/g, '').slice(0, 120).trim();
}

function sanitizeFontWeight(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  if (/^(normal|bold)$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^[1-9]00$/.test(trimmed) && Number(trimmed) <= 900) return trimmed;
  return '';
}

function sanitizeStylePatch(style: InlineStylePatch | undefined): Map<string, string> {
  const next = new Map<string, string>();
  if (!style) return next;
  if (style.color !== undefined) next.set('color', sanitizeColor(style.color));
  if (style.fontSize !== undefined) next.set('font-size', sanitizeFontSize(style.fontSize));
  if (style.fontFamily !== undefined) next.set('font-family', sanitizeFontFamily(style.fontFamily));
  if (style.fontWeight !== undefined) next.set('font-weight', sanitizeFontWeight(style.fontWeight));
  return next;
}

function mergeInlineStyle(fragment: string, style: InlineStylePatch | undefined): string {
  const existing = normalizeStyleDeclarations(readAttribute(fragment, 'style'));
  const patch = sanitizeStylePatch(style);
  for (const [name, value] of patch.entries()) {
    if (value) {
      existing.set(name, value);
    } else {
      existing.delete(name);
    }
  }
  const serialized = serializeStyleDeclarations(existing);
  if (!serialized) return removeAttribute(fragment, 'style');
  return replaceAttribute(fragment, 'style', serialized);
}

function sanitizeImageUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(trimmed)) return trimmed;
  return '';
}

function buildImageFigure(url: string | undefined, alt: string | undefined, caption: string | undefined): string {
  const safeUrl = sanitizeImageUrl(url);
  if (!safeUrl) return '';
  const safeAlt = escapeAttribute(alt ?? '');
  const safeCaption = (caption ?? '').trim();
  const captionHtml = safeCaption ? `<figcaption>${escapeHtml(safeCaption)}</figcaption>` : '';
  return `<figure class="xk-inserted-image"><img src="${escapeAttribute(safeUrl)}" alt="${safeAlt}">${captionHtml}</figure>`;
}

function sanitizeSvgSource(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!/^<svg[\s>]/i.test(trimmed) || !/<\/svg>$/i.test(trimmed)) return '';
  return trimmed
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|xlink:href)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, '')
    .replace(/javascript:/gi, '');
}

function buildSvgFigure(svgSource: string | undefined): string {
  const safeSvg = sanitizeSvgSource(svgSource);
  if (!safeSvg) return '';
  return `<figure class="xk-inserted-svg">${safeSvg}</figure>`;
}

export function applyEditPatch(source: string, patch: EditPatch, target: EditTarget): EditPatchResult {
  if (patch.targetId !== target.id) {
    return { source, updatedTarget: target };
  }

  const sourceFragment = findSourceFragment(source, target);
  if (!sourceFragment) {
    return { source, updatedTarget: target };
  }

  let outerHtml = sourceFragment.outerHtml;
  const text = typeof patch.payload.text === 'string' ? patch.payload.text : target.text;
  const href = typeof patch.payload.href === 'string' ? patch.payload.href : target.href;

  if (patch.kind === 'remove-element') {
    const nextSource = `${source.slice(0, sourceFragment.start)}${source.slice(sourceFragment.start + sourceFragment.outerHtml.length)}`;
    return {
      source: nextSource,
      updatedTarget: {
        ...target,
        outerHtml: '',
      },
    };
  }

  if (patch.kind === 'insert-image-after') {
    const figure = buildImageFigure(patch.payload.imageUrl, patch.payload.imageAlt, patch.payload.caption);
    if (!figure) return { source, updatedTarget: target };
    const insertAt = sourceFragment.start + sourceFragment.outerHtml.length;
    return {
      source: `${source.slice(0, insertAt)}${figure}${source.slice(insertAt)}`,
      updatedTarget: target,
    };
  }

  if (patch.kind === 'insert-svg-after') {
    const figure = buildSvgFigure(patch.payload.svgSource);
    if (!figure) return { source, updatedTarget: target };
    const insertAt = sourceFragment.start + sourceFragment.outerHtml.length;
    return {
      source: `${source.slice(0, insertAt)}${figure}${source.slice(insertAt)}`,
      updatedTarget: target,
    };
  }

  if (patch.kind === 'set-text') {
    outerHtml = replaceInnerHtml(outerHtml, target.tagName, text);
  } else if (patch.kind === 'set-link') {
    outerHtml = replaceInnerHtml(outerHtml, target.tagName, text);
    if (typeof href === 'string') outerHtml = replaceAttribute(outerHtml, 'href', href);
  } else if (patch.kind === 'set-style') {
    outerHtml = mergeInlineStyle(outerHtml, patch.payload.style);
  }

  const nextSource = `${source.slice(0, sourceFragment.start)}${outerHtml}${source.slice(sourceFragment.start + sourceFragment.outerHtml.length)}`;
  return {
    source: nextSource,
    updatedTarget: {
      ...target,
      text,
      href,
      outerHtml,
    },
  };
}

export function markManualEdit(source: string, editTime = new Date().toISOString()): string {
  const marker = `<meta name="xk-manual-edit" content="true" data-edit-time="${escapeAttribute(editTime)}">`;
  const existing = /<meta\s+[^>]*name=["']xk-manual-edit["'][^>]*>/i;
  if (existing.test(source)) {
    return source.replace(existing, marker);
  }
  const head = /<head(?:\s[^>]*)?>/i.exec(source);
  if (head) {
    const insertAt = head.index + head[0].length;
    return `${source.slice(0, insertAt)}${marker}${source.slice(insertAt)}`;
  }
  return `${marker}${source}`;
}

export const __htmlEditTestUtils = {
  escapeHtml,
  escapeAttribute,
};
