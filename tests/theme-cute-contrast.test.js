/** Cute theme contrast regressions for Halo white surfaces. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const themeJs = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'theme.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'theme-cute-ios.css'), 'utf8');

assert.match(
  themeJs,
  /\.new-ticket-screen, \.ticketDetailsScreen, \.details-container/,
  'New Ticket/Ticket details 不可被幾何偵測誤標為 Sidebar'
);
assert.match(themeJs, /if \(mainDetails && !insideRealSidebar\) return;/);
assert.match(css, /#team-dropdown > \.menu > \.item > \.text/);
assert.match(css, /#team-dropdown > \.text/);
assert.match(css, /#team-dropdown > \.dropdown\.icon/);
assert.match(css, /\.hpx-theme-sidebar \.Select__option/);
assert.match(css, /\.new-ticket-screen \.details-sidebar \.profile-full-name/);
assert.match(css, /\.new-ticket-screen \.details-sidebar input::placeholder/);
assert.match(css, /color:\s*#273247\s*!important/);

console.log('theme-cute-contrast.test.js ✓ Halo 白底元件維持可讀對比');
