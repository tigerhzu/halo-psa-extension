'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function textNode(value) {
  return { nodeType: 3, nodeValue: value, parentElement: null };
}

function element(options) {
  const attrs = new Map(Object.entries(options.attrs || {}));
  const children = [];
  const node = {
    nodeType: 1,
    tagName: options.tag || 'DIV',
    className: options.className || '',
    isConnected: options.connected !== false,
    parentElement: null,
    children: children,
    childNodes: [],
    getAttribute: function (name) { return attrs.has(name) ? attrs.get(name) : null; },
    setAttribute: function (name, value) { attrs.set(name, String(value)); },
    removeAttribute: function (name) { attrs.delete(name); },
    matches: function (selector) {
      if (selector === '.details-group') return node.className.split(/\s+/).includes('details-group');
      if (selector === '.details-group-header') return node.className.split(/\s+/).includes('details-group-header');
      return false;
    },
    closest: function () { return null; },
    contains: function (candidate) {
      let current = candidate;
      while (current) {
        if (current === node) return true;
        current = current.parentElement;
      }
      return false;
    },
    getBoundingClientRect: function () {
      return options.visible === false
        ? { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }
        : { left: 10, right: 210, top: 10, bottom: 50, width: 200, height: 40 };
    },
    querySelector: function (selector) {
      if (selector === ':scope > .info.info-form') {
        return children.find(function (child) { return child.className === 'info info-form'; }) || null;
      }
      if (selector === 'label') {
        return children.find(function (child) { return child.tagName === 'LABEL'; }) || null;
      }
      return null;
    },
    querySelectorAll: function (selector) {
      if (selector === ':scope > .col-md-12.inline.nopad') {
        return children.filter(function (child) { return child.className === 'col-md-12 inline nopad'; });
      }
      return [];
    },
  };
  if (options.text) {
    const text = textNode(options.text);
    text.parentElement = node;
    node.childNodes.push(text);
  }
  return node;
}

function append(parent, child) {
  child.parentElement = parent;
  parent.children.push(child);
  parent.childNodes.push(child);
}

function makeRow(labelText) {
  const row = element({ className: 'col-md-12 inline nopad' });
  append(row, element({ tag: 'LABEL', text: labelText }));
  return row;
}

function createHarness() {
  const body = element({ tag: 'BODY' });
  const staleGroup = element({ className: 'details-group', visible: false });
  const staleHeading = element({ className: 'details-group-header', text: 'Ticket information', visible: false });
  const staleInfo = element({ className: 'info info-form', visible: false });
  append(staleGroup, staleHeading);
  append(staleGroup, staleInfo);
  append(body, staleGroup);

  const liveGroup = element({ className: 'details-group' });
  const liveHeading = element({ className: 'details-group-header', text: 'Ticket information' });
  const liveInfo = element({ className: 'info info-form' });
  append(liveInfo, makeRow('Date Created'));
  append(liveInfo, makeRow('Status'));
  append(liveInfo, makeRow('Workflow'));
  append(liveGroup, liveHeading);
  append(liveGroup, liveInfo);
  append(body, liveGroup);

  const document = {
    body: body,
    documentElement: element({ tag: 'HTML' }),
    querySelectorAll: function (selector) {
      return selector === '.details-group-header' ? [staleHeading, liveHeading] : [];
    },
  };
  const config = {
    ULTIMATE_MODE: {
      TEXT_SUBTREE_SKIP_SELECTOR: 'ul',
      TEXT_CANDIDATE_SELECTORS: [],
      MAX_LABEL_TEXT_LENGTH: 100,
      OWN_UI_ROOT_SELECTORS: [],
      HIDDEN_CLASS: 'halo-ultimate-hidden',
      OWNED_ATTR: 'data-hpx-ultimate-hidden',
      SECTION_ATTR: 'data-hpx-ultimate-section',
      KEEP_ATTR: 'data-hpx-ultimate-keep',
      DETAILS: {
        HALO_HEADING_SELECTOR: '.details-group-header',
        HALO_GROUP_SELECTOR: '.details-group',
        HALO_INFO_SELECTOR: ':scope > .info.info-form',
        HALO_FIELD_ROW_SELECTOR: ':scope > .col-md-12.inline.nopad',
        HALO_FIELD_LABEL_SELECTOR: 'label',
        MIN_FIELD_ROWS: 2,
      },
    },
  };
  const window = {
    __HPX: {
      config: { selectors: config },
      ultimate: {},
      warn: function () {},
    },
    getComputedStyle: function (node) {
      const rect = node.getBoundingClientRect();
      return { display: rect.width ? 'block' : 'none', visibility: 'visible' };
    },
  };
  const sandbox = { window: window, document: document, console: console };
  vm.createContext(sandbox);
  const filename = path.join(ROOT, 'src/ultimate-mode/shared.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename: filename });
  return { shared: window.__HPX.ultimate.shared, liveGroup: liveGroup };
}

test('SPA detail lookup skips a stale first section and selects the visible complete section', function () {
  const harness = createHarness();
  const match = harness.shared._internals.findHaloDetailSection({
    HEADINGS: ['Ticket Information'],
    KEEP_FIELDS: ['Date Created', 'Status'],
  });

  assert.ok(match);
  assert.equal(match.section, harness.liveGroup);
  assert.equal(match.score, 2);
  assert.equal(match.rows.length, 3);
});
