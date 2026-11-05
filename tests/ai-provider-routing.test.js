'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('both providers return normalized professional output for preview', async function () {
  for (const provider of ['ornith', 'azure-deepseek']) {
    const worker = createWorker({
      provider: provider,
      ornithBaseUrl: 'https://ornith.example.invalid/v1',
      ornithModel: 'test-model',
      ornithApiKey: provider === 'ornith' ? 'local-secret' : '',
      azureEndpoint: 'https://test.openai.azure.com',
      azureDeployment: 'test',
      azureApiKey: provider === 'azure-deepseek' ? 'azure-secret' : '',
    }, { choices: [{ message: { content: '• **【確認結果】** 測試帳號連線正常。' }, finish_reason: 'stop' }] });
    const result = await worker.context.handleAiRequest({
      action: 'professional', text: 'The test account connected normally.',
    });
    assert.equal(result.text, '- 【確認結果】測試帳號連線正常。');
    assert.equal(worker.calls.length, 1);
    assert.equal(result.warning, '');
  }
});

test('both providers pass noncanonical drafts to preview with a warning', async function () {
  for (const provider of ['ornith', 'azure-deepseek']) {
    const worker = createWorker({
      provider: provider,
      ornithBaseUrl: 'https://ornith.example.invalid/v1',
      ornithModel: 'test-model',
      ornithApiKey: provider === 'ornith' ? 'local-secret' : '',
      azureEndpoint: 'https://test.openai.azure.com', azureDeployment: 'test',
      azureApiKey: provider === 'azure-deepseek' ? 'azure-secret' : '',
    }, { choices: [{ message: { content: '處理紀錄\n測試帳號連線正常。' }, finish_reason: 'stop' }] });
    const result = await worker.context.handleAiRequest({ action: 'professional', text: '測試帳號連線正常。' });
    assert.equal(result.text, '處理紀錄\n測試帳號連線正常。');
    assert.match(result.warning, /比對原文/);
    assert.equal(worker.calls.length, 1);
  }
});

function eventTarget() {
  return { addListener: function () {} };
}

test('both providers pass locally recoverable image warnings to preview without sending image metadata', async function () {
  for (const provider of ['ornith', 'azure-deepseek']) {
    const worker = createWorker({ provider, ornithBaseUrl: 'https://ornith.example.invalid/v1',
      ornithModel: 'test-model', ornithApiKey: provider === 'ornith' ? 'local-secret' : '',
      azureEndpoint: 'https://test.openai.azure.com', azureDeployment: 'test',
      azureApiKey: provider === 'azure-deepseek' ? 'azure-secret' : '' });
    const result = await worker.context.handleAiRequest({ action: 'professional', text: 'SharePoint\nHPXIMG-0001', imageTokens: ['HPXIMG-0001'] });
    assert.match(result.warning, /圖片.*文末/);
    assert.equal(worker.calls.length, 1);
    assert.equal(JSON.parse(worker.calls[0].options.body).imageTokens, undefined);
  }
});

test('Azure thinking opt-in is persisted and sent for both drafts and connection tests', async function () {
  const worker = createWorker({ provider: 'azure-deepseek', azureEndpoint: 'https://test.openai.azure.com',
    azureDeployment: 'custom-deployment', azureApiKey: 'azure-secret', azureThinkingMode: 'disabled' });
  await worker.context.handleAiRequest({ action: 'professional', text: 'test' });
  await worker.context.handleAiPing();
  assert.equal(worker.calls.length, 2);
  for (const call of worker.calls) assert.deepEqual(JSON.parse(call.options.body).thinking, { type: 'disabled' });
});

test('Azure rejects unsupported thinking control without silently retrying', async function () {
  const worker = createWorker({ provider: 'azure-deepseek', azureEndpoint: 'https://test.openai.azure.com',
    azureDeployment: 'custom-deployment', azureApiKey: 'azure-secret', azureThinkingMode: 'disabled' },
    { error: { message: 'Unknown parameter thinking' } }, { ok: false, status: 400 });
  await assert.rejects(worker.context.handleAiPing(), /不接受關閉 Thinking.*服務預設/);
  assert.equal(worker.calls.length, 1);
});

test('unknown thinking settings preserve the compatible Azure request body', async function () {
  const worker = createWorker({ provider: 'azure-deepseek', azureEndpoint: 'https://test.openai.azure.com',
    azureDeployment: 'custom-deployment', azureApiKey: 'azure-secret', azureThinkingMode: 'invalid' });
  await worker.context.handleAiPing();
  assert.equal(JSON.parse(worker.calls[0].options.body).thinking, undefined);
});

