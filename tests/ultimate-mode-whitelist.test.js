'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadUltimateConfig() {
  const sandbox = { window: { __HPX: { config: {} } } };
  vm.createContext(sandbox);
  const filename = path.join(ROOT, 'src/config/selectors.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename: filename });
  return sandbox.window.__HPX.config.selectors.ULTIMATE_MODE;
}

test('simple mode detail whitelist matches the compact ticket sidebar', function () {
  const config = loadUltimateConfig();

  assert.deepEqual(Array.from(config.TICKET_INFO.KEEP_FIELDS), [
    'Date Created',
    'Ticket Type',
    'Status',
    'Team',
    'Assigned Agent',
    'Additional Agents',
    'Time Recorded',
    'Impact',
    'Category',
  ]);
  assert.deepEqual(Array.from(config.USER_INFO.KEEP_FIELDS), [
    'User',
    'Top Level',
    'Client',
    'Site',
    'Email Address',
    'Phone Number',
    'Site Phone Number',
  ]);
});
