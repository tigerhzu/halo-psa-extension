'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sourceRoot = process.env.HPX_TEST_ROOT || path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(sourceRoot, name), 'utf8');
function fixture(options = {}) {
  const inputListeners = [];
  const storageListeners = [];
  const writes = [];
  const outcome = { textContent: options.label || 'On Hold' };
  const heading = { textContent: '[ID:000123]', isConnected: true, getClientRects: () => [1] };
  const historyItem = options.history || options.draftHistory ? {
    getAttribute: () => options.history ? '21' : '-1',
    classList: { contains: name => name === 'isadding' && !!options.draftHistory },
  } : null;
  const owner = { closest: () => historyItem, querySelector: () => outcome };
  const editor = { isConnected: true, html: options.html || '', text: options.text || '',
    getClientRects: () => [1], closest: selector => selector.includes('toolbar') ? null : form, contains: target => target === editor };
  const form = { isConnected: true, getClientRects: () => [1], closest: () => owner,
    querySelector: () => options.email ? {} : null, querySelectorAll: () => options.multiple ? [editor, editor] : [editor] };
  let storageData = options.settings || {};
  let releaseRead;
  const adapter = {
    getText: el => el.text, getHtml: el => el.html, getKind: () => 'contenteditable',
    setHtmlReliable: async (el, html, opts) => {
      if (options.beforeWrite) await options.beforeWrite();
      if (!opts.canWrite()) return { ok: false };
      writes.push(html); el.html = html; el.text = html.replace(/<[^>]*>/g, '');
      return { ok: true };
    },
  };
  const window = { location: { href: 'https://test.halopsa.com/tickets?id=123' }, __HPX: {
    config: { selectors: { EDITOR_SELECTORS: ['.fr-element[contenteditable="true"]'] } }, core: { adapter }, features: {}, warn() {},
  } };
  const document = { querySelectorAll: selector => selector.startsWith('h1') ? [heading] : [form], addEventListener: (_, listener) => inputListeners.push(listener) };
  const chrome = { runtime: {}, storage: {
    local: { get: (_, cb) => { releaseRead = () => cb({ hpx_settings: storageData }); if (!options.delayRead) releaseRead(); } },
    onChanged: { addListener: listener => storageListeners.push(listener) },
  } };
  const sandbox = { window, document, chrome, URL };
  vm.runInNewContext(read('src/config/status-notes-config.js'), sandbox);
  vm.runInNewContext(read('src/features/status-notes.js'), sandbox);
  const api = window.__HPX.features.statusNotes;
  return { api, config: window.HPX_STATUS_NOTES, window, editor, form, heading, outcome, writes,
    releaseRead: () => releaseRead(),
    input: text => { editor.text = editor.html = text; inputListeners.forEach(fn => fn({ isTrusted: true, target: editor })); },
    change: value => { storageData = value; storageListeners.forEach(fn => fn({ hpx_settings: { newValue: value } }, 'local')); },
  };
}