test('network failures identify the provider and Tailscale recovery without retrying', async function () {
  for (const provider of ['ornith', 'azure-deepseek']) {
    const worker = createWorker({
      provider: provider,
      ornithBaseUrl: 'https://test.ts.net/v1', ornithModel: 'test-model',
      ornithApiKey: provider === 'ornith' ? 'local-secret' : '',
      azureEndpoint: 'https://test.openai.azure.com', azureDeployment: 'test',
      azureApiKey: provider === 'azure-deepseek' ? 'azure-secret' : '',
    }, undefined, { error: new TypeError('Failed to fetch') }, ['https://test.ts.net/*', 'https://*.openai.azure.com/*']);
    await assert.rejects(worker.context.handleAiRequest({ action: 'professional', text: 'test' }), function (error) {
      assert.match(error.message, provider === 'ornith' ? /Ornith.*test.ts.net.*Tailscale.*MagicDNS/ : /Azure OpenAI.*test.openai.azure.com.*DNS/);
      assert.doesNotMatch(error.message, /local-secret|azure-secret|Failed to fetch/);
      return true;
    });
    assert.equal(worker.calls.length, 1);
  }
});

function createWorker(settings, responseBody, responseOptions, hostPermissions, runtime) {
  const calls = [];
  const performanceLogs = [];
  const localStore = { hpx_settings: Object.assign({}, settings) };
  const sessionStore = {};
  const sandbox = {
    URL: URL,
    console: {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: function (label, details) { performanceLogs.push({ label: label, details: details }); },
    },
    crypto: { randomUUID: function () { return '00000000-0000-4000-8000-000000000000'; } },
    AbortController: AbortController,
    setTimeout: runtime && runtime.setTimeout || setTimeout,
    clearTimeout: runtime && runtime.clearTimeout || clearTimeout,
    fetch: async function (url, options) {
      calls.push({ url: String(url), options: options });
      if (runtime && runtime.fetch) return runtime.fetch(url, options);
       const reply = responseOptions || {};
       if (reply.error) throw reply.error;
       return {
         ok: reply.ok !== undefined ? reply.ok : true,
         status: reply.status || 200,
         json: async function () {
           return responseBody || { choices: [{ message: { content: '- 【資訊】test' }, finish_reason: 'stop' }] };
         },
       };
    },
  };

  sandbox.self = sandbox;
  sandbox.chrome = {
    runtime: {
      lastError: null,
      getURL: function (value) { return 'chrome-extension://test/' + value; },
      getManifest: function () { return { host_permissions: hostPermissions || ['https://*.openai.azure.com/*', 'https://ornith.example.invalid/*'] }; },
      openOptionsPage: function () { return Promise.resolve(); },
      onMessage: eventTarget(),
    },
    action: { onClicked: eventTarget() },
    tabs: {
      onRemoved: eventTarget(),
      create: function (options, callback) { if (callback) callback({ id: 1 }); return Promise.resolve({ id: 1 }); },
      update: function (id, options, callback) { if (callback) callback({ id: id }); return Promise.resolve({ id: id }); },
      remove: function (id, callback) { if (callback) callback(); return Promise.resolve(); },
      sendMessage: function () { return Promise.resolve({ ok: true }); },
    },
    windows: {
      onRemoved: eventTarget(),
      get: function () { return Promise.resolve({ id: 1 }); },
      create: function () { return Promise.resolve({ id: 1, tabs: [{ id: 2 }] }); },
      update: function () { return Promise.resolve(); },
      remove: function () { return Promise.resolve(); },
    },
    storage: {
      local: {
        get: function (keys, callback) {
          let result = {};
          const list = Array.isArray(keys) ? keys : [keys];
          list.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(localStore, key)) result[key] = localStore[key]; });
          callback(result);
        },
        set: function (patch, callback) { Object.assign(localStore, patch); if (callback) callback(); },
        remove: function (key, callback) { delete localStore[key]; if (callback) callback(); },
      },
      session: {
        get: async function (key) { return { [key]: sessionStore[key] }; },
        set: async function (patch) { Object.assign(sessionStore, patch); },
        remove: async function (key) { delete sessionStore[key]; },
      },
    },
  };

  const context = vm.createContext(sandbox);
  sandbox.importScripts = function () {
    Array.from(arguments).forEach(function (resource) {
      const filename = path.join(ROOT, String(resource).replace(/^\//, ''));
      vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename: filename });
    });
  };
  const workerPath = path.join(ROOT, 'src/background/service-worker.js');
  vm.runInContext(fs.readFileSync(workerPath, 'utf8'), context, { filename: workerPath });
  return { context: context, calls: calls, store: localStore, performanceLogs: performanceLogs };
}

