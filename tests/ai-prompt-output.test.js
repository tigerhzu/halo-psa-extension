'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const prompts = require('../src/ai/prompt-templates.js');
const previousPath = require('node:path').join(__dirname, '../release/halo-psa-extension-0.9.11/src/ai/prompt-templates.js');
const previousPrompts = require('node:fs').existsSync(previousPath) ? require(previousPath) : null;
const output = require('../src/ai/output-validator.js');

test('registered missing image positions allow preview while real technical values stay protected', function () {
  const source = '邀請洪博士成為來賓，連結看不到是因為沒有權限，請窗口到 Sharepoint 加入洪博士。\nHPXIMG-0001';
  assert.deepEqual(output.protectedValues(source), ['HPXIMG-0001']);
  const draft = '您好，\n已邀請洪博士成為來賓，因權限不足無法檢視連結，請窗口於 SharePoint 加入洪博士。\n謝謝。';
  assert.throws(() => output.prepareForPreview('improve_tone', source, draft), /重要技術值/);
  const prepared = output.prepareForPreview('improve_tone', source, draft, ['HPXIMG-0001']);
  assert.equal(prepared.text, draft);
  assert.match(prepared.warning, /圖片.*文末/);
  assert.throws(() => output.prepareForPreview('improve_tone', source + '\n10.20.30.40', draft,
    ['HPXIMG-0001', '10.20.30.40']), /重要技術值/);
  assert.throws(() => output.prepareForPreview('improve_tone', source + '\nHPXIMG-0002', draft,
    ['HPXIMG-0001']), /重要技術值/);
  assert.throws(() => output.prepareForPreview('improve_tone', source, '不完整回覆', ['HPXIMG-0001']), /格式不完整/);
  assert.equal(output.prepareForPreview('improve_tone', source, draft.replace('謝謝。', 'HPXIMG-0001\n謝謝。'), ['HPXIMG-0001']).warning, '');
  const noncanonical = output.prepareForPreview('professional', source, '一般處理紀錄', ['HPXIMG-0001']);
  assert.match(noncanonical.warning, /工單標籤/);
  assert.match(noncanonical.warning, /圖片.*文末/);
});

test('noncanonical professional drafts remain reviewable without invented labels or dropped content', function () {
  const draft = '處理紀錄\n【處理方式】重新登入 VPN。\n\n測試連線正常，處理時間 35 分鐘。';
  const prepared = output.prepareForPreview('professional', 'VPN 連線正常，35 分鐘。', draft);
  assert.equal(prepared.text, draft);
  assert.match(prepared.warning, /比對原文/);
  assert.equal(output.prepareForPreview('professional', 'VPN', '• 【資訊】VPN').warning, '');
  assert.throws(() => output.prepareForPreview('professional', '', '   '), /為空/);
  assert.throws(() => output.prepareForPreview('professional', '10.20.30.40', '一般段落 10.20.30.41'), /重要技術值/);
  assert.throws(() => output.prepareForPreview('professional', '', '一般段落 `未結束'), /行內程式碼不完整/);
  assert.throws(() => output.prepareForPreview('professional', '', '一般段落\n```text\nx'), /程式碼區塊不完整/);
  assert.throws(() => output.prepareForPreview('improve_tone', '', '一般段落'), /客戶回覆格式不完整/);
});

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

test('unchanged Azure actions remain identical to release 0.9.11', {skip: !previousPrompts && 'Historical 0.9.11 source is not present in this workspace.'}, function () {
  const text = '2026年9月4日 帳號 tiger，ID: 12345，版本 2024H2。';
  ['improve_tone', 'first_contact', 'translate'].forEach(function (action) {
    ['en', 'zh'].forEach(function (lang) {
      assert.equal(prompts.buildPrompt(action, text, lang), previousPrompts.buildPrompt(action, text, lang));
    });
  });
});

test('ticket sections preserve event order, intermediate failures and unknown content', function () {
  const renderer = require('../src/features/ticket-rich-format.js');
  const lines = ['- 【使用者回報】VPN 卡住 47%', '- 【處理動作】重啟失敗', '- 【確認結果】測試帳號正常', '- 【處理動作】清除舊認證', '- 【確認結果】重新連線正常', '- 【資訊】35 分鐘', '- 【已完成】結案', '- 【待辦】再次發生則追蹤'];
  const html = renderer.toHtml(lines.join('\n'));
  ['問題與現象', '處理過程', '確認結果與狀態', '後續追蹤'].forEach(title => assert.ok(html.includes('<strong>' + title + '</strong>')));
  let previous = -1;
  lines.forEach(line => {
    const body = line.split('】')[1];
    const index = html.indexOf(body);
    assert.ok(index > previous, body);
    previous = index;
  });
  assert.ok(html.indexOf('測試帳號正常') < html.indexOf('<strong>確認結果與狀態'));
  assert.match(html, /font color="orange">【待辦】/);
  assert.ok(renderer.toHtml(lines.concat('未知內容 <script>').join('\n')).includes('未知內容 &lt;script&gt;'));
  assert.doesNotMatch(renderer.toHtml('- 【資訊】短紀錄'), /<strong>/);
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

test('VPN narrative does not turn English prose into protected account values', function () {
  const source = "I logged in with a test account, and the test account connected normally. Amber's Windows profile or credentials have an issue. The user restarted Windows.";
  assert.deepEqual(output.protectedValues(source), []);
  assert.equal(output.validate('professional', source, '- 【確認結果】測試帳號連線正常。\n- 【資訊】Amber 的 Windows 設定檔或認證有問題，使用者已重新啟動 Windows。').ok, true);
  ['account: tiger', 'user = tiger', 'username tiger', 'account ID: tiger', '帳號 tiger'].forEach(function (source) {
    assert.ok(output.protectedValues(source).includes('tiger'), source);
    assert.equal(output.validate('translate', source, '帳號已確認').ok, false, source);
  });
});

test('professional presentation variants normalize to renderable semantic bullets', function () {
  const renderer = require('../src/features/ticket-rich-format.js');
  ['  • 【資訊】VPN 正常', '* 【資訊】VPN 正常', '1. 【資訊】VPN 正常', '【資訊】VPN 正常', '- **【資訊】** VPN 正常', '```markdown\n- 【資訊】VPN 正常\n```'].forEach(function (value) {
    const normalized = output.normalize('professional', value);
    assert.equal(normalized, '- 【資訊】VPN 正常');
    assert.equal(output.validate('professional', 'VPN 正常', value).ok, true);
    assert.match(renderer.toHtml(normalized), /font color="blue"/);
  });
  ['- 【未知】VPN 正常', '- 【資訊】', '以下為分析：\n- 【資訊】VPN 正常', '- 【資訊】VPN 正常\n無標籤段落'].forEach(function (value) {
    assert.equal(output.validate('professional', '', value).ok, false, value);
  });
  assert.equal(output.validate('professional', 'IP 10.20.30.40', '• 【資訊】IP 10.20.30.41').ok, false);
  assert.equal(output.normalize('translate', '```json\n{}\n```'), '```json\n{}\n```');
});
