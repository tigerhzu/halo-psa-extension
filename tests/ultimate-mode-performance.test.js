'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    emit(name) { if (listeners.has(name)) listeners.get(name)(); },
  };
}

function harness(navigation = true) {
  let now = 0;
  let nextId = 0;
  let mutationCallback;
  let scans = 0;
  let queries = 0;
  let disconnected = false;
  const timers = new Map();
  const intervals = new Map();
  const document = Object.assign(eventTarget(), { hidden: false, body: {} });
  const window = Object.assign(eventTarget(), {
    location: { href: 'https://example.halopsa.com/tickets' },
    __HPX: { config: {}, ultimate: {} },
  });
  if (navigation) window.navigation = eventTarget();
  const sandbox = {
    window, document,
    Date: { now: () => now },
    setTimeout(callback, delay) { const id = nextId++; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { const id = nextId++; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    MutationObserver: class {
      constructor(callback) { mutationCallback = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/config/selectors.js'), 'utf8'), sandbox);
  window.__HPX.ultimate.shared = {
    cfg: window.__HPX.config.selectors.ULTIMATE_MODE,
    isOwnUi: (node) => !!node.own,
    safeMatches: (node) => !!node.urgent,
    safeQueryAll: () => { throw new Error('Valid urgent selectors must use one querySelector'); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/ultimate-mode/observer.js'), 'utf8'), sandbox);
  const observer = window.__HPX.ultimate.observer;
  observer.start(() => { scans += 1; });

  function advance(ms) {
    const target = now + ms;
    while (true) {
      const due = Array.from(timers).filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].callback();
    }
    now = target;
  }
  function node(options = {}) {
    return Object.assign({
      nodeType: 1,
      matches() { return !!this.urgent; },
      querySelector() { queries += 1; return this.urgentChild ? {} : null; },
    }, options);
  }
  function mutate(added = [node()], target = {}) {
    mutationCallback([{ type: 'childList', target, addedNodes: added, removedNodes: [] }]);
  }
  return {
    observer, window, document, timers, intervals, advance, node, mutate,
    get scans() { return scans; },
    get queries() { return queries; },
    get disconnected() { return disconnected; },
  };
}

test('native render bursts coalesce and the last update is reconciled within 240 ms', () => {
  const h = harness();
  for (let i = 0; i < 20; i += 1) {
    h.mutate();
    h.advance(50);
  }
  assert.equal(h.scans, 4);
  assert.equal(h.timers.size, 0);
  h.advance(1000);
  assert.equal(h.scans, 4, 'idle pages must not repeatedly rescan');
});

test('urgent native nodes and nested urgent nodes reconcile synchronously before paint', () => {
  const h = harness();
  h.mutate();
  h.mutate([h.node({ urgent: true })]);
  assert.equal(h.scans, 1);
  assert.equal(h.timers.size, 0);
  h.mutate([h.node({ urgentChild: true })]);
  assert.equal(h.scans, 2);
});

test('ordinary added subtrees use one urgent query each, not one query per selector', () => {
  const h = harness();
  h.mutate(Array.from({ length: 50 }, () => h.node()));
  assert.equal(h.queries, 50);
  assert.equal(h.scans, 0);
  h.advance(120);
  assert.equal(h.scans, 1);
});

test('owned UI insertions and text changes never schedule a native-page reconcile', () => {
  const h = harness();
  h.mutate([h.node({ own: true, urgentChild: true })]);
  h.mutate([{ nodeType: 3 }], { own: true });
  h.advance(1000);
  assert.equal(h.scans, 0);
  assert.equal(h.queries, 0);
  assert.equal(h.timers.size, 0);
});

test('hidden-page mutations do no subtree queries and trigger one catch-up when visible', () => {
  const h = harness();
  h.mutate();
  const queries = h.queries;
  h.document.hidden = true;
  for (let i = 0; i < 100; i += 1) h.mutate([h.node({ urgentChild: true })]);
  h.advance(1000);
  assert.equal(h.scans, 0);
  assert.equal(h.queries, queries);
  h.document.hidden = false;
  h.document.emit('visibilitychange');
  h.document.emit('visibilitychange');
  assert.equal(h.scans, 1);
});

test('committed SPA navigation is event driven, deduplicated, and stops cleanly', () => {
  const h = harness();
  assert.equal(h.intervals.size, 0);
  h.window.location.href += '/42';
  h.window.navigation.emit('currententrychange');
  h.window.emit('popstate');
  assert.equal(h.scans, 1);
  h.mutate();
  h.observer.stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.disconnected, true);
  assert.equal(h.document.listeners.size, 0);
  assert.equal(h.window.navigation.listeners.size, 0);
  h.advance(1000);
  assert.equal(h.scans, 1);
});

test('legacy navigation polling remains available and is cleaned up', () => {
  const h = harness(false);
  assert.equal(h.intervals.size, 1);
  h.window.location.href += '/42';
  Array.from(h.intervals.values())[0]();
  assert.equal(h.scans, 1);
  h.observer.stop();
  assert.equal(h.intervals.size, 0);
});

test('semantic label lookup reads layout only for matching labels, preserving visibility and leaf preference', () => {
  let layoutReads = 0;
  function label(text, visible = true) {
    return {
      nodeType: 1, tagName: 'DIV', isConnected: true,
      childNodes: [{ nodeType: 3, nodeValue: text }],
      getAttribute: () => null,
      closest: () => null,
      contains: () => false,
      getBoundingClientRect() { layoutReads += 1; return { width: visible ? 100 : 0, height: 20 }; },
    };
  }
  const irrelevant = Array.from({ length: 1000 }, (_, i) => label('Ticket activity ' + i));
  const parent = label('Status');
  const visible = label('Status');
  const hidden = label('Status', false);
  parent.contains = (node) => node === visible;
  const candidates = irrelevant.concat(parent, visible, hidden);
  const window = {
    __HPX: { config: { selectors: { ULTIMATE_MODE: {
      OWN_UI_ROOT_SELECTORS: ['.hpx-toolbar'],
      TEXT_CANDIDATE_SELECTORS: ['div'], MAX_LABEL_TEXT_LENGTH: 100,
    } } } },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  const document = { querySelectorAll: () => candidates };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/ultimate-mode/shared.js'), 'utf8'), { window, document });
  const result = window.__HPX.ultimate.shared.findByLabels(document, ['Status']);
  assert.equal(result.length, 1);
  assert.equal(result[0], visible);
  assert.equal(layoutReads, 3, '1000 unrelated DOM labels must not force layout reads');
});
