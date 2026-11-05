(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fields = { baseUrl: 'haloBaseUrl', webOrigin: 'haloWebOrigin', authMode: 'haloAuthMode', apiKey: 'haloApiKey', authUrl: 'haloAuthUrl', tenant: 'haloTenant', clientId: 'haloClientId', clientSecret: 'haloClientSecret', closeStatusId: 'haloCloseStatusId', closeActionId: 'haloCloseActionId' };
  let saved = false;
  let enabled = false;
  let creating = false;
  async function call(operation, payload) {
    const response = await chrome.runtime.sendMessage({ type: 'HPX_HALO_API', operation, payload });
    if (!response || !response.ok) throw new Error(response && response.error || '背景服務未回應，請重新載入擴充功能。');
    return response;
  }
  function status(id, message, error) { $(id).textContent = message; $(id).className = 'status ' + (error ? 'err' : 'ok'); }
  function authFields() {
    const oauth = $('haloAuthMode').value === 'oauth';
    $('haloKeyFields').hidden = oauth;
    $('haloOauthFields').hidden = !oauth;
  }
  function availability() { $('haloCreateFields').disabled = !saved || !enabled || creating; }
  function collect() {
    const config = { enabled: $('haloEnabled').checked };
    Object.entries(fields).forEach(([key, element]) => { config[key] = $(element).value.trim(); });
    return config;
  }
  function listStatuses(items, selected) {
    const select = $('haloCloseStatusId');
    select.replaceChildren(new Option('未設定結案狀態', ''));
    items.forEach(item => select.add(new Option(item.name + ' (#' + item.id + ')', String(item.id))));
    if (selected && !items.some(item => String(item.id) === String(selected))) select.add(new Option('已設定 ID #' + selected + '（請確認仍有效）', String(selected)));
    select.value = selected ? String(selected) : '';
  }
  $('haloAuthMode').addEventListener('change', authFields);
  $('haloToggleKey').addEventListener('click', () => {
    const showing = $('haloApiKey').type === 'password';
    $('haloApiKey').type = showing ? 'text' : 'password';
    $('haloToggleKey').textContent = showing ? '隱藏' : '顯示';
    $('haloToggleKey').setAttribute('aria-pressed', String(showing));
  });
  $('haloConfigForm').addEventListener('input', () => { saved = false; availability(); status('haloConnectionStatus', '設定尚未儲存。'); });
  $('haloConfigForm').addEventListener('submit', async event => {
    event.preventDefault();
    const config = collect();
    try {
      // Request exact hosts in this user gesture; no wildcard host is granted at install time.
      const urls = [config.baseUrl, ...(config.webOrigin ? [config.webOrigin] : []), ...(config.authMode === 'oauth' ? [config.authUrl] : [])];
      const origins = [...new Set(urls.map(value => {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('請填入不含帳密與參數的 HTTPS 連線網址。');
        return url.origin + '/*';
      }))];
      const grant = chrome.permissions.request({ origins });
      $('haloConfigFields').disabled = true;
      if (!await grant) throw new Error('未允許存取 Halo 主機，設定尚未儲存。');
      await call('config.save', config);
      saved = true; enabled = config.enabled;
      status('haloConnectionStatus', '已儲存。可測試連線取得狀態清單；結案設定變更後請再儲存一次。');
    } catch (error) { status('haloConnectionStatus', error.message, true); }
    finally { $('haloConfigFields').disabled = false; availability(); }
  });
  $('haloTest').addEventListener('click', async () => {
    if (!saved) { status('haloConnectionStatus', '請先儲存連線設定。', true); return; }
    $('haloConfigFields').disabled = true;
    status('haloConnectionStatus', '正在連線…');
    try {
      const result = await call('test');
      listStatuses(result.statuses, $('haloCloseStatusId').value);
      status('haloConnectionStatus', '連線成功，已讀取 ' + result.statuses.length + ' 個狀態。這項測試不會修改工單，寫入權限需於實際操作時驗證。');
    } catch (error) { status('haloConnectionStatus', error.message, true); }
    finally { $('haloConfigFields').disabled = false; }
  });
  $('haloClear').addEventListener('click', async () => {
    $('haloConfigFields').disabled = true;
    try {
      await call('config.clear');
      $('haloConfigForm').reset(); listStatuses([], ''); authFields();
      saved = false; enabled = false; availability();
      status('haloConnectionStatus', '已移除 Halo 連線與憑證，快速改狀態恢復原生流程。');
    } catch (error) { status('haloConnectionStatus', error.message, true); }
    finally { $('haloConfigFields').disabled = false; }
  });
  $('haloCreateForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!saved || !enabled || creating) return;
    const payload = { summary: $('haloSummary').value, details: $('haloDetails').value, clientId: $('haloClient').value, siteId: $('haloSite').value, userId: $('haloUser').value, ticketTypeId: $('haloTicketType').value, priorityId: $('haloPriority').value };
    creating = true; availability(); $('haloCreatedLink').hidden = true;
    status('haloCreateStatus', '正在建立案件，請勿重複送出…');
    try {
      const result = await call('create', payload);
      status('haloCreateStatus', '已建立案件 #' + result.ticket.id + '：' + result.ticket.summary);
      $('haloCreatedLink').href = result.url; $('haloCreatedLink').hidden = false;
      $('haloSummary').value = ''; $('haloDetails').value = '';
    } catch (error) { status('haloCreateStatus', error.message, true); }
    finally { creating = false; availability(); }
  });
  call('config.get').then(result => {
    const config = result.config;
    listStatuses([], config.closeStatusId);
    Object.entries(fields).forEach(([key, element]) => { $(element).value = config[key] || (key === 'authMode' ? 'haloapikey' : ''); });
    $('haloEnabled').checked = config.enabled === true;
    saved = !!config.baseUrl; enabled = config.enabled === true;
    authFields(); availability(); $('haloConfigFields').disabled = false;
  }).catch(error => { status('haloConnectionStatus', error.message, true); });
})();
