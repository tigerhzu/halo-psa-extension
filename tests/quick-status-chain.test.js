'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = { window: { __HPX: { features: {} } } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/features/quick-status-chain.js'), 'utf8'), sandbox);
const api = sandbox.window.__HPX.features.quickStatusChain;
const entry = key => ({ label: api.catalog.find(item => item.key === key).label, disabled: false });
function fixture(options = {}) {
  let time = 0, id = '123', stage = 'Open', form = null, modal = false;
  let items = [entry('progress')];
  const records = [];
  const clicks = [], saves = [], messages = [];
  let runner;
  const adapter = {
    ticketId: () => id,
    state: () => ({ id, stage, items }),
    forms: () => form ? [form] : [],
    modal: () => modal,
    history: () => records.slice(),
    saved: (before, key) => records.some(record => !before.includes(record) && record.key === key),
    click: item => {
      const key = api.keyOf(item.label);
      clicks.push(key);
      if (options.modal && clicks.length === 1) { modal = true; return; }
      form = { node: {}, label: item.label };
    },
    saveBlocker: () => options.blocker || '',
    save: current => {
      saves.push(api.keyOf(current.label));
      if (!options.failSave) complete();
    },
    report: text => messages.push(text), finished: () => {},
    now: () => time,
    delay: async ms => {
      time += ms;
      if (options.onTick) options.onTick({ time, complete, switchTicket: () => { id = '999'; }, cancel: () => runner.cancel(),
        dismiss: () => { form = null; }, resolveModal: () => { modal = false; form = { node: {}, label: entry('progress').label }; },
        replaceForm: () => { form = { node: {}, label: 'Email User' }; } });
    },
  };
  function complete() {
    if (!form) return;
    const key = api.keyOf(form.label);
    records.push({ key });
    form = null;
    stage = key === 'final' ? 'Final confirmation' : 'In-Progress';
    items = key === 'final' ? [entry('resolved')] : [entry('progress'), entry('final'), entry('hold')];
  }
  runner = api.create(adapter);
  return { runner, clicks, saves, messages, setItems: value => { items = value; }, setStage: value => { stage = value; },
    setForm: value => { form = value; }, getForm: () => form };
}
test('Open → Final Check saves In Progress once and leaves final form unsaved', async () => {
  const f = fixture();
  assert.equal(await f.runner.execute('123', 'final'), true);
  assert.deepEqual(f.clicks, ['progress', 'final']);
  assert.deepEqual(f.saves, ['progress']);
  assert.equal(api.keyOf(f.getForm().label), 'final');
});
test('Open → Resolved saves In Progress and Final Check, never the final Resolved form', async () => {
  const f = fixture();
  assert.equal(await f.runner.execute('123', 'resolved'), true);
  assert.deepEqual(f.clicks, ['progress', 'final', 'resolved']);
  assert.deepEqual(f.saves, ['progress', 'final']);
});
test('available Final Check skips In Progress', async () => {
  const f = fixture(); f.setItems([entry('progress'), entry('final')]);
  assert.equal(await f.runner.execute('123', 'final'), true);
  assert.deepEqual(f.clicks, ['final']); assert.deepEqual(f.saves, []);
});
test('already available Resolve never repeats Final Check', async () => {
  const f = fixture(); f.setItems([entry('resolved')]); f.setStage('Final confirmation');
  assert.equal(await f.runner.execute('123', 'resolved'), true);
  assert.deepEqual(f.clicks, ['resolved']);
});
test('On Hold also completes In Progress automatically', async () => {
  const f = fixture();
  assert.equal(await f.runner.execute('123', 'hold'), true);
  assert.deepEqual(f.clicks, ['progress', 'hold']);
});
test('disabled target does not trigger prerequisite work', async () => {
  const f = fixture(); f.setItems([entry('progress'), { ...entry('final'), disabled: true }]);
  assert.equal(await f.runner.execute('123', 'final'), false); assert.deepEqual(f.clicks, []);
});
test('failed Save is submitted only once and never advances or claims success', async () => {
  const f = fixture({ failSave: true });
  assert.equal(await f.runner.execute('123', 'final'), false);
  assert.deepEqual(f.clicks, ['progress']); assert.deepEqual(f.saves, ['progress']);
  assert.match(f.messages.at(-1), /逾時/);
});
test('ticket navigation after click aborts before Save', async () => {
  const f = fixture({ onTick: ({ time, switchTicket }) => { if (time === 200) switchTicket(); } });
  assert.equal(await f.runner.execute('123', 'final'), false); assert.deepEqual(f.saves, []);
});
test('cancellation aborts before Save and a duplicate launch cannot start', async () => {
  const f = fixture({ onTick: ({ cancel }) => cancel() });
  const first = f.runner.execute('123', 'final');
  assert.equal(await f.runner.execute('123', 'resolved'), false);
  assert.equal(await first, false); assert.deepEqual(f.saves, []);
});
test('user closes prerequisite form without saving: no next action', async () => {
  const f = fixture({ onTick: ({ time, dismiss }) => { if (time === 200) dismiss(); } });
  assert.equal(await f.runner.execute('123', 'final'), false); assert.deepEqual(f.clicks, ['progress']);
});
test('pre-existing drafts are not overwritten or submitted', async () => {
  const f = fixture(); f.setForm({ node: {}, label: 'Activity Note' });
  assert.equal(await f.runner.execute('123', 'final'), false); assert.deepEqual(f.clicks, []);
});
test('extra fields wait for manual save then resume', async () => {
  const f = fixture({ blocker: '額外欄位', onTick: ({ time, complete }) => { if (time === 1000) complete(); } });
  assert.equal(await f.runner.execute('123', 'final'), true);
  assert.deepEqual(f.saves, []); assert.deepEqual(f.clicks, ['progress', 'final']);
});
test('Log Response modal waits for user choice before continuing', async () => {
  const f = fixture({ modal: true, onTick: ({ time, resolveModal }) => { if (time === 1000) resolveModal(); } });
  assert.equal(await f.runner.execute('123', 'final'), true); assert.deepEqual(f.saves, ['progress']);
  assert.ok(f.messages.some(text => text.includes('Log Response')));
});
test('unexpected action replacement stops without saving it', async () => {
  const f = fixture({ onTick: ({ time, replaceForm }) => { if (time === 200) replaceForm(); } });
  assert.equal(await f.runner.execute('123', 'final'), false); assert.deepEqual(f.saves, []);
});
test('missing action on a closed ticket never runs In Progress', async () => {
  const f = fixture(); f.setStage('Closed');
  assert.equal(await f.runner.execute('123', 'final'), false); assert.deepEqual(f.clicks, []);
});