test('all eight default notes and known aliases resolve without matching unrelated actions', async () => {
  const f = fixture();
  assert.equal(f.config.catalog.length, 8);
  for (const entry of f.config.catalog) {
    assert.equal(entry.text.includes('流程說明補登'), false);
    for (const label of entry.names) {
      const item = fixture({ label, draftHistory: true });
      await item.api.prepare(item.form);
      assert.equal(item.editor.text, entry.text);
    }
  }
  for (const label of ['Activity Note', 'Email User', 'Vendor Processing', 'Close Account', 'New']) {
    assert.equal(f.config.keyOf(label), undefined);
  }
});
test('normalization preserves intentional blanks and safely renders multiline text', () => {
  const f = fixture();
  assert.equal(f.config.normalize({ texts: { hold: '' } }).texts.hold, '');
  assert.equal(f.config.normalize({ texts: { hold: 4 } }).texts.hold, '案件列為暫停處理。');
  assert.equal(f.config.toHtml('<script>&\nnext'), '<div>&lt;script&gt;&amp;</div><div>next</div>');
});
test('fills Halo placeholder, but preserves authored text and media-only notes', async () => {
  for (const options of [{ text: '客戶已回覆' }, { html: '<img src="x">' }, { html: '<table></table>' }, { text: '$SERVICESTATUSNOTE 附加說明' }]) {
    const f = fixture(options); await f.api.prepare(f.form); assert.equal(f.writes.length, 0);
  }
  const f = fixture({ text: '$SERVICESTATUSNOTE', html: '<p>$SERVICESTATUSNOTE</p>' });
  await f.api.prepare(f.form); assert.equal(f.editor.text, '案件列為暫停處理。');
});
test('Halo unsaved isadding history wrapper with data-id -1 accepts placeholder replacement', async () => {
  const f = fixture({ draftHistory: true, text: '$SERVICESTATUSNOTE', html: '<p><span>$SERVICESTATUSNOTE</span></p>' });
  await f.api.prepare(f.form);
  assert.equal(f.editor.text, '案件列為暫停處理。');
  assert.equal(f.writes.length, 1);
});
test('positive history ID is preserved even if marked isadding', async () => {
  const f = fixture({ history: true, draftHistory: true, text: '$SERVICESTATUSNOTE' });
  await f.api.prepare(f.form); assert.equal(f.writes.length, 0);
});
test('does not duplicate or refill a manually cleared note', async () => {
  const f = fixture(); await f.api.prepare(f.form); f.input('');
  f.api.reconcile(); await f.api.prepare(f.form); assert.equal(f.writes.length, 1); assert.equal(f.editor.text, '');
});
test('same editor action switch updates only untouched generated content', async () => {
  const f = fixture(); await f.api.prepare(f.form);
  f.outcome.textContent = 'Pending'; await f.api.prepare(f.form); assert.equal(f.editor.text, '案件列為暫緩處理。');
  f.input('我的內容'); f.outcome.textContent = 'Postponed'; await f.api.prepare(f.form); assert.equal(f.editor.text, '我的內容');
});
test('ignores email, historical, ambiguous, unrelated and mismatched ticket forms', async () => {
  for (const options of [{ email: true }, { history: true }, { multiple: true }, { label: 'Activity Note' }]) {
    const f = fixture(options); await f.api.prepare(f.form); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.heading.textContent = '[ID:124]'; await f.api.prepare(f.form); assert.equal(f.writes.length, 0);
});
test('disabled and blank preferences skip filling; custom values are used', async () => {
  for (const statusNotes of [{ enabled: false }, { texts: { hold: '' } }]) {
    const f = fixture({ settings: { statusNotes } }); await f.api.prepare(f.form); assert.equal(f.writes.length, 0);
  }
  const f = fixture({ settings: { statusNotes: { texts: { hold: '自訂文字' } } } });
  await f.api.prepare(f.form); assert.equal(f.editor.text, '自訂文字');
});
test('preparation waits for storage and preserves typing that happened during loading', async () => {
  const f = fixture({ delayRead: true }); const ready = f.api.prepare(f.form);
  f.input('使用者先輸入'); f.releaseRead(); await ready; assert.equal(f.writes.length, 0);
});
test('pending fallback cannot overwrite typing, navigate to another ticket, or write a detached editor', async () => {
  for (const mutate of [f => f.input('正在編輯'), f => { f.window.location.href += '4'; }, f => { f.editor.isConnected = false; }]) {
    let release;
    const f = fixture({ beforeWrite: () => new Promise(resolve => { release = resolve; }) });
    const pending = f.api.prepare(f.form); mutate(f); release(); await pending; assert.equal(f.writes.length, 0);
  }
});
test('settings changes affect next action without changing current draft', async () => {
  const f = fixture(); await f.api.prepare(f.form);
  f.change({ statusNotes: { texts: { pending: '稍後處理' } } }); f.api.reconcile();
  assert.equal(f.editor.text, '案件列為暫停處理。');
  f.outcome.textContent = 'Pending'; await f.api.prepare(f.form); assert.equal(f.editor.text, '稍後處理');
});