test('Ornith uses only the OpenAI-compatible local endpoint', async function () {
  const worker = createWorker({
    provider: 'ornith',
    ornithBaseUrl: 'https://ornith.example.invalid/v1',
    ornithModel: 'Ornith-1.5-35B-A3B',
    ornithApiKey: 'local-secret',
    azureEndpoint: 'https://unused.openai.azure.com',
    azureDeployment: 'unused',
    azureApiKey: '',
    useStub: false,
  });

  const result = await worker.context.handleAiRequest({ action: 'professional', text: 'test' });
  assert.equal(result.provider, 'ornith');
  assert.equal(worker.calls.length, 1);
  assert.equal(worker.calls[0].url, 'https://ornith.example.invalid/v1/chat/completions');
  assert.equal(worker.calls[0].options.headers.Authorization, 'Bearer local-secret');
  assert.equal(worker.calls[0].options.headers['api-key'], undefined);
  const body = JSON.parse(worker.calls[0].options.body);
  assert.equal(body.model, 'Ornith-1.5-35B-A3B');
  assert.equal(body.temperature, 0.1);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.n, 1);
  assert.equal(body.stream, false);
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.match(body.messages[0].content, /^\/no_think\n/);
  assert.equal(body.messages[1].role, 'user');
  assert.match(body.messages[1].content, /【原始內容開始】\ntest\n【原始內容結束】$/);
});

test('Ornith routes to a configured HTTPS host only when its exact origin is permitted', async function () {
  const worker = createWorker({
    provider: 'ornith', ornithBaseUrl: 'https://ai.example.com/v1/',
    ornithModel: 'test-model', ornithApiKey: 'local-secret', azureApiKey: '',
  }, undefined, undefined, ['https://*.openai.azure.com/*', 'https://ai.example.com/*']);
  await vm.runInContext("handleAiRequest({ action: 'professional', text: 'test' })", worker.context);
  assert.equal(worker.calls.length, 1);
  assert.equal(worker.calls[0].url, 'https://ai.example.com/v1/chat/completions');
});

test('Ornith rejects unpermitted hosts and unsafe URL components before sending credentials', async function () {
  const invalidUrls = [
    'https://unconfigured.example.com/v1',
    'http://ornith.example.invalid/v1',
    'https://ornith.example.invalid/other',
    'https://user:pass@ornith.example.invalid/v1',
    'https://ornith.example.invalid/v1?token=example',
    'https://ornith.example.invalid/v1#fragment',
  ];
  for (const url of invalidUrls) {
    const worker = createWorker({
      provider: 'ornith', ornithBaseUrl: url,
      ornithModel: 'test-model', ornithApiKey: 'local-secret', azureApiKey: '',
    });
    await assert.rejects(vm.runInContext("handleAiRequest({ action: 'professional', text: 'test' })", worker.context));
    assert.equal(worker.calls.length, 0, url);
  }
});

test('Azure keeps its existing deployment URL and api-key authentication', async function () {
  const worker = createWorker({
    provider: 'azure-deepseek',
    azureEndpoint: 'https://company.openai.azure.com',
    azureDeployment: 'deepseek',
    azureApiKey: 'azure-secret',
    ornithApiKey: '',
    useStub: false,
  });

  const result = await worker.context.handleAiRequest({ action: 'professional', text: 'test' });
  assert.equal(result.provider, 'azure-deepseek');
  assert.equal(worker.calls.length, 1);
  assert.match(worker.calls[0].url, /^https:\/\/company\.openai\.azure\.com\/openai\/deployments\/deepseek\/chat\/completions\?api-version=/);
  assert.equal(worker.calls[0].options.headers['api-key'], 'azure-secret');
  assert.equal(worker.calls[0].options.headers.Authorization, undefined);
  const body = JSON.parse(worker.calls[0].options.body);
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'temperature']);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.temperature, 0.4);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.chat_template_kwargs, undefined);
});

