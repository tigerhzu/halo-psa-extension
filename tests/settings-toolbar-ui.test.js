'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'src/ui/settings-panel.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/styles/settings-panel.css'), 'utf8');
const surfaces = fs.readFileSync(path.join(ROOT, 'src/styles/workbench-surfaces.css'), 'utf8');

test('settings controls use clear Chinese labels in the horizontal toolbar', function () {
  ['快捷連結', '簡單模式', '主題色', '寵物', '設定'].forEach(function (label) {
    assert.match(js, new RegExp("makeSidebarControl\\('" + label));
  });
  assert.match(css, /\.hpx-sidebar-controls\s*\{[^}]*flex-direction:\s*row;/s);
  assert.match(css, /\.hpx-sidebar-control\[data-hpx-sidebar-control="mode"\]\s*\{[^}]*order:\s*1;/s);
  assert.match(css, /\.hpx-sidebar-control\[data-hpx-sidebar-control="settings"\]\s*\{[^}]*order:\s*4;/s);
  assert.match(css, /@media \(max-width:\s*480px\)[\s\S]*\.hpx-sidebar-control\[data-hpx-sidebar-control="mode"\]/);
});

test('mode, accent and collapsed states remain visually distinct and accessible', function () {
  assert.match(js, /簡單模式，.*已開啟.*已關閉/);
  assert.match(js, /主題色：/);
  assert.match(surfaces, /\.hpx-sidebar-control--active\s*\{[^}]*background:/s);
  assert.match(surfaces, /\.hpx-sidebar-control-label\s*\{[^}]*color:\s*inherit/s);
  assert.match(surfaces, /\.hpx-sidebar-controls--collapsed\s*\{[^}]*width:\s*44px\s*!important;/s);
});

test('color and pet popovers anchor above their own toolbar buttons', function () {
  assert.match(js, /anchorButton\s*=\s*kind/);
  assert.match(js, /anchor\.top\s*-\s*height\s*-\s*gap/);
  assert.match(js, /kind === 'pet' \? '寵物' : kind === 'links' \? '快捷連結' : '外觀與主題色'/);
});

test('horizontal toolbar leaves an inset around the viewport edge', function () {
  assert.match(js, /sidebarControlsEl\.style\.left\s*=\s*'16px'/);
  assert.doesNotMatch(js, /preferredLeft|rect\.right \+ 12/);
  assert.match(js, /sidebarControlsEl\.style\.bottom\s*=\s*'16px'/);
});

test('quick links remain available without the pet and collapsed editors stay hidden', function () {
  assert.match(js, /openSidebarPopover\('links'\)/);
  assert.match(js, /if \(kind === 'links'\)\s*\{[^}]*buildShortcutSection\(draft\)/s);
  assert.match(surfaces, /\[hidden\]\s*\{\s*display:none!important/);
  assert.match(js, /event\.key === 'Escape'/);
});
