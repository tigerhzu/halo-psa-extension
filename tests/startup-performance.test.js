'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

for (const idle of [true, false]) {
  test('startup yields between features and survives a failed feature (' + (idle ? 'idle' : 'timer') + ')', () => {
    const queue = [], calls = [], warnings = [], timeouts = [];
    let now = 0;
    const feature = name => ({ start() { calls.push(name); if (name === 'ultimateMode') throw Error('fixture'); } });
    const NS = {
      features: Object.fromEntries(['noteWindow', 'statusNotes', 'ultimateMode', 'ticketReader', 'quickStatus', 'timesheetAlign', 'timeAdjuster'].map(n => [n, feature(n)])),
      ui: Object.fromEntries(['categoryPicker', 'theme', 'settingsPanel', 'onboarding'].map(n => [n, feature(n)])),
      core: { detector: feature('detector'), emailWindowDetector: feature('emailWindowDetector') },
      warn: (...args) => warnings.push(args), log() {},
    };
    const window = { __HPX: NS, setTimeout: fn => queue.push(fn) };
    if (idle) window.requestIdleCallback = (fn, options) => { timeouts.push(options.timeout); queue.push(fn); };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8'), { window, document: { readyState: 'complete' }, Date: {now:()=>now}, console });
    assert.deepEqual(calls, ['noteWindow', 'statusNotes']);
    while (queue.length) {
      assert.equal(queue.length, 1, 'only one background startup task is queued');
      const before = calls.length;
      now += 1000;
      queue.shift()();
      assert.equal(calls.length, before + 1, 'one feature per task');
    }
    assert.equal(calls.length, 13);
    assert.equal(new Set(calls).size, 13);
    assert.equal(warnings.length, 1);
    assert.equal(calls.at(-1), 'timeAdjuster');
    if (idle) {
      assert.deepEqual(timeouts.slice(0, 3), [1000, 500, 1]);
      assert.ok(timeouts.slice(2).every(ms => ms === 1), 'timeout budget does not accumulate per feature');
    }
  });
}
