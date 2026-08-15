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
assert.match(css, /input\[placeholder\*="search ticket" i\]::placeholder/);
assert.match(css, /color:\s*#667085\s*!important/);
assert.match(css, /opacity:\s*1\s*!important/);
assert.match(css, /color:\s*#273247\s*!important/);
assert.match(css, /\.hpx-besties-layer-host/);
assert.match(css, /\.hpx-besties-toolbar[\s\S]*z-index:\s*2147483647\s*!important/);

const bestiesToolbar = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'besties-toolbar.js'), 'utf8');
assert.match(bestiesToolbar, /classList\.add\('hpx-besties-layer-host'\)/);
assert.match(bestiesToolbar, /classList\.remove\('hpx-besties-layer-host'\)/);

const bestiesConfig = fs.readFileSync(path.join(ROOT, 'src', 'config', 'besties-config.js'), 'utf8');
const emailDetector = fs.readFileSync(path.join(ROOT, 'src', 'core', 'email-window-detector.js'), 'utf8');
assert.match(bestiesConfig, /NEW_TICKET_ROOT_SELECTORS/);
assert.match(bestiesConfig, /\.new-ticket-screen/);
assert.match(emailDetector, /function isNewTicketPage/);
assert.match(emailDetector, /if \(isNewTicketPage\(\)\) return \[\]/);
assert.match(emailDetector, /clearTracked\(\)/);

console.log('theme-cute-contrast.test.js ✓ Halo 白底元件維持可讀對比');
