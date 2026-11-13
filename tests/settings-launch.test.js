'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = process.env.HPX_TEST_ROOT || path.resolve(__dirname, '..');

function fixture() {
  let valid = true, calls = 0;
  const window = { __HPX: { ui: {}, core: { petRegistry: { builtIns: () => [] } } } };
  const chrome = { runtime: {
    getURL: name => { calls++; if (!valid) throw new Error('Extension context invalidated'); return 'chrome-extension://test/' + name; },
    sendMessage: () => { throw new Error('No background connection'); },
  } };
  const document = { createElement: tag => ({ tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    appendChild(node) { this.children.push(node); },
    addEventListener(name, fn) { this.listeners[name] = fn; },
  }) };
  const source = fs.readFileSync(path.join(root, 'src/ui/settings-panel.js'), 'utf8');
  vm.runInNewContext(source.replace('NS.ui.settingsPanel = SettingsPanel;', 'NS.ui.settingsPanel = SettingsPanel; NS.ui.makeTestControl = makeSidebarControl;'), { window, document, chrome });
  return { make: window.__HPX.ui.makeTestControl, invalidate: () => { valid = false; }, calls: () => calls };
}

test('settings uses native navigation without a background response, even after extension reload', () => {
  const f = fixture(); f.invalidate();
  let cleaned = false, prevented = false, stopped = false;
  const link = f.make('設定', 'settings', () => { cleaned = true; });
  link.listeners.click({ preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
  assert.equal(link.tagName, 'A');
  assert.equal(link.href, 'chrome-extension://test/src/options/options.html');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(prevented, false);
  assert.equal(cleaned, true); assert.equal(stopped, true); assert.equal(f.calls(), 1);
});
test('other toolbar controls keep button semantics and prevent default', () => {
  const f = fixture(); let prevented = false, clicked = false;
  const button = f.make('寵物', 'pet', () => { clicked = true; });
  button.listeners.click({ preventDefault: () => { prevented = true; }, stopPropagation() {} });
  assert.equal(button.tagName, 'BUTTON'); assert.equal(button.type, 'button');
  assert.equal(prevented, true); assert.equal(clicked, true);
});
test('native settings navigation is permitted only from supported Halo sites', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const access = manifest.web_accessible_resources.filter(group => group.resources.includes(manifest.options_ui.page));
  assert.equal(access.length, 1);
  assert.deepEqual(access[0].matches.slice().sort(), [
    'https://*.halopsa.com/*', 'https://*.haloitsm.com/*', 'https://*.halocrm.com/*', 'https://*.haloservicedesk.com/*',
  ].sort());
  assert.equal(access[0].resources.includes('src/background/service-worker.js'), false);
});
