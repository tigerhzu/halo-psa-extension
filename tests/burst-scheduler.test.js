'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = process.env.HPX_TEST_ROOT || path.resolve(__dirname, '..');

function harness(options) {
  let clock = 1000;
  const frames = [];
  const timers = [];
  const window = {
    setTimeout: (callback, ms) => { timers.push({ callback, at: clock + ms }); },
    localStorage: { getItem: () => null },
  };
  if (!options || options.raf !== false) window.requestAnimationFrame = callback => { frames.push(callback); };
  const source = fs.readFileSync(path.join(root, 'src/core/namespace.js'), 'utf8');
  vm.runInNewContext(source, { window, Date: { now: () => clock }, console });
  let runs = 0;
  return {
    schedule: window.__HPX.burstScheduler(() => { runs += 1; }, 150),
    runs: () => runs,
    frame() { frames.splice(0).forEach(callback => callback()); },
    advance(ms) {
      clock += ms;
      const due = timers.filter(timer => timer.at <= clock);
      due.forEach(timer => timers.splice(timers.indexOf(timer), 1));
      due.forEach(timer => timer.callback());
    },
  };
}

test('an idle scheduler runs once on the next frame, never synchronously', () => {
  const h = harness();
  h.schedule(); h.schedule(); h.schedule();
  assert.equal(h.runs(), 0);
  h.frame();
  assert.equal(h.runs(), 1);
});

test('a burst inside the interval collapses into one trailing run', () => {
  const h = harness();
  h.schedule(); h.frame();
  for (let i = 0; i < 20; i += 1) { h.advance(5); h.schedule(); h.frame(); }
  assert.equal(h.runs(), 1, 'calls 100ms into the interval must not run yet');
  h.advance(50); h.frame();
  assert.equal(h.runs(), 2, 'the trailing run handles the final DOM state');
  h.advance(1000); h.frame();
  assert.equal(h.runs(), 2, 'nothing runs without a new call');
});

test('a call after the interval has elapsed runs on the next frame again', () => {
  const h = harness();
  h.schedule(); h.frame();
  h.advance(151);
  h.schedule();
  assert.equal(h.runs(), 1);
  h.frame();
  assert.equal(h.runs(), 2);
});

test('falls back to a timer when requestAnimationFrame is unavailable', () => {
  const h = harness({ raf: false });
  h.schedule();
  assert.equal(h.runs(), 0);
  h.advance(0);
  assert.equal(h.runs(), 1);
});
