/** Halo writes run only in the extension worker. Never accepts an arbitrary URL or body from a tab. */
(function (root) {
  'use strict';
  const KEY = 'hpx_halo_api';
  const jobs = new Set();
  let cachedToken = null;
  const text = value => String(value == null ? '' : value).trim();
  function id(value, label) {
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error(label + ' 必須是正整數。');
    return Number(value);
  }
  function https(value, label) {
    let url;
    try { url = new URL(text(value)); } catch (_) { throw new Error('請填入有效的 ' + label + '。'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(label + ' 必須使用 HTTPS，且不可包含帳密、查詢參數或 #。');
    return url.href.replace(/\/+$/, '');
  }
  function normalize(raw) {
    const baseUrl = https(raw.baseUrl, 'Resource Server URL');
    const authMode = ['haloapikey', 'bearer', 'apikey', 'oauth'].includes(raw.authMode) ? raw.authMode : 'haloapikey';
    const config = { enabled: raw.enabled === true, baseUrl, authMode,
      webOrigin: new URL(https(raw.webOrigin || new URL(baseUrl).origin, 'Halo 網頁網址')).origin,
      apiKey: text(raw.apiKey), clientId: text(raw.clientId), clientSecret: text(raw.clientSecret),
      authUrl: authMode === 'oauth' ? https(raw.authUrl, 'Authorisation Server URL') : '', tenant: text(raw.tenant),
      closeStatusId: raw.closeStatusId ? id(raw.closeStatusId, '結案狀態 ID') : null,
      closeActionId: raw.closeActionId ? id(raw.closeActionId, '結案 Action ID') : null };
    if (authMode === 'oauth' ? !config.clientId || !config.clientSecret : !config.apiKey) throw new Error('請填入所選驗證方式的憑證。');
    if (/[\r\n]/.test(config.apiKey)) throw new Error('API Key 不可包含換行。');
    return config;
  }
  function origins(config) {
    return [...new Set([config.baseUrl, config.authUrl, config.webOrigin].filter(Boolean).map(value => new URL(value).origin + '/*'))];
  }
  function isAdmin(sender) {
    try { return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('src/options/options.html') + new URL(sender.url).hash; }
    catch (_) { return false; }
  }
  function authorize(sender, config) {
    if (isAdmin(sender)) return;
    if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || new URL(sender.url).origin !== config.webOrigin) throw new Error('此頁面不屬於已設定的 Halo 站台。');
  }
  async function checkCurrentTab(sender, config, ticketId) {
    if (isAdmin(sender)) return;
    let url;
    try { url = new URL((await chrome.tabs.get(sender.tab.id)).url); }
    catch (_) { throw new Error('無法確認目前工單頁面，已停止送出。'); }
    const value = url.searchParams.get('id');
    if (url.origin !== config.webOrigin || !/^\d+$/.test(value || '') || Number(value) !== ticketId) throw new Error('工單頁面已切換，已停止送出。');
  }
  async function request(url, init, write, authLabel) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
      if (!response.ok) {
        const labels = { 400: '請檢查必填欄位、狀態與工單類型規則', 401: '驗證未通過（本次使用 ' + authLabel + '）；請核對 API 位址、驗證方式與憑證有效期限', 403: 'API 帳號或應用程式權限不足', 404: '網址或工單不存在', 429: '請求過於頻繁，請稍後再試' };
        throw new Error('Halo API HTTP ' + response.status + '：' + (labels[response.status] || '伺服器未完成請求') + (write ? '。請先檢查工單結果，系統不會自動重送。' : '。'));
      }
      let data;
      try { data = await response.json(); } catch (_) { throw new Error(write ? 'Halo 回覆無法辨識；請先檢查工單結果，不要直接重送。' : 'Halo 未回傳 JSON，請確認 Resource Server URL（通常以 /api 結尾）。'); }
      const rows = Array.isArray(data) ? data : [data];
      if (rows.some(row => row && (row.error || row.errors || row._warning))) throw new Error('Halo 回覆錯誤或警告，請在原生工單檢查必填資料與操作結果。系統不會自動重送。');
      return data;
    } catch (error) {
      if (error instanceof TypeError || error.name === 'AbortError') throw new Error(write ? '連線中斷或逾時，寫入結果尚未確認。請先查看工單，系統不會自動重送。' : '無法連線至 Halo，請檢查網址、網路與主機存取權限。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function headers(config) {
    // Halo's native static-key header includes "Halo"; generic gateway keys are a separate mode.
    if (config.authMode === 'haloapikey') return { 'X-Halo-Api-Key': config.apiKey };
    if (config.authMode === 'apikey') return { 'X-API-Key': config.apiKey };
    if (config.authMode !== 'oauth') return { Authorization: 'Bearer ' + config.apiKey.replace(/^Bearer\s+/i, '') };
    const fingerprint = JSON.stringify([config.authUrl, config.tenant, config.clientId, config.clientSecret]);
    if (!cachedToken || cachedToken.fingerprint !== fingerprint || cachedToken.until <= Date.now()) {
      const url = new URL(config.authUrl.replace(/\/token$/i, '') + '/token');
      if (config.tenant) url.searchParams.set('tenant', config.tenant);
      const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret, scope: 'all' });
      const data = await request(url.href, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, false, 'OAuth Client ID / Secret，取得 Token');
      if (!text(data.access_token)) throw new Error('Halo 授權伺服器未回傳 Access Token。');
      cachedToken = { fingerprint, token: data.access_token, until: Date.now() + Math.max(0, (Number(data.expires_in) || 3600) - 60) * 1000 };
    }
    return { Authorization: 'Bearer ' + cachedToken.token };
  }
  async function api(config, path, body) {
    const auth = await headers(config);
    const authLabel = config.authMode === 'haloapikey' ? 'X-Halo-Api-Key' : config.authMode === 'apikey' ? 'X-API-Key' : 'Authorization: Bearer';
    return request(config.baseUrl + '/' + path, { method: body ? 'POST' : 'GET', headers: { ...auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, !!body, authLabel);
  }
  function rows(data, key) {
    const list = Array.isArray(data) ? data : data && data[key];
    if (!Array.isArray(list)) throw new Error('Halo 回覆格式不符預期，請檢查 API 網址與版本。');
    return list;
  }
  async function statuses(config) {
    return rows(await api(config, 'Status'), 'statuses').filter(row => row && Number(row.id) > 0 && row.name && !row.inactive).map(row => ({ id: Number(row.id), name: text(row.name) }));
  }
  async function ticket(config, ticketId) {
    const data = await api(config, 'Tickets/' + ticketId);
    if (!data || Number(data.id) !== ticketId) throw new Error('Halo 回傳的工單編號不符，已停止。');
    return { id: ticketId, summary: text(data.summary), statusId: Number(data.status_id), statusName: text(data.status_name) };
  }
  async function handle(message, sender) {
    const op = message.operation;
    const payload = message.payload || {};
    const admin = isAdmin(sender);
    if (op === 'config.get' || op === 'config.save' || op === 'config.clear') {
      if (!admin) throw new Error('連線設定只能從擴充功能後台管理。');
      if (op === 'config.get') return { ok: true, config: (await chrome.storage.local.get(KEY))[KEY] || {} };
      if (op === 'config.clear') { await chrome.storage.local.remove(KEY); cachedToken = null; return { ok: true }; }
      const config = normalize(payload);
      if (!await chrome.permissions.contains({ origins: origins(config) })) throw new Error('尚未授予 Halo 主機存取權限，請重新儲存並允許存取。');
      await chrome.storage.local.set({ [KEY]: config });
      cachedToken = null;
      return { ok: true };
    }
    const stored = (await chrome.storage.local.get(KEY))[KEY];
    if (op === 'available') {
      if (!stored || !stored.enabled) return { ok: true, enabled: false };
      authorize(sender, stored);
      return { ok: true, enabled: true };
    }
    if (!stored) throw new Error('請先到後台設定 Halo API 連線。');
    const config = normalize(stored);
    authorize(sender, config);
    if (!config.enabled && !admin) throw new Error('Halo API 直接操作尚未啟用。');
    if (!await chrome.permissions.contains({ origins: origins(config) })) throw new Error('Halo 主機存取權限已移除，請到後台重新儲存設定。');
    if (op === 'statuses' || op === 'test') return { ok: true, statuses: await statuses(config) };
    if (op === 'ticket') {
      const ticketId = id(payload.ticketId, '工單 ID');
      return { ok: true, ticket: await ticket(config, ticketId), statuses: await statuses(config), closeStatusId: config.closeStatusId, canClose: !!(config.closeStatusId && config.closeActionId) };
    }
    if (!['create', 'status', 'close'].includes(op)) throw new Error('不支援此 Halo 操作。');
    if (!config.enabled) throw new Error('請先啟用 Halo API 直接操作。');
    const ticketId = op === 'create' ? null : id(payload.ticketId, '工單 ID');
    // A content script may operate only on the ticket represented by its browser URL.
    if (!admin && (op === 'create' || !/^\d+$/.test(new URL(sender.url).searchParams.get('id') || '') || Number(new URL(sender.url).searchParams.get('id')) !== ticketId)) throw new Error('工單頁面已切換，請重新開啟操作選單。');
    const jobKey = config.baseUrl + ':' + (ticketId || 'create');
    if (jobs.has(jobKey)) throw new Error('此操作正在送出，請勿重複提交。');
    jobs.add(jobKey);
    try {
      if (op === 'create') {
        const summary = text(payload.summary);
        const details = text(payload.details);
        if (!summary || summary.length > 255 || !details || details.length > 50000) throw new Error('請填入標題（最多 255 字）與案件內容（最多 50,000 字）。');
        const body = { summary, details, client_id: id(payload.clientId, '客戶 ID'), site_id: id(payload.siteId, '站點 ID'), user_id: id(payload.userId, '聯絡人 ID'), tickettype_id: id(payload.ticketTypeId, '工單類型 ID') };
        if (payload.priorityId) body.priority_id = id(payload.priorityId, '優先級 ID');
        const result = await api(config, 'Tickets', [body]);
        const created = Array.isArray(result) ? result[0] : result;
        if (!created || !Number.isSafeInteger(created.id) || created.id < 1) throw new Error('Halo 未回傳新工單編號；請先查看工單列表，不要直接重送。');
        return { ok: true, ticket: { id: created.id, summary }, url: config.webOrigin + '/tickets?id=' + created.id };
      }
      const before = await ticket(config, ticketId);
      if (before.statusId !== id(payload.expectedStatusId, '原始狀態 ID')) throw new Error('工單狀態已變更，請重新讀取後再操作。');
      const statusId = op === 'close' ? id(config.closeStatusId, '後台結案狀態 ID') : id(payload.statusId, '目標狀態 ID');
      if (!(await statuses(config)).some(row => row.id === statusId)) throw new Error('目標狀態已不存在，請重新載入狀態清單。');
      if (before.statusId === statusId) return { ok: true, ticket: before, unchanged: true };
      await checkCurrentTab(sender, config, ticketId);
      if (op === 'close') {
        const note = text(payload.note);
        if (!note || note.length > 50000) throw new Error('請填入結案說明（最多 50,000 字）。');
        await api(config, 'Actions', [{ ticket_id: ticketId, outcome_id: id(config.closeActionId, '後台結案 Action ID'), new_status: statusId, note }]);
      } else {
        if (config.closeStatusId === statusId) throw new Error('此為結案狀態，請使用「結案」並填寫結案說明。');
        await api(config, 'Tickets', [{ id: ticketId, status_id: statusId }]);
      }
      try {
        const after = await ticket(config, ticketId);
        if (after.statusId !== statusId) throw new Error('status mismatch');
        return { ok: true, ticket: after };
      } catch (_) { throw new Error('API 已接受寫入，但尚未確認目標狀態。請在 Halo 查看結果；系統不會自動重送。'); }
    } finally { jobs.delete(jobKey); }
  }
  root.HPX_HALO_API = { handle, normalize, origins };
})(self);
