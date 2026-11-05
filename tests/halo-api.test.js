'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/background/halo-api.js'), 'utf8');
const config = { enabled: true, baseUrl: 'https://example.halopsa.com/api', webOrigin: 'https://example.halopsa.com', authMode: 'bearer', apiKey: 'private-test-key', closeStatusId: 9, closeActionId: 42 };
const admin = { id: 'extension', url: 'chrome-extension://extension/src/options/options.html#halo' };
const tab = { id: 'extension', url: 'https://example.halopsa.com/tickets?id=123', frameId: 0, tab: { id: 7 } };
function fixture(options = {}) {
  const store = { hpx_halo_api: { ...config, ...options.config } };
  const calls = [];
  let status = 1;
  const response = data => ({ ok: true, status: 200, json: async () => data });
  const sandbox = { URL, URLSearchParams, AbortController, setTimeout, clearTimeout, TypeError,
    chrome: {
      runtime: { id: 'extension', getURL: p => 'chrome-extension://extension/' + p },
      permissions: { contains: async () => options.permission !== false },
      tabs: { get: async () => ({ url: options.currentTabUrl || tab.url }) },
      storage: { local: { get: async key => ({ [key]: store[key] }), set: async patch => Object.assign(store, patch), remove: async key => { delete store[key]; } } },
    },
    fetch: async (url, init) => {
      calls.push({ url, ...init });
      const custom = options.fetch && await options.fetch(url, init, calls);
      if (custom) return custom;
      if (url.includes('/token')) return response({ access_token: 'oauth-token', expires_in: 3600 });
      if (url.endsWith('/Status')) return response([{ id: 1, name: 'Open' }, { id: 2, name: 'On Hold' }, { id: 9, name: 'Closed' }]);
      if (url.endsWith('/Tickets/123')) return response({ id: 123, status_id: status, summary: 'Example' });
      if (init.method === 'POST') {
        const row = JSON.parse(init.body)[0];
        if (row.status_id) status = row.status_id;
        if (row.new_status) status = row.new_status;
        return response([{ id: row.id || 456 }]);
      }
      throw new Error('Unexpected URL: ' + url);
    },
  };
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox);
  return { calls, store, response, api: sandbox.HPX_HALO_API,
    run: (operation, payload = {}, sender = admin) => sandbox.HPX_HALO_API.handle({ operation, payload }, sender) };
}
const statusPayload = { ticketId: 123, expectedStatusId: 1, statusId: 2 };
const createPayload = { summary: 'New case', details: 'Problem', clientId: 3, siteId: 4, userId: 5, ticketTypeId: 6 };

