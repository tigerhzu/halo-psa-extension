'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createElement(name, matchedSelectors) {
  const attributes = new Map();
  const element = {
    nodeType: 1,
    name: name,
    tagName: 'DIV',
    className: name,
    parentElement: null,
    isConnected: true,
    children: [],
    matches: function (selector) {
      return matchedSelectors.has(selector);
    },
    closest: function (selectors) {
      const selectorList = String(selectors).split(',').map(function (value) { return value.trim(); });
      let current = element;
      while (current) {
        if (selectorList.some(function (selector) { return current.matches(selector); })) return current;
        current = current.parentElement;
      }
      return null;
    },
    contains: function (candidate) {
      let current = candidate;
      while (current) {
        if (current === element) return true;
        current = current.parentElement;
      }
      return false;
    },
    querySelector: function (selector) {
      const stack = element.children.slice();
      while (stack.length) {
        const candidate = stack.shift();
        if (candidate.matches(selector)) return candidate;
        stack.push.apply(stack, candidate.children);
      }
      return null;
    },
    setAttribute: function (key, value) { attributes.set(key, String(value)); },
    getAttribute: function (key) { return attributes.get(key) || null; },
    removeAttribute: function (key) { attributes.delete(key); },
  };
  return element;
}

function append(parent, child) {
  child.parentElement = parent;
  parent.children.push(child);
}

function createDetectorHarness() {
  const specificSelector = '.fr-element[contenteditable="true"]';
  const genericSelector = '[contenteditable="true"]';
  const body = createElement('body', new Set());
  const documentElement = createElement('html', new Set());
  append(documentElement, body);

  const queryResults = new Map([
    [specificSelector, []],
    [genericSelector, []],
  ]);
  const document = {
    body: body,
    documentElement: documentElement,
    querySelectorAll: function (selector) { return queryResults.get(selector) || []; },
    contains: function (node) { return node.isConnected; },
  };
  const window = {
    addEventListener: function () {},
    removeEventListener: function () {},
    requestAnimationFrame: function (callback) { callback(); return 1; },
    cancelAnimationFrame: function () {},
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    __HPX: {
      PREFIX: 'hpx',
      config: {
        selectors: {
          EDITOR_SELECTORS: [specificSelector, genericSelector],
          fieldMatchMode: 'loose',
          FIELD_KEYWORDS: [],
          labelLookupDepth: 0,
          TOOLBAR_MOUNT: {
            EDITOR_ROOT_SELECTORS: ['.fr-box'],
            EMAIL_FIELD_SELECTORS: [],
          },
        },
      },
      core: {},
      log: function () {},
      warn: function (message, error) { throw error || new Error(message); },
    },
  };

  function MutationObserver() {}
  MutationObserver.prototype.observe = function () {};
  MutationObserver.prototype.disconnect = function () {};

  const sandbox = {
    window: window,
    document: document,
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: MutationObserver,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
  };
  vm.createContext(sandbox);
  const filename = path.join(ROOT, 'src/core/editor-detector.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename: filename });

  return {
    detector: window.__HPX.core.detector,
    specificSelector: specificSelector,
    genericSelector: genericSelector,
    queryResults: queryResults,
    body: body,
  };
}

test('pasted nested contenteditable does not create a second editor toolbar', function () {
  const harness = createDetectorHarness();
  const editor = createElement('editor', new Set([
    harness.specificSelector,
    harness.genericSelector,
  ]));
  append(harness.body, editor);
  harness.queryResults.set(harness.specificSelector, [editor]);
  harness.queryResults.set(harness.genericSelector, [editor]);

  const mounted = [];
  harness.detector.start({
    onEditorFound: function (element) { mounted.push(element); },
  });
  assert.deepEqual(mounted, [editor]);

  // 模擬貼上的 HTML 在既有 editor 內含 contenteditable="true"。
  const pastedEditable = createElement('pasted-editable', new Set([harness.genericSelector]));
  append(editor, pastedEditable);
  harness.queryResults.set(harness.genericSelector, [editor, pastedEditable]);
  harness.detector.rescan();

  assert.deepEqual(mounted, [editor]);
});

test('Froala paste helper sharing the editor root does not create a second toolbar', function () {
  const harness = createDetectorHarness();
  const editorRoot = createElement('froala-root', new Set(['.fr-box']));
  const wrapper = createElement('froala-wrapper', new Set());
  const editor = createElement('editor', new Set([
    harness.specificSelector,
    harness.genericSelector,
  ]));
  append(harness.body, editorRoot);
  append(editorRoot, wrapper);
  append(wrapper, editor);
  harness.queryResults.set(harness.specificSelector, [editor]);
  harness.queryResults.set(harness.genericSelector, [editor]);

  const mounted = [];
  harness.detector.start({
    onEditorFound: function (element) { mounted.push(element); },
  });
  assert.deepEqual(mounted, [editor]);

  // Froala 的 clipboard helper 與真正 editor 是兄弟節點，且同屬一個 .fr-box。
  const clipboardHelper = createElement('clipboard-helper', new Set([harness.genericSelector]));
  append(wrapper, clipboardHelper);
  harness.queryResults.set(harness.genericSelector, [editor, clipboardHelper]);
  harness.detector.rescan();

  assert.deepEqual(mounted, [editor]);
});

test('separate sibling editors are still detected independently', function () {
  const harness = createDetectorHarness();
  const first = createElement('first-editor', new Set([harness.genericSelector]));
  const second = createElement('second-editor', new Set([harness.genericSelector]));
  append(harness.body, first);
  append(harness.body, second);
  harness.queryResults.set(harness.genericSelector, [first, second]);

  const mounted = [];
  harness.detector.start({
    onEditorFound: function (element) { mounted.push(element); },
  });

  assert.deepEqual(mounted, [first, second]);
});
