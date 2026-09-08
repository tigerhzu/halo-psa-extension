'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function element(tagName) {
  const attributes = {};
  const children = [];
  const classes = new Set();
  return {
    tagName: String(tagName || '').toUpperCase(),
    children: children,
    className: '',
    classList: {
      add: function () { Array.prototype.forEach.call(arguments, function (name) { classes.add(name); }); },
      remove: function (name) { classes.delete(name); },
      contains: function (name) { return classes.has(name); },
    },
    setAttribute: function (name, value) { attributes[name] = String(value); },
    getAttribute: function (name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
    appendChild: function (child) { children.push(child); child.parentNode = this; return child; },
    addEventListener: function () {},
    querySelector: function () { return null; },
  };
}

function loadTeamShortcuts(pathname) {
  const iconHost = element('span');
  const timesheets = element('a');
  timesheets.textContent = 'Timesheets';
  timesheets.nextSibling = null;
  timesheets.querySelector = function (selector) {
    return selector === '.app-button-img' ? iconHost : null;
  };

  const nav = element('nav');
  let shortcutRoot = null;
  nav.querySelector = function (selector) {
    return selector === '.hpx-ultimate-team-shortcuts' ? shortcutRoot : null;
  };
  nav.insertBefore = function (child) {
    shortcutRoot = child;
    child.parentNode = nav;
    return child;
  };

  const document = {
    createElement: element,
    querySelector: function (selector) {
      if (selector === '#app-nav-menu .app-nav-menu-sidebar') return nav;
      if (selector === '#halo-tree') return null;
      return null;
    },
  };
  const session = new Map();
  const cfg = {
    TEAM_ITEMS: ['Op Team A'],
    KEEP_ITEMS: ['Op Team A', 'Timesheets'],
    HALO_TREE_ROOT: '#halo-tree',
    HALO_TEAM_ROW_SELECTOR: '.treeviewnode',
    HALO_TEAM_TITLE_SELECTOR: '.title',
    HALO_NAV_MENU_SELECTOR: '#app-nav-menu .app-nav-menu-sidebar',
    HALO_ICON_LINK_SELECTOR: '.app-side-link',
    SHORTCUTS_ROOT_CLASS: 'hpx-ultimate-team-shortcuts',
    SHORTCUT_CLASS: 'hpx-ultimate-team-shortcut',
    PENDING_TEAM_KEY: 'hpx_ultimate_pending_team',
    TICKETS_ROUTE: '/tickets?area=1&mainview=team&viewid=0',
  };
  const shared = {
    cfg: { SIDEBAR: cfg },
    normalizeText: function (value) { return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase(); },
    safeQueryAll: function (root, selector) {
      if (root === nav && selector === cfg.HALO_ICON_LINK_SELECTOR) return [timesheets];
      if (root === document && selector === '.' + cfg.SHORTCUTS_ROOT_CLASS) return shortcutRoot ? [shortcutRoot] : [];
      if (root === shortcutRoot && selector === '.' + cfg.SHORTCUT_CLASS) return shortcutRoot.children;
      return [];
    },
    matchesLabel: function (node, labels) {
      return labels.some(function (label) { return String(node.textContent || '').trim() === label; });
    },
    warnOnce: function () {},
    clearWarning: function () {},
  };
  const window = {
    __HPX: { ultimate: { shared: shared } },
    location: {
      pathname: pathname,
      origin: 'https://example.halopsa.com',
      href: 'https://example.halopsa.com' + pathname,
    },
    sessionStorage: {
      getItem: function (key) { return session.get(key) || null; },
      setItem: function (key, value) { session.set(key, String(value)); },
      removeItem: function (key) { session.delete(key); },
    },
    setTimeout: function (callback) { callback(); },
  };
  const chrome = { runtime: { getURL: function (assetPath) { return 'chrome-extension://test/' + assetPath; } } };

  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'src/ultimate-mode/team-shortcuts.js'), 'utf8'),
    { window: window, document: document, chrome: chrome, URL: URL },
    { filename: 'team-shortcuts.js' }
  );

  return { module: window.__HPX.ultimate.teamShortcuts, nav: nav };
}

test('selected teams stay mounted on Home instead of being removed outside Tickets and Timesheets', function () {
  const harness = loadTeamShortcuts('/home');
  const report = harness.module.apply();

  assert.equal(report.mounted, true);
  assert.equal(harness.nav.querySelector('.hpx-ultimate-team-shortcuts').children.length, 1);
  assert.equal(
    harness.nav.querySelector('.hpx-ultimate-team-shortcuts').children[0].children[1].textContent,
    'Team A'
  );
});

test('selected teams remain mounted on unrelated Halo routes', function () {
  const harness = loadTeamShortcuts('/customers');
  const report = harness.module.apply();

  assert.equal(report.mounted, true);
  assert.equal(harness.nav.querySelector('.hpx-ultimate-team-shortcuts').children.length, 1);
});
