'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('New Ticket detail mounted at the root URL still runs detail filters', function () {
  const calls = [];
  const module = function (name) {
    return {
      apply: function () {
        calls.push(name);
        return { found: true };
      },
    };
  };
  const documentElement = {
    setAttribute: function () {},
    removeAttribute: function () {},
  };
  const document = {
    documentElement: documentElement,
    querySelector: function (selector) {
      return selector.includes('.details_page_title') ? {} : null;
    },
  };
  const shared = {
    cfg: {
      DEFAULT_TEAM_ITEMS: [],
      TEAM_PRESETS: [],
      TEAM_CATALOG_VERSION_FIELD: 'ultimateTeamsCatalogVersion',
      TEAM_CATALOG_VERSION: 1,
      TEAMS_FIELD: 'ultimateTeams',
      SETTING_FIELD: 'ultimateMode',
      SIDEBAR: { TEAM_ITEMS: [], KEEP_ITEMS: [] },
    },
    normalizeText: function (value) { return String(value || '').toLowerCase(); },
    restoreSection: function () {},
    restoreAll: function () {},
    warnOnce: function () {},
  };
  const window = {
    __HPX: {
      ultimate: {
        shared: shared,
        sidebar: module('sidebar'),
        teamShortcuts: Object.assign(module('teamShortcuts'), { restore: function () {} }),
        header: module('header'),
        ticketActions: module('ticketActions'),
        ticketUtilities: module('ticketUtilities'),
        ticketInfo: module('ticketInfo'),
        userInfo: module('userInfo'),
        observer: { start: function () {}, stop: function () {}, schedule: function () {} },
      },
      features: {},
      log: function () {},
    },
    location: { href: 'https://example.halopsa.com/', pathname: '/', search: '' },
    performance: { now: function () { return 0; } },
  };
  const sandbox = { window: window, document: document, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout };
  vm.createContext(sandbox);
  const filename = path.join(ROOT, 'src/ultimate-mode/index.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename: filename });

  window.__HPX.features.ultimateMode.setEnabled(true);

  assert.equal(window.__HPX.features.ultimateMode._isTicketDetailsMounted(), true);
  assert.ok(calls.includes('ticketInfo'));
  assert.ok(calls.includes('userInfo'));
});