test('a saved Azure key blocks Ornith selection before any request', async function () {
  const worker = createWorker({
    provider: 'ornith',
    ornithApiKey: '',
    azureEndpoint: 'https://company.openai.azure.com',
    azureDeployment: 'deepseek',
    azureApiKey: 'azure-secret',
    useStub: false,
  });

  await assert.rejects(
    worker.context.handleAiRequest({ action: 'professional', text: 'test' }),
    /Azure OpenAI 已設定/
  );
  assert.equal(worker.calls.length, 0);
});

test('a saved Ornith key blocks Azure selection before any request', async function () {
  const worker = createWorker({
    provider: 'azure-deepseek',
    ornithBaseUrl: 'https://ornith.example.invalid/v1',
    ornithModel: 'Ornith-1.5-35B-A3B',
    ornithApiKey: 'local-secret',
    azureApiKey: '',
    useStub: false,
  });

  await assert.rejects(
    worker.context.handleAiRequest({ action: 'professional', text: 'test' }),
    /Ornith 已設定/
  );
  assert.equal(worker.calls.length, 0);
});

test('two saved keys are rejected before either provider can be called', async function () {
  const worker = createWorker({
    provider: 'ornith',
    ornithApiKey: 'local-secret',
    azureApiKey: 'azure-secret',
    useStub: false,
  });

  await assert.rejects(
    worker.context.handleAiRequest({ action: 'professional', text: 'test' }),
    /不可同時保存 API Key/
  );
  assert.equal(worker.calls.length, 0);
});

test('unknown AI actions are rejected before any provider request', async function () {
  const worker = createWorker({
    provider: 'ornith',
    ornithBaseUrl: 'https://ornith.example.invalid/v1',
    ornithModel: 'Ornith-1.5-35B-A3B',
    ornithApiKey: 'local-secret',
    azureApiKey: '',
  });
  await assert.rejects(
    worker.context.handleAiRequest({ action: 'unknown', text: 'sensitive text' }),
    /不支援的 AI 功能/
  );
  assert.equal(worker.calls.length, 0);
});

test('provider survives a fresh worker load from persisted storage', async function () {
  const worker = createWorker({
    provider: 'ornith',
    ornithBaseUrl: 'https://ornith.example.invalid/v1',
    ornithModel: 'Ornith-1.5-35B-A3B',
    ornithApiKey: 'local-secret',
    azureApiKey: '',
    useStub: false,
  });

  const loaded = await worker.context.getSettings();
  assert.equal(loaded.provider, 'ornith');
  const ping = await worker.context.handleAiPing();
  assert.equal(ping.provider, 'ornith');
  assert.equal(worker.calls.length, 1);
});

test('settings page exposes exactly the two requested radio providers', function () {
  const html = fs.readFileSync(path.join(ROOT, 'src/options/options.html'), 'utf8');
  const providerValues = Array.from(html.matchAll(/name="provider"[^>]*value="([^"]+)"/g)).map(function (match) { return match[1]; });
  assert.deepEqual(providerValues.sort(), ['azure-deepseek', 'ornith']);
  assert.doesNotMatch(html, /value="gemini"/i);
  assert.match(html, /id="ornithSection" class="provider-section is-disabled"/);
  assert.match(html, /id="azureSection" class="provider-section is-disabled"/);
  assert.ok(html.indexOf('../ai/provider-settings.js') < html.indexOf('options.js'));
});

test('Ornith rejects unsupported thinking control without retry or Azure fallback', async function () {
  const worker = createWorker({
    provider: 'ornith',
    ornithBaseUrl: 'https://ornith.example.invalid/v1',
    ornithModel: 'Ornith-1.5-35B-A3B',
    ornithApiKey: 'local-secret',
    azureApiKey: '',
  }, {
    error: { message: 'Unknown field chat_template_kwargs' },
  }, { ok: false, status: 400 });

  await assert.rejects(
    worker.context.handleAiRequest({ action: 'professional', text: 'test' }),
    /不支援必要的 chat_template_kwargs\.enable_thinking=false.*不會改呼叫 Azure/
  );
  assert.equal(worker.calls.length, 1);
});

test('finish_reason length is rejected and never returned as usable text', async function () {
  const worker = createWorker({
    provider: 'ornith',
    ornithBaseUrl: 'https://ornith.example.invalid/v1',
    ornithModel: 'Ornith-1.5-35B-A3B',
    ornithApiKey: 'local-secret',
    azureApiKey: '',
  }, {
    choices: [{ message: { content: '- 【資訊】test' }, finish_reason: 'length' }],
    usage: { prompt_tokens: 10, completion_tokens: 4096 },
  });

  await assert.rejects(
    worker.context.handleAiRequest({ action: 'professional', text: 'test' }),
    /輸出長度上限.*截斷結果未套用/
  );
  assert.equal(worker.calls.length, 1);
});

