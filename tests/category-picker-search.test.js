'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src/ui/category-picker.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/styles/category-picker.css'), 'utf8');

test('Category modal keeps a dedicated search field in its fixed top toolbar', function () {
  assert.match(source, /search\.placeholder\s*=\s*'搜尋 Category…'/);
  assert.match(source, /search\.setAttribute\('aria-label', '搜尋 Category'\)/);
  assert.match(source, /toolbar\.append\(searchWrap, status\)/);
  assert.match(css, /\.hpx-category-toolbar\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(css, /\.hpx-category-tree\s*\{[^}]*overflow-y:\s*scroll\s*!important;/s);
  assert.match(css, /\.hpx-category-search-clear\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s);
});

test('Category search mirrors text to Halo native search and can be cleared', function () {
  assert.match(source, /search\.addEventListener\('input', applySearch\)/);
  assert.match(source, /setNativeInputValue\(active\.combo, value\)/);
  assert.match(source, /scheduleNativeRefresh\(160\)/);
  assert.match(source, /clearSearch\.addEventListener\('click'/);
  assert.match(source, /active\.search\.disabled\s*=\s*false/);
});

test('Favorites header is concise and its toggle is a repositioned circular control', function () {
  assert.doesNotMatch(source, /點分類旁的星號加入，可上下拖曳調整順序/);
  assert.match(css, /\.hpx-category-favorites-handle\s*\{[^}]*top:\s*15px;[^}]*left:\s*-54px;[^}]*height:\s*34px;[^}]*border-radius:\s*50%;/s);
  assert.match(css, /\.hpx-category-shell--favorites-collapsed \.hpx-category-favorites-handle\s*\{[^}]*left:\s*-17px;/s);
  assert.match(css, /@media \(max-width:\s*1100px\)[\s\S]*\.hpx-category-favorites-handle\s*\{[^}]*z-index:\s*6;/s);
});
