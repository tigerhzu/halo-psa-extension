'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture() {
  const nodes = [];
  const clicks = [];
  const notices = [];
  const root = { querySelector: () => true, querySelectorAll: () => nodes, getAttribute: () => null, classList: { contains: () => false } };
  const title = { getClientRects: () => [1], querySelectorAll: () => [root] };
  const heading = { getClientRects: () => [1], textContent: '[ID:000123]' };
  const document = { querySelectorAll: selector => selector === '.details_page_title' ? [title] : [heading] };
  const window = { location: { href: 'https://test.halopsa.com/tickets?id=123' }, __HPX: { features: {}, ui: { toast: { show: text => notices.push(text) } } } };
  const sandbox = { window, document, URL };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/features/quick-status.js'), 'utf8'), sandbox);
  const api = window.__HPX.features.quickStatus;
  function add(name, isDisabled = false) {
    const node = { isConnected: true, parentElement: root, disabled: isDisabled, classList: { contains: () => false }, getAttribute: attr => attr === 'title' ? name : null, click: () => clicks.push(name) };
    nodes.push(node);
    return api._actions(root).at(-1);
  }
  return { api, window, root, heading, nodes, clicks, notices, add };
}
test('hidden On Hold invokes only its own native handler, without intermediate In Progress', () => {
  const f = fixture();
  f.add('In Progress');
  const item = f.add('On Hold');
  assert.equal(f.api._invoke(f.api._context(), item), true);
  assert.deepEqual(f.clicks, ['On Hold']);
});
test('all custom action names remain discoverable, and disabled actions cannot execute', () => {
  const f = fixture();
  const item = f.add('自訂待處理', true);
  assert.equal(f.api._actions(f.root)[0].label, '自訂待處理');
  assert.equal(f.api._invoke(f.api._context(), item), false);
  assert.equal(f.clicks.length, 0);
});
test('route switch blocks old menu even before the DOM rerenders', () => {
  const f = fixture();
  const item = f.add('Resolve Ticket');
  const snapshot = f.api._context();
  f.window.location.href = 'https://test.halopsa.com/tickets?id=124';
  assert.equal(f.api._invoke(snapshot, item), false);
  assert.equal(f.clicks.length, 0);
});
test('detached/replaced actions cannot execute from a stale menu', () => {
  const f = fixture();
  const item = f.add('On Hold');
  const snapshot = f.api._context();
  f.nodes.splice(0);
  f.add('On Hold');
  assert.equal(f.api._invoke(snapshot, item), false);
  assert.equal(f.clicks.length, 0);
});
test('new-ticket and heading/route mismatch are excluded', () => {
  const f = fixture();
  f.window.location.href = 'https://test.halopsa.com/';
  assert.equal(f.api._context(), null);
  f.window.location.href = 'https://test.halopsa.com/tickets?id=123';
  f.heading.textContent = '[ID:000999]';
  assert.equal(f.api._context(), null);
});
test('late disabled state prevents execution', () => {
  const f = fixture();
  const item = f.add('Resolved Ticket');
  const snapshot = f.api._context();
  item.node.disabled = true;
  assert.equal(f.api._invoke(snapshot, item), false);
  assert.equal(f.clicks.length, 0);
});
