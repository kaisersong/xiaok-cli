/**
 * Artifact SDK — Adapted from Lavish Axi (MIT License)
 * https://github.com/kunchenguid/lavish-axi
 *
 * Injected into artifact iframe via postMessage bridge.
 * Communication: parent.postMessage (artifact → renderer)
 *               window.addEventListener('message') (renderer → artifact)
 *
 * Changes from original:
 * - Removed queuePrompt/sendQueuedPrompts/endSession (xiaok uses Chat)
 * - Removed SSE/HTTP (uses postMessage with renderer)
 * - Added centeredSnapshot (local snapshot around annotated element)
 * - Added scroll anchor support
 * - Sends annotation directly to parent instead of queuing
 */

export const ARTIFACT_SDK_CODE = `(function() {
  'use strict';

  let annotationMode = false;
  let hovered = null;
  let selected = null;
  let ignoreNextClick = false;
  let shadow = null;
  let counter = 0;
  const ids = new WeakMap();

  function uid(el) {
    if (!ids.has(el)) ids.set(el, String(++counter));
    return ids.get(el);
  }

  function selector(el) {
    if (!el || !el.tagName) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + CSS.escape(node.id);
        parts.unshift(part);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter(function(x) { return x.tagName === node.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function context(el) {
    return {
      uid: uid(el),
      selector: selector(el),
      tag: (el.tagName || '').toLowerCase(),
      text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 240),
    };
  }

  function closestElement(node) {
    if (!node) return document.body;
    if (node.nodeType === 1) return node;
    return node.parentElement || document.body;
  }

  function nodePath(node, root) {
    const path = [];
    let current = node;
    while (current && current !== root) {
      const parentNode = current.parentNode;
      if (!parentNode) break;
      path.unshift([...parentNode.childNodes].indexOf(current));
      current = parentNode;
    }
    return path;
  }

  function rangeBoundary(node, offset) {
    const el = closestElement(node);
    return {
      selector: selector(el),
      path: nodePath(node, el),
      offset: Number(offset) || 0,
    };
  }

  function textSelectionContext(selection) {
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const text = selection.toString().trim().replace(/\\s+/g, ' ');
    if (range.collapsed || !text) return null;

    const ancestor = closestElement(range.commonAncestorContainer);
    if (isLavishUi(ancestor) || isLavishAction(ancestor)) return null;

    const commonAncestorSelector = selector(ancestor);
    return {
      uid: '',
      selector: commonAncestorSelector,
      tag: 'text',
      text: text.slice(0, 240),
      target: {
        type: 'text-range',
        text: text,
        selector: commonAncestorSelector,
        commonAncestorSelector: commonAncestorSelector,
        start: rangeBoundary(range.startContainer, range.startOffset),
        end: rangeBoundary(range.endContainer, range.endOffset),
      },
      element: ancestor,
      range: range.cloneRange(),
    };
  }

  function isLavishUi(el) {
    return !!(el && el.closest && el.closest('[data-lavish-ui]'));
  }

  function isLavishAction(el) {
    return !!(el && el.closest && el.closest('[data-lavish-action]'));
  }

  function highlightElement(el) {
    if (!el) return;
    el.style.outline = '2px solid #3b82f6';
    el.style.outlineOffset = '2px';
  }

  function clearHighlight(el) {
    if (el) { el.style.outline = ''; el.style.outlineOffset = ''; }
  }

  function clearTextHighlight() {
    if (!shadow) return;
    var highlights = shadow.querySelectorAll('.xiaok-text-highlight');
    for (var i = 0; i < highlights.length; i++) highlights[i].remove();
  }

  function highlightTextRange(range) {
    clearTextHighlight();
    var root = ensureShadow();
    var rects = range.getClientRects();
    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i];
      if (rect.width <= 0 || rect.height <= 0) continue;
      var mark = document.createElement('div');
      mark.className = 'xiaok-text-highlight';
      mark.style.left = rect.left + 'px';
      mark.style.top = rect.top + 'px';
      mark.style.width = rect.width + 'px';
      mark.style.height = rect.height + 'px';
      root.appendChild(mark);
    }
  }

  // Centered snapshot: find nearest section/article ancestor, snapshot that subtree
  function centeredSnapshot(targetEl) {
    var container = targetEl;
    while (container && container !== document.body) {
      var tag = container.tagName.toLowerCase();
      if (tag === 'section' || tag === 'article' || tag === 'main') break;
      container = container.parentElement;
    }
    if (!container || container === document.body) {
      // fallback: use parent of target, up to 3 levels
      container = targetEl;
      for (var i = 0; i < 3 && container.parentElement && container.parentElement !== document.body; i++) {
        container = container.parentElement;
      }
    }

    var lines = [];
    var budget = 2000;

    function walk(el, depth) {
      if (!(el instanceof Element) || depth > 6 || isLavishUi(el)) return;
      var c = context(el);
      var name = c.text ? ' "' + c.text.slice(0, 80).replace(/"/g, "'") + '"' : '';
      var line = '  '.repeat(depth) + 'uid=' + c.uid + ' ' + c.tag + name;
      budget -= line.length + 1;
      if (budget < 0) return;
      lines.push(line);
      for (var j = 0; j < el.children.length; j++) {
        if (budget <= 0) break;
        walk(el.children[j], depth + 1);
      }
    }

    walk(container, 0);
    return lines.join('\\n');
  }

  // Scroll anchor: find first visible element
  function getScrollAnchor() {
    var elements = document.body.querySelectorAll('*');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (isLavishUi(el)) continue;
      var rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight && rect.width > 0 && rect.height > 0) {
        return selector(el);
      }
    }
    return null;
  }

  function setAnnotationMode(enabled) {
    annotationMode = !!enabled;
    var style = document.getElementById('xiaok-cursor-style');
    if (annotationMode && !style) {
      style = document.createElement('style');
      style.id = 'xiaok-cursor-style';
      style.textContent = '*{cursor:crosshair!important}[data-lavish-action],[data-lavish-action] *{cursor:pointer!important}';
      document.head.appendChild(style);
    }
    if (!annotationMode && style) style.remove();
    if (!annotationMode) closeCard();
  }

  function ensureShadow() {
    if (shadow) return shadow;
    var host = document.createElement('div');
    host.setAttribute('data-lavish-ui', 'annotation-root');
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = ':host{all:initial;position:fixed;z-index:2147483647;left:0;top:0;pointer-events:none}.xiaok-text-highlight{position:fixed;pointer-events:none;background:rgba(59,130,246,.15);border-radius:2px;box-shadow:0 0 0 1px rgba(59,130,246,.35)}.xiaok-annotation-card{position:fixed;pointer-events:all;width:min(320px,calc(100vw - 24px));padding:14px;border-radius:14px;background:#FFFFFF;color:#141412;border:1px solid #DEDEDE;box-shadow:0 8px 32px rgba(0,0,0,.12),0 0 1px rgba(0,0,0,.08);font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;box-sizing:border-box}.xiaok-annotation-card textarea{width:100%;min-height:80px;resize:vertical;border-radius:8px;border:1px solid #DEDEDE;background:#FFFFFF;color:#141412;padding:8px 10px;font:inherit;box-sizing:border-box;outline:none;transition:border-color .15s}.xiaok-annotation-card textarea:focus{border-color:#B9B9B7}.xiaok-annotation-card textarea::placeholder{color:#8C8C8A}.xiaok-annotation-card .xiaok-row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}.xiaok-annotation-card button{border:0;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s}.xiaok-annotation-card .xiaok-send{background:#1A1A18;color:#FAFAFA}.xiaok-annotation-card .xiaok-send:hover{opacity:.85}.xiaok-annotation-card .xiaok-cancel{background:#EBEBEB;color:#3D3D3B}.xiaok-annotation-card .xiaok-cancel:hover{background:#E5E5E3}';
    shadow.appendChild(style);
    return shadow;
  }

  function closeCard() {
    if (shadow) {
      var cards = shadow.querySelectorAll('.xiaok-annotation-card');
      for (var i = 0; i < cards.length; i++) cards[i].remove();
    }
    clearHighlight(hovered);
    clearHighlight(selected);
    hovered = null;
    clearTextHighlight();
    selected = null;
  }

  function showAnnotationCard(target, options) {
    options = options || {};
    var root = ensureShadow();
    closeCard();

    var c = options.context || context(target);
    if (options.range) {
      highlightTextRange(options.range);
    } else {
      selected = target;
      highlightElement(selected);
    }

    var rect = options.range ? options.range.getBoundingClientRect() : target.getBoundingClientRect();
    var card = document.createElement('div');
    card.className = 'xiaok-annotation-card';
    var heading = c.tag === 'text' ? '\u4fee\u8ba2\u6587\u5b57' : '\u4fee\u8ba2';
    var placeholder = c.tag === 'text'
      ? '\u544a\u8bc9 Agent \u4f60\u60f3\u600e\u4e48\u4fee\u6539\u8fd9\u6bb5\u6587\u5b57...'
      : '\u544a\u8bc9 Agent \u4f60\u60f3\u600e\u4e48\u4fee\u6539\u8fd9\u4e2a\u5143\u7d20...';
    card.innerHTML = '<div style="font-weight:700;margin-bottom:6px">' + heading + '</div><textarea placeholder="' + placeholder + '"></textarea><div class="xiaok-row"><button class="xiaok-cancel" type="button">\u53d6\u6d88</button><button class="xiaok-send" type="button">\u53d1\u9001\u4fee\u8ba2</button></div>';
    root.appendChild(card);

    var left = Math.min(Math.max(12, rect.left), window.innerWidth - 332);
    var top = Math.min(Math.max(12, rect.bottom + 8), window.innerHeight - card.offsetHeight - 12);
    card.style.left = left + 'px';
    card.style.top = top + 'px';

    var textarea = card.querySelector('textarea');
    var cancelButton = card.querySelector('.xiaok-cancel');
    var sendButton = card.querySelector('.xiaok-send');

    cancelButton.onclick = function() { closeCard(); };
    sendButton.onclick = function() {
      var prompt = textarea.value.trim();
      var snapshot = centeredSnapshot(options.range ? closestElement(options.range.startContainer) : target);
      var payload = {
        type: c.tag === 'text' ? 'text-selection' : 'element',
        selector: c.selector,
        text: c.text,
        snapshot: snapshot,
        prompt: prompt,
      };
      if (c.target) payload.target = c.target;
      parent.postMessage({ type: 'xiaok:annotation', payload: payload }, '*');
      closeCard();
    };
    setTimeout(function() { textarea.focus(); }, 0);
  }

  // --- Event listeners ---

  window.addEventListener('message', function(event) {
    var msg = event.data || {};
    if (msg.type === 'xiaok:setAnnotationMode') setAnnotationMode(msg.enabled);
    if (msg.type === 'xiaok:getScrollAnchor') {
      parent.postMessage({ type: 'xiaok:scrollAnchor', selector: getScrollAnchor() }, '*');
    }
    if (msg.type === 'xiaok:restoreScroll') {
      if (msg.selector) {
        var el = document.querySelector(msg.selector);
        if (el) { el.scrollIntoView({ block: 'start' }); return; }
      }
      window.scrollTo(0, 0);
    }
  });

  document.addEventListener('mouseover', function(event) {
    if (!annotationMode || isLavishUi(event.target) || isLavishAction(event.target)) return;
    if (event.target === selected) return;
    if (hovered && hovered !== selected) clearHighlight(hovered);
    hovered = event.target;
    highlightElement(hovered);
  }, true);

  document.addEventListener('mouseout', function() {
    if (hovered && hovered !== selected) {
      clearHighlight(hovered);
      hovered = null;
    }
  }, true);

  document.addEventListener('mouseup', function(event) {
    if (!annotationMode || isLavishUi(event.target) || isLavishAction(event.target)) return;
    var c = textSelectionContext(document.getSelection());
    if (!c) return;
    ignoreNextClick = true;
    showAnnotationCard(c.element, { context: c, range: c.range });
  }, true);

  document.addEventListener('click', function(event) {
    if (!annotationMode || isLavishUi(event.target) || isLavishAction(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (ignoreNextClick) { ignoreNextClick = false; return; }
    showAnnotationCard(event.target);
  }, true);

  // Check opt-out
  var metaOff = document.querySelector('meta[name="xiaok-editing"][content="off"]');
  if (metaOff) return;

  // Signal ready
  parent.postMessage({ type: 'xiaok:sdkReady' }, '*');
})();`;
