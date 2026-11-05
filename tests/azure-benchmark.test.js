'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');

test('benchmark alternates modes, reports target honestly and never prints credentials or text', async () => {
  const file = path.resolve(__dirname, '../scripts/benchmark-azure.cjs');
  const calls = [], logs = [];
  let now = 0;
  const context = vm.createContext({
    require: createRequire(file), module: { exports: {} }, URL, AbortSignal,
    process: { env: { AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
      AZURE_OPENAI_DEPLOYMENT: 'test', AZURE_OPENAI_API_KEY: 'private-test-key' } },
    performance: { now: () => { now += 1000; return now; } },
    console: { log: value => logs.push(value) },
    fetch: async (url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'private-test-output' } }],
        usage: { completion_tokens: 80, completion_tokens_details: { reasoning_tokens: 20 } } }) };
    },
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  await context.module.exports.main();
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map(body => body.thinking?.type || 'default'), ['default', 'disabled', 'default', 'disabled', 'default', 'disabled']);
  assert.equal(new Set(calls.map(body => body.messages[0].content)).size, 1);
  for (const row of logs.slice(6, 8).map(JSON.parse)) {
    assert.equal(row.medianAverageTokensPerSecond, 60);
    assert.equal(row.meetsTarget, false);
  }
  assert.doesNotMatch(logs.join(''), /private-test-key|private-test-output|Wi-Fi/);
});
