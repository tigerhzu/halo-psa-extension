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
    subtreeQueries: 0,
    matches: function (selector) {
      const selectors = String(selector).split(',').map(value => value.trim());
      if (selectors.includes('[')) throw new SyntaxError('Invalid selector');
      return selectors.some(value => matchedSelectors.has(value));
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
      element.subtreeQueries += 1;
      if (String(selector).split(',').includes('[')) throw new SyntaxError('Invalid selector');
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

  let mutationCallback = null;
  function MutationObserver(callback) { mutationCallback = callback; }
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
    selectors: window.__HPX.config.selectors.EDITOR_SELECTORS,
    mutate: function (records) { mutationCallback(records); },
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

test('an unrelated changed subtree needs one query, not one per editor selector', function () {
  const harness = createDetectorHarness();
  harness.selectors.push('.ck-editor__editable', '.mce-content-body', 'iframe.tox-edit-area__iframe', '.note-editable', 'textarea.hpx-target');
  let scans = 0;
  harness.detector.start({ onScan: function () { scans += 1; } });
  const subtree = createElement('unrelated-table', new Set());
  for (let index = 0; index < 100; index += 1) append(subtree, createElement('row-' + index, new Set()));
  append(harness.body, subtree);
  harness.mutate([{ type: 'childList', target: harness.body, addedNodes: [subtree], removedNodes: [] }]);
  assert.equal(subtree.subtreeQueries, 1);
  assert.equal(scans, 1, 'unrelated rendering must not trigger another document scan');
});

test('combined subtree lookup detects a dynamically inserted editor and tolerates an invalid rule', function () {
  for (const invalid of [false, true]) {
    const harness = createDetectorHarness();
    if (invalid) harness.selectors.unshift('[');
    const mounted = [];
    harness.detector.start({ onEditorFound: function (editor) { mounted.push(editor); } });
    const wrapper = createElement('new-action', new Set());
    const editor = createElement('editor', new Set([harness.genericSelector]));
    append(wrapper, editor);
    append(harness.body, wrapper);
    harness.queryResults.set(harness.genericSelector, [editor]);
    harness.mutate([{ type: 'childList', target: harness.body, addedNodes: [wrapper], removedNodes: [] }]);
    assert.deepEqual(mounted, [editor]);
    if (!invalid) assert.equal(wrapper.subtreeQueries, 1);
  }
});

test('typing and nested editable paste do not query descendants or reconcile toolbars', function () {
  const harness = createDetectorHarness();
  const editor = createElement('editor', new Set([harness.specificSelector, harness.genericSelector]));
  append(harness.body, editor);
  harness.queryResults.set(harness.specificSelector, [editor]);
  harness.queryResults.set(harness.genericSelector, [editor]);
  let scans = 0;
  const mounted = [];
  harness.detector.start({
    onEditorFound: function (element) { mounted.push(element); },
    onScan: function () { scans += 1; },
  });
  const paragraph = createElement('pasted-paragraph', new Set());
  const nested = createElement('pasted-editable', new Set([harness.genericSelector]));
  append(paragraph, nested);
  append(editor, paragraph);
  harness.queryResults.set(harness.genericSelector, [editor, nested]);
  harness.mutate([{ type: 'childList', target: editor, addedNodes: [paragraph], removedNodes: [] }]);
  assert.equal(paragraph.subtreeQueries, 0);
  assert.equal(scans, 1);
  assert.deepEqual(mounted, [editor]);
  harness.detector.rescan();
  assert.deepEqual(mounted, [editor], 'a later explicit scan still rejects nested pasted editors');
});
