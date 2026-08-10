'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

global.window = global;
global.window.__HPX = {
  config: {
    selectors: {
      TIMESHEET: {
        screen: '.timesheet-screen',
        calendar: '.rbc-calendar',
        event: '.rbc-event',
        eventLabel: '.rbc-event-label',
        eventContent: '.rbc-event-content',
      },
    },
  },
  features: {},
};

require(path.join(__dirname, '..', 'src', 'features', 'timesheet-align.js'));

const feature = window.__HPX.features.timesheetAlign;

const parsed = feature.parseEntryDetails(
  'Ticket 638015 - [KYM/凱麥博] Edge 跳告警通知 - 關閉 Edge 通知，向 user 說明原因。 (No Charge)'
);
assert.equal(parsed.ticketId, '638015');
assert.equal(parsed.client, 'KYM/凱麥博');
assert.equal(parsed.summary, 'Edge 跳告警通知');
assert.equal(parsed.workNote, '關閉 Edge 通知，向 user 說明原因。');
assert.equal(parsed.billing, 'No Charge');

const summaryOnly = feature.parseEntryDetails(
  'Ticket 636972 - [SRW/七棵橡樹] 發票機系統協助 (No Charge)'
);
assert.equal(summaryOnly.ticketId, '636972');
assert.equal(summaryOnly.client, 'SRW/七棵橡樹');
assert.equal(summaryOnly.summary, '發票機系統協助');
assert.equal(summaryOnly.workNote, '');

const base = [
  { index: 0, start: 600, end: 630, nextStart: 600, nextEnd: 630 },
  { index: 1, start: 630, end: 660, nextStart: 640, nextEnd: 670 },
];
const valid = feature.validateManualEntries(base);
assert.equal(valid.valid, true);
assert.equal(valid.changes.length, 1);
assert.equal(valid.entries[1].nextLabel, '10:40 – 11:10');

const overlap = feature.validateManualEntries([
  { index: 0, start: 600, end: 630, nextStart: 600, nextEnd: 650 },
  { index: 1, start: 630, end: 660, nextStart: 640, nextEnd: 670 },
]);
assert.equal(overlap.valid, false);
assert.equal(overlap.overlaps.length, 1);

const invalid = feature.validateManualEntries([
  { index: 0, start: 600, end: 630, nextStart: 700, nextEnd: 690 },
]);
assert.equal(invalid.valid, false);
assert.match(invalid.error, /結束時間必須晚於開始時間/);

console.log('timesheet-editor.test.js: 16 assertions passed');
