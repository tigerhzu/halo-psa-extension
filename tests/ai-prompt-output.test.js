'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const prompts = require('../src/ai/prompt-templates.js');
const previousPath = require('node:path').join(__dirname, '../release/halo-psa-extension-0.9.11/src/ai/prompt-templates.js');
const previousPrompts = require('node:fs').existsSync(previousPath) ? require(previousPath) : null;
const output = require('../src/ai/output-validator.js');

test('each Ornith action has a static system message and dynamic data only in the user tail', function () {
  ['improve_tone', 'professional', 'first_contact', 'translate'].forEach(function (action) {
    const first = prompts.buildOrnithRequest(action, 'SECRET-A', 'en').body;
    const second = prompts.buildOrnithRequest(action, 'SECRET-B', 'en').body;
    assert.equal(first.messages[0].content, second.messages[0].content);
    assert.match(first.messages[0].content, /^\/no_think\n/);
    assert.doesNotMatch(first.messages[0].content, /SECRET-[AB]/);
    assert.match(first.messages[1].content, /SECRET-A\n【原始內容結束】$/);
    assert.match(second.messages[1].content, /SECRET-B\n【原始內容結束】$/);
    assert.deepEqual(first.chat_template_kwargs, { enable_thinking: false });
  });
});

test('Azure prompt builder remains byte-for-byte identical to release 0.9.11', {skip: !previousPrompts && 'Historical 0.9.11 source is not present in this workspace.'}, function () {
  const text = '2026年9月4日 帳號 tiger，ID: 12345，版本 2024H2。';
  ['improve_tone', 'professional', 'first_contact', 'translate'].forEach(function (action) {
    ['en', 'zh'].forEach(function (lang) {
      assert.equal(prompts.buildPrompt(action, text, lang), previousPrompts.buildPrompt(action, text, lang));
    });
  });
});

test('Ornith token budgets match feature output needs', function () {
  assert.equal(prompts.buildOrnithRequest('first_contact', 'x').body.max_tokens, 2048);
  assert.equal(prompts.buildOrnithRequest('professional', 'x').body.max_tokens, 4096);
  assert.equal(prompts.buildOrnithRequest('improve_tone', 'x').body.max_tokens, 4096);
  assert.equal(prompts.buildOrnithRequest('translate', 'x', 'zh').body.max_tokens, 4096);
  assert.equal(prompts.buildOrnithRequest('ping', '').body.max_tokens, 16);
  assert.equal(prompts.buildOrnithRequest('professional', 'x'.repeat(6001)).body.max_tokens, 8192);
  assert.equal(prompts.buildOrnithRequest('first_contact', 'x'.repeat(6001)).body.max_tokens, 2048);
});

test('technical URLs, IPs, accounts, dates, versions, IDs, commands and parameters must survive', function () {
  const source = [
    '2026-09-04 09:30 帳號: ACCT-7842',
    '2026年9月4日 帳號 tiger，ID: 12345，版本 2024H2',
    'IP 10.20.30.40，版本 v5.14.2，ID INC-20260904-0187',
    '執行 `agentctl inspect --node=node-07 --timeout=45s`',
    'https://ops.example.com/tickets/INC-20260904-0187?env=prod',
  ].join('\n');
  const valid = '- 【資訊】' + source.replace(/\n/g, '\n- 【資訊】');
  assert.equal(output.validate('professional', source, valid).ok, true);
  const invalid = valid.replace('10.20.30.40', '10.20.30.41');
  const result = output.validate('professional', source, invalid);
  assert.equal(result.ok, false);
  assert.equal(result.missingCount, 1);
});

test('professional, customer reply, JSON, HTML and Markdown validity checks reject malformed output', function () {
  assert.equal(output.validate('professional', 'x', 'plain paragraph').ok, false);
  assert.equal(output.validate('improve_tone', 'x', '您好，\n\n內容').ok, false);
  assert.equal(output.validate('translate', '{"id":"A-1"}', '{broken').ok, false);
  assert.equal(output.validate('translate', '<div><b>x</b></div>', '<div><b>x</div>').ok, false);
  assert.equal(output.validate('translate', 'text', '```js\nvalue').ok, false);
  assert.equal(output.validate('translate', 'text', '`value').ok, false);
  assert.equal(output.validate('translate', 'text', '[label](https://example.com').ok, false);
});
