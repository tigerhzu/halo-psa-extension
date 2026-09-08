'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadUltimateConfig() {
  const window = { __HPX: { config: {} } };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'src/config/selectors.js'), 'utf8'),
    { window: window },
    { filename: 'selectors.js' }
  );
  return window.__HPX.config.selectors.ULTIMATE_MODE;
}

test('simple mode keeps the global header search control', function () {
  const header = loadUltimateConfig().HEADER;
  assert.ok(header.KEEP_LABELS.includes('Search (Ctrl + Shift + F)'));
  assert.ok(header.NEW_TICKET_LABELS.includes('New Ticket'));
});

test('simple mode hides only the ticket-list New dropdown', function () {
  const css = fs.readFileSync(path.join(ROOT, 'src/ultimate-mode/ultimate.css'), 'utf8');
  assert.match(
    css,
    /\.main_table_title \.buttons-container > \[role="listbox"\]:has\(> button\.fabtn\[title="New Ticket"\]\)\s*\{\s*display:\s*none\s*!important;/
  );
  assert.doesNotMatch(css, /#halo-nav[^\{]*\[title="New Ticket"\][^\{]*\{\s*display:\s*none/i);
});
