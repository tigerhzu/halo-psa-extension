'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('quick-link editor saves only on confirm and provides cancel', function () {
  const js = fs.readFileSync(path.join(ROOT, 'src/ui/settings-panel.js'), 'utf8');
  const nameInputHandler = js.match(/nameInput\.addEventListener\('input',[\s\S]*?\n\s*}\);/);
  const urlInputHandler = js.match(/urlInput\.addEventListener\('input',[\s\S]*?\n\s*}\);/);

  assert.ok(nameInputHandler);
  assert.ok(urlInputHandler);
  assert.doesNotMatch(nameInputHandler[0], /persistShortcutLinks/);
  assert.doesNotMatch(urlInputHandler[0], /persistShortcutLinks/);
  assert.match(js, /hpx-sp-shortcut-confirm', '確認'/);
  assert.match(js, /hpx-sp-shortcut-cancel', '取消'/);
  assert.match(js, /confirm\.addEventListener\('click'/);
  assert.match(js, /cancel\.addEventListener\('click'/);
  assert.match(js, /event\.key === 'Escape'/);
});

test('simple-mode search alignment is scoped to Halo global search', function () {
  const css = fs.readFileSync(path.join(ROOT, 'src/ultimate-mode/ultimate.css'), 'utf8');
  assert.match(
    css,
    /#halo-nav \.nhd-nav-rightAlign > \.buttoncontainer > \.nhd-nav-btn\[title="Search \(Ctrl \+ Shift \+ F\)"\]\s*\{[\s\S]*?top:\s*6px;/
  );
});
