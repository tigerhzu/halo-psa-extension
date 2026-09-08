'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('recipient shortcuts omit the outer label and frame', function () {
  const script = fs.readFileSync(path.join(ROOT, 'src/ui/besties-toolbar.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/toolbar.css'), 'utf8');

  assert.equal(script.includes("label.textContent = '聯絡人'"), false);
  assert.match(css, /\.hpx-toolbar\.hpx-besties-toolbar\s*\{[^}]*padding:\s*0;[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
});

test('time shortcuts are flat and only Apply is a boxed button', function () {
  const script = fs.readFileSync(path.join(ROOT, 'src/features/time-adjuster.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/time-adjuster.css'), 'utf8');

  assert.match(script, /ui\.summary\.textContent\s*=\s*'目前 '\s*\+\s*core\.formatSummary\(total\)/);
  assert.match(css, /\.hpx-tta\s*>\s*\.hpx-tta-btn\s*\{[^}]*border:\s*0;[^}]*border-left:\s*1px[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.hpx-tta\s*>\s*\.hpx-tta-btn--apply\s*\{[^}]*border:\s*1px[^}]*border-radius:\s*6px;/s);
});

test('editor quick templates float above the editor without changing layout', function () {
  const css = fs.readFileSync(path.join(ROOT, 'src/editor-window/editor.css'), 'utf8');

  assert.match(css, /\.hpx-ew__assistance\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*20;[^}]*overflow:\s*visible;/s);
  assert.match(css, /\.hpx-ew__toolbar\s+\.hpx-tb-dropdown-menu\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*30;/s);
  assert.match(css, /\.hpx-ew__paper\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/s);
  assert.doesNotMatch(css, /\.hpx-ew__toolbar\s+\.hpx-tb-dropdown-menu\s*\{[^}]*position:\s*static;/s);
});

test('options pages omit the repeated brand and page header chrome', function () {
  const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT, 'src/options/options.js'), 'utf8');

  assert.doesNotMatch(html, /class="wordmark"|class="page-header"|class="save-indicator"/);
  assert.match(html, /id="saveStatus"\s+class="sr-only"/);
  assert.doesNotMatch(script, /\$\('pageTitle'\)|\$\('pageDescription'\)/);
});