test('reasoning-only response returns an explicit error', async function () {
  const worker = createWorker({
    provider: 'ornith',
    ornithBaseUrl: 'https://ornith.example.invalid/v1',
    ornithModel: 'Ornith-1.5-35B-A3B',
    ornithApiKey: 'local-secret',
    azureApiKey: '',
  }, {
    choices: [{ message: { content: '', reasoning_content: 'hidden work' }, finish_reason: 'stop' }],
  });

  await assert.rejects(
    worker.context.handleAiRequest({ action: 'professional', text: 'test' }),
    /只有 reasoning_content、沒有正式 content/
  );
  assert.equal(worker.calls.length, 1);
});

test('safe performance record contains usage but no request text or credentials', async function () {
  const worker = createWorker({
    provider: 'ornith',
    ornithBaseUrl: 'https://ornith.example.invalid/v1',
    ornithModel: 'Ornith-1.5-35B-A3B',
    ornithApiKey: 'local-secret',
    azureApiKey: '',
  }, {
    choices: [{ message: { content: '- 【資訊】test' }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 12,
      completion_tokens_details: { reasoning_tokens: 2 },
    },
  });

  await worker.context.handleAiRequest({ action: 'professional', text: 'test' });
  assert.equal(worker.performanceLogs.length, 1);
  const serialized = JSON.stringify(worker.performanceLogs[0]);
  assert.match(serialized, /"promptTokens":20/);
  assert.match(serialized, /"completionTokens":12/);
  assert.match(serialized, /"reasoningTokens":2/);
  assert.doesNotMatch(serialized, /local-secret/);
  assert.doesNotMatch(serialized, /chat_template_kwargs/);
  assert.doesNotMatch(serialized, /【原始內容開始】/);
});

test('missing provider reasoning usage is recorded as unavailable, not a fabricated zero', async function () {
  const worker = createWorker({
    provider: 'ornith',
    ornithBaseUrl: 'https://ornith.example.invalid/v1',
    ornithModel: 'Ornith-1.5-35B-A3B',
    ornithApiKey: 'local-secret',
    azureApiKey: '',
  }, {
    choices: [{ message: { content: '- 【資訊】test' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 12 },
  });

  await worker.context.handleAiRequest({ action: 'professional', text: 'test' });
  assert.equal(worker.performanceLogs[0].details.reasoningTokens, null);
});

test('request returns per-request metrics and missing usage stays unavailable', async function () {
  const worker = createWorker({ provider: 'ornith', ornithBaseUrl: 'https://ornith.example.invalid/v1', ornithModel: 'Ornith-1.5-35B-A3B', ornithApiKey: 'local-secret', azureApiKey: '' });
  const result = await worker.context.handleAiRequest({ action: 'professional', text: 'test' });
  assert.equal(result.metrics.completionTokens, null);
  assert.equal(result.metrics.effectiveOutputTokensPerSecond, null);
  assert.ok(result.metrics.elapsedMs >= 0);
  const metrics = worker.context.usageMetrics({ usage: { completion_tokens: 120, completion_tokens_details: { reasoning_tokens: 20 } } }, 2000, 'test');
  assert.equal(metrics.effectiveOutputTokensPerSecond, 50);
  assert.equal(metrics.reasoningTokens, 20);
});


test('configured Azure API version is used for connection tests and drafts', async function () {
  const worker = createWorker({ provider: 'azure-deepseek', azureEndpoint: 'https://test.openai.azure.com', azureDeployment: 'custom', azureApiKey: 'test', azureApiVersion: 'custom-version' });
  await worker.context.handleAiPing();
  await worker.context.handleAiRequest({ action: 'professional', text: 'test' });
  assert.equal(worker.calls.length, 2);
  for (const call of worker.calls) assert.equal(new URL(call.url).searchParams.get('api-version'), 'custom-version');
});

test('Azure short non-thinking drafts reserve less output without changing the prompt or source', async function () {
  const settings = { provider: 'azure-deepseek', azureEndpoint: 'https://test.openai.azure.com',
    azureDeployment: 'custom', azureApiKey: 'test', azureThinkingMode: 'disabled' };
  const worker = createWorker(settings);
  const source = '0.跟窗口確認需求\n1.建立好F42群組\n2.加入F00、F37群組';
  // Use a fixture retaining all technical values so preview validation is exercised.
  const complete = createWorker(settings, { choices: [{ finish_reason: 'stop', message: {
    content: '- 【處理動作】跟窗口確認需求\n- 【設定】建立 F42 群組\n- 【設定】加入 F00、F37 群組',
  } }] });
  const result = await complete.context.handleAiRequest({ action: 'professional', text: source });
  const body = JSON.parse(complete.calls[0].options.body);
  assert.equal(body.max_tokens, 768);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  const prompts = require('../src/ai/prompt-templates.js');
  assert.equal(body.messages[0].content, prompts.buildPrompt('professional', source));
  assert.equal(result.metrics.requestMaxTokens, 768);
  assert.equal(result.metrics.requestedThinkingMode, 'disabled');
  assert.ok(result.metrics.responseHeadersMs >= 0);
  assert.ok(result.metrics.responseBodyMs >= 0);
  assert.equal(complete.calls.length, 1);
  await worker.context.handleAiPing();
  assert.equal(JSON.parse(worker.calls[0].options.body).max_tokens, 32);
});

test('Azure output allowance grows for longer source and leaves reasoning defaults unchanged', function () {
  const { HPX_AI_SETTINGS: settings } = require('../src/ai/provider-settings.js');
  const disabled = { azureThinkingMode: 'disabled' };
  for (const action of ['professional', 'improve_tone', 'first_contact', 'translate']) {
    assert.equal(settings.azureOutputBudget(disabled, { action, text: '短文' }), 768);
    assert.ok(settings.azureOutputBudget(disabled, { action, text: '測'.repeat(500) }) > 768);
    assert.equal(settings.azureOutputBudget(disabled, { action, text: '測'.repeat(3000) }), 4096);
    assert.equal(settings.azureOutputBudget({}, { action, text: '短文' }), 4096);
  }
  assert.equal(settings.azureOutputBudget(disabled), 4096);
  assert.equal(settings.azureOutputBudget(disabled, { action: 'professional' }), 4096);
});

test('Azure rejects a truncated adaptive-budget response without retrying or applying it', async function () {
  const worker = createWorker({ provider: 'azure-deepseek', azureEndpoint: 'https://test.openai.azure.com',
    azureDeployment: 'custom', azureApiKey: 'test', azureThinkingMode: 'disabled' },
  { choices: [{ finish_reason: 'length', message: { content: '- 【資訊】partial' } }] });
  await assert.rejects(worker.context.handleAiRequest({ action: 'professional', text: 'test' }), /截斷結果未套用/);
  assert.equal(worker.calls.length, 1);
});

for (const phase of ['headers', 'body']) {
  test('Azure aborts a stalled ' + phase + ' response and clears the deadline without retrying', async function () {
    let expire;
    let duration;
    let cleared = false;
    let signal;
    const hanging = activeSignal => new Promise((resolve, reject) => {
      activeSignal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const worker = createWorker({ provider: 'azure-deepseek', azureEndpoint: 'https://test.openai.azure.com',
      azureDeployment: 'custom', azureApiKey: 'test', azureThinkingMode: 'disabled' },
    undefined, undefined, undefined, {
      setTimeout: (callback, ms) => { expire = callback; duration = ms; return 123; },
      clearTimeout: id => { assert.equal(id, 123); cleared = true; },
      fetch: async (url, options) => {
        signal = options.signal;
        if (phase === 'headers') return hanging(signal);
        return { ok: true, status: 200, json: () => hanging(signal) };
      },
    });
    const pending = worker.context.handleAiRequest({ action: 'professional', text: 'test' });
    // Allow settings/fetch/body promises to attach their abort listener.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(duration, 120000);
    expire();
    await assert.rejects(pending, /Azure OpenAI.*120 秒.*已中止.*未自動重送/);
    assert.equal(signal.aborted, true);
    assert.equal(cleared, true);
    assert.equal(worker.calls.length, 1);
  });
}

test('Azure clears its deadline on a successful response', async function () {
  let cleared = false;
  const worker = createWorker({ provider: 'azure-deepseek', azureEndpoint: 'https://test.openai.azure.com',
    azureDeployment: 'custom', azureApiKey: 'test' }, undefined, undefined, undefined,
  { setTimeout: () => 123, clearTimeout: id => { assert.equal(id, 123); cleared = true; } });
  const result = await worker.context.handleAiPing();
  assert.equal(result.ok, true);
  assert.ok(result.metrics.elapsedMs >= 0);
  assert.equal(cleared, true);
  assert.equal(worker.calls[0].options.signal.aborted, false);
});