test('status writes one array payload then reads back the actual saved status', async () => {
  const f = fixture(); const result = await f.run('status', statusPayload, tab);
  assert.equal(result.ticket.statusId, 2);
  const writes = f.calls.filter(call => call.method === 'POST');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].body), [{ id: 123, status_id: 2 }]);
  assert.equal(writes[0].headers.Authorization, 'Bearer private-test-key');
  assert.equal(writes[0].redirect, 'error'); assert.equal(writes[0].credentials, 'omit');
  assert.equal(f.calls.at(-1).url, config.baseUrl + '/Tickets/123');
  assert.ok(!JSON.stringify(result).includes('private-test-key'));
});
test('close uses the configured action, status and supplied resolution note', async () => {
  const f = fixture(); const result = await f.run('close', { ...statusPayload, note: 'Resolved with customer' }, tab);
  assert.equal(result.ticket.statusId, 9);
  const writes = f.calls.filter(call => call.method === 'POST');
  assert.equal(writes.length, 1); assert.ok(writes[0].url.endsWith('/Actions'));
  assert.deepEqual(JSON.parse(writes[0].body), [{ ticket_id: 123, outcome_id: 42, new_status: 9, note: 'Resolved with customer' }]);
});
test('close requires configured action and a resolution note; normal update cannot use designated closed status', async () => {
  for (const [f, op, payload] of [
    [fixture(), 'close', statusPayload],
    [fixture({ config: { closeActionId: null } }), 'close', { ...statusPayload, note: 'Done' }],
    [fixture(), 'status', { ...statusPayload, statusId: 9 }],
  ]) {
    await assert.rejects(f.run(op, payload));
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  }
});
test('create sends only supported fields and returns the actual created ID', async () => {
  const f = fixture(); const result = await f.run('create', { ...createPayload, id: 999, url: 'https://attacker.invalid', sendemail: true });
  assert.equal(result.ticket.id, 456); assert.equal(result.url, 'https://example.halopsa.com/tickets?id=456');
  assert.deepEqual(JSON.parse(f.calls[0].body), [{ summary: 'New case', details: 'Problem', client_id: 3, site_id: 4, user_id: 5, tickettype_id: 6 }]);
});
test('invalid IDs, missing create details and stale status are rejected before writes', async () => {
  for (const [op, payload] of [['status', { ...statusPayload, ticketId: '../123' }], ['status', { ...statusPayload, expectedStatusId: 2 }], ['status', { ...statusPayload, statusId: 99 }], ['create', { ...createPayload, details: '' }], ['create', { ...createPayload, userId: -1 }]]) {
    const f = fixture(); await assert.rejects(f.run(op, payload));
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  }
});
test('cross-tenant, child-frame, wrong-tab and content configuration/create calls are rejected', async () => {
  for (const [op, payload, sender] of [
    ['status', statusPayload, { ...tab, url: 'https://other.halopsa.com/tickets?id=123' }],
    ['status', statusPayload, { ...tab, frameId: 1 }],
    ['status', statusPayload, { ...tab, url: 'https://example.halopsa.com/tickets?id=124' }],
    ['config.get', {}, tab], ['config.save', config, tab], ['config.clear', {}, tab], ['create', createPayload, tab],
  ]) { const f = fixture(); await assert.rejects(f.run(op, payload, sender)); assert.equal(f.calls.length, 0); }
});
test('disabled configuration and revoked host permission cannot write', async () => {
  for (const f of [fixture({ config: { enabled: false } }), fixture({ permission: false })]) {
    await assert.rejects(f.run('status', statusPayload)); assert.equal(f.calls.length, 0);
  }
});
test('navigation during preflight prevents the final write even with a valid original sender', async () => {
  const f = fixture({ currentTabUrl: 'https://example.halopsa.com/tickets?id=124' });
  await assert.rejects(f.run('status', statusPayload, tab), /頁面已切換/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});
test('config is kept separately from exported AI settings and only admin can retrieve secrets', async () => {
  const f = fixture(); f.store.hpx_settings = { azureApiKey: 'ai-key' };
  await f.run('config.save', config);
  assert.deepEqual(f.store.hpx_settings, { azureApiKey: 'ai-key' });
  const available = await f.run('available', {}, tab);
  assert.deepEqual(JSON.parse(JSON.stringify(available)), { ok: true, enabled: true });
  await f.run('config.clear'); assert.equal(f.store.hpx_halo_api, undefined);
});
test('unsafe URLs never send credentials and permission denial prevents config save', async () => {
  for (const url of ['http://example.com/api', 'https://user:pass@example.com/api', 'https://example.com/api?key=x', 'https://example.com/api#x']) {
    const f = fixture(); await assert.rejects(f.run('config.save', { ...config, baseUrl: url })); assert.equal(f.calls.length, 0);
  }
  const f = fixture({ permission: false }); await assert.rejects(f.run('config.save', { ...config, apiKey: 'new' }));
  assert.equal(f.store.hpx_halo_api.apiKey, config.apiKey);
});
test('different web and API hosts are both included in the explicit permission set', () => {
  const f = fixture();
  const normalized = f.api.normalize({ ...config, webOrigin: 'https://support.example.com' });
  assert.deepEqual(Array.from(f.api.origins(normalized)), ['https://example.halopsa.com/*', 'https://support.example.com/*']);
});
test('OAuth obtains and reuses token with tenant query and form-encoded client credentials', async () => {
  const f = fixture({ config: { authMode: 'oauth', authUrl: 'https://auth.example.com/auth', tenant: 'tenant a', clientId: 'client', clientSecret: 'secret' } });
  await f.run('test'); await f.run('test');
  const tokens = f.calls.filter(call => call.url.includes('/token'));
  assert.equal(tokens.length, 1); assert.match(tokens[0].url, /tenant=tenant\+a/);
  assert.equal(new URLSearchParams(tokens[0].body).get('grant_type'), 'client_credentials');
  assert.equal(new URLSearchParams(tokens[0].body).get('client_secret'), 'secret');
  assert.equal(f.calls.at(-1).headers.Authorization, 'Bearer oauth-token');
});
test('explicit header-key mode sends no bearer header', async () => {
  const f = fixture({ config: { authMode: 'apikey' } }); await f.run('test');
  assert.equal(f.calls[0].headers['X-API-Key'], config.apiKey); assert.equal(f.calls[0].headers.Authorization, undefined);
});

test('saved native Halo key uses X-Halo-Api-Key for test, create, status and close', async () => {
  for (const [op, payload] of [['test', {}], ['create', createPayload], ['status', statusPayload], ['close', { ...statusPayload, note: 'Resolved' }]]) {
    const f = fixture();
    await f.run('config.save', { ...config, authMode: 'haloapikey' });
    assert.equal((await f.run('config.get')).config.authMode, 'haloapikey');
    await f.run(op, payload);
    assert.ok(f.calls.length > 0);
    for (const call of f.calls) {
      assert.equal(call.headers['X-Halo-Api-Key'], config.apiKey);
      assert.equal(call.headers['X-API-Key'], undefined);
      assert.equal(call.headers.Authorization, undefined);
    }
  }
});

test('Bearer token prefix is not duplicated', async () => {
  const f = fixture({ config: { apiKey: ' Bearer private-test-key ' } });
  await f.run('test');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer private-test-key');
});

test('401 identifies the actual auth scheme without secrets or automatic fallback', async () => {
  for (const [mode, label] of [['haloapikey', 'X-Halo-Api-Key'], ['apikey', 'X-API-Key'], ['bearer', 'Authorization: Bearer'], ['oauth', 'OAuth Client ID / Secret']]) {
    const f = fixture({ config: { authMode: mode, authUrl: 'https://auth.example.com/auth', clientId: 'client', clientSecret: 'secret' },
      fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: config.apiKey }) }) });
    await assert.rejects(f.run('test'), error => error.message.includes('401') && error.message.includes(label) && !error.message.includes(config.apiKey));
    assert.equal(f.calls.length, 1);
  }
});
test('HTTP and application-level errors never echo response secrets or retry a POST', async () => {
  for (const errorResponse of [
    { ok: false, status: 403, json: async () => ({ error: 'private-test-key' }) },
    { ok: true, status: 200, json: async () => [{ _warning: 'private-test-key' }] },
  ]) {
    const f = fixture({ fetch: async (_, init) => init.method === 'POST' && errorResponse });
    await assert.rejects(f.run('status', statusPayload), error => !error.message.includes(config.apiKey));
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  }
});
test('unknown network outcome is reported without retry', async () => {
  const f = fixture({ fetch: async (_, init) => { if (init.method === 'POST') throw new TypeError('private-test-key'); } });
  await assert.rejects(f.run('create', createPayload), /寫入結果尚未確認/);
  assert.equal(f.calls.length, 1);
});
test('unverified status after accepted write cannot produce success', async () => {
  const f = fixture({ fetch: async (url, init) => init.method === 'POST' && { ok: true, status: 200, json: async () => [{ id: 123 }] } });
  await assert.rejects(f.run('status', statusPayload), /尚未確認目標狀態/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});
test('concurrent double submission writes only once', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ fetch: async (_, init) => { if (init.method === 'POST') await gate; } });
  const first = f.run('create', createPayload);
  await new Promise(setImmediate);
  await assert.rejects(f.run('create', createPayload), /正在送出/);
  release(); await first;
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});
