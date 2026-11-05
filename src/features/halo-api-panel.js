/** Direct API controls for the ticket shown in the current Halo tab. No credentials enter this module. */
(function () {
  'use strict';
  const NS = window.__HPX;
  let active = null;
  async function call(operation, payload) {
    const result = await chrome.runtime.sendMessage({ type: 'HPX_HALO_API', operation, payload });
    if (!result || !result.ok) throw new Error(result && result.error || '背景服務未回應，請重新載入擴充功能。');
    return result;
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function dismiss() {
    if (!active || active.busy) return;
    const previous = active;
    active = null;
    previous.panel.remove();
    window.removeEventListener('resize', previous.position);
    window.removeEventListener('scroll', previous.position, true);
    previous.trigger.setAttribute('aria-expanded', 'false');
    previous.trigger.setAttribute('aria-controls', 'hpx-quick-status-panel');
    if (previous.trigger.isConnected) previous.trigger.focus();
  }
  async function open(snapshot, trigger, guard) {
    if (active) { dismiss(); return true; }
    const config = await call('available');
    if (!config.enabled) return false;
    if (!guard()) throw new Error('工單已切換，請重新開啟快速改狀態。');
    const panel = element('section', '', 'hpx-quick-status-panel hpx-halo-api-panel');
    panel.id = 'hpx-halo-api-panel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'API 直接改狀態');
    const heading = element('strong', 'API 直接改狀態 · #' + snapshot.id);
    const exit = element('button', '×', 'hpx-quick-status-close');
    exit.type = 'button'; exit.setAttribute('aria-label', '關閉 API 操作'); exit.addEventListener('click', dismiss);
    const hint = element('p', '直接儲存至 Halo。結案會執行後台設定的結案動作。');
    const current = element('p', '讀取工單中…');
    const statusLabel = element('label', '目標狀態'); statusLabel.htmlFor = 'hpx-api-status';
    const select = element('select'); select.id = 'hpx-api-status'; select.disabled = true;
    const noteLabel = element('label', '結案說明'); noteLabel.htmlFor = 'hpx-api-note';
    const note = element('textarea'); note.id = 'hpx-api-note'; note.rows = 3; note.maxLength = 50000;
    const resultText = element('p'); resultText.setAttribute('role', 'status'); resultText.setAttribute('aria-live', 'polite');
    const buttons = element('div', '', 'hpx-quick-status-list');
    const change = element('button', '儲存狀態');
    const closeTicket = element('button', '結案');
    const reloadData = element('button', '重新讀取工單');
    const refreshPage = element('button', '重新整理 Halo 頁面'); refreshPage.hidden = true;
    const settings = element('button', '後台設定／開案件');
    [change, closeTicket, reloadData, refreshPage, settings].forEach(button => { button.type = 'button'; buttons.appendChild(button); });
    let data = null;
    let uncertain = false;
    function canWrite() {
      return guard() && !Array.from(document.querySelectorAll('form.action-form, [role="dialog"], [aria-modal="true"]'))
        .some(node => node !== panel && !panel.contains(node) && node.getClientRects().length);
    }
    function controls() {
      const busy = state.busy;
      select.disabled = busy || !data;
      note.disabled = busy;
      change.disabled = busy || uncertain || !data || !select.value || Number(select.value) === data.ticket.statusId || Number(select.value) === data.closeStatusId;
      closeTicket.disabled = busy || uncertain || !data || !data.canClose || data.ticket.statusId === data.closeStatusId;
      reloadData.disabled = busy; settings.disabled = busy; exit.disabled = busy; refreshPage.disabled = busy;
    }
    async function load() {
      state.busy = true; controls(); resultText.textContent = '讀取中…';
      try {
        if (!guard()) throw new Error('已切換工單，請關閉選單後重新開啟。');
        const result = await call('ticket', { ticketId: snapshot.id });
        if (!guard()) throw new Error('已切換工單，請關閉選單後重新開啟。');
        data = result;
        select.replaceChildren();
        result.statuses.forEach(item => {
          const option = element('option', item.name + ' (#' + item.id + ')'); option.value = String(item.id); select.appendChild(option);
        });
        select.value = String(data.ticket.statusId);
        const found = data.statuses.find(item => item.id === data.ticket.statusId);
        current.textContent = '#' + data.ticket.id + ' ' + data.ticket.summary + ' · 目前：' + (found ? found.name : data.ticket.statusName || '#' + data.ticket.statusId);
        resultText.textContent = data.canClose ? '選擇狀態後儲存，或填寫說明後結案。' : '尚未設定結案 Action 與狀態，可至後台完成設定。';
        uncertain = false;
      } catch (error) { data = null; resultText.textContent = error.message; }
      finally { state.busy = false; controls(); }
    }
    async function submit(operation) {
      if (state.busy || uncertain || !data) return;
      if (!canWrite()) { resultText.textContent = '請先完成或取消原生表單／提示，並確認仍在同一張工單。'; return; }
      if (operation === 'close' && !note.value.trim()) { resultText.textContent = '請填入結案說明。'; note.focus(); return; }
      state.busy = true; controls(); resultText.textContent = '正在儲存，請勿重複送出…';
      try {
        const result = await call(operation, { ticketId: snapshot.id, expectedStatusId: data.ticket.statusId, statusId: select.value, note: note.value });
        data.ticket = result.ticket;
        select.value = String(result.ticket.statusId);
        const found = data.statuses.find(item => item.id === result.ticket.statusId);
        current.textContent = '#' + result.ticket.id + ' · 目前：' + (found ? found.name : '#' + result.ticket.statusId);
        resultText.textContent = result.unchanged ? '工單已是目標狀態。' : '已儲存並查核工單 #' + result.ticket.id + '。可重新整理 Halo 頁面查看歷程。';
        note.value = ''; refreshPage.hidden = false;
      } catch (error) { uncertain = true; resultText.textContent = error.message + ' 請先檢查結果，再重新讀取工單。'; }
      finally { state.busy = false; controls(); }
    }
    change.addEventListener('click', () => submit('status'));
    closeTicket.addEventListener('click', () => submit('close'));
    select.addEventListener('change', controls);
    reloadData.addEventListener('click', load);
    refreshPage.addEventListener('click', () => {
      if (!canWrite()) { resultText.textContent = '請先完成原生表單，或返回原工單後重新整理。'; return; }
      window.location.reload();
    });
    settings.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'HPX_OPEN_HALO_OPTIONS' }).catch(() => { resultText.textContent = '無法開啟後台，請從擴充功能圖示開啟。'; });
    });
    panel.append(heading, exit, hint, current, statusLabel, select, noteLabel, note, buttons, resultText);
    function position() {
      const rect = trigger.getBoundingClientRect();
      panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
      panel.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - Math.min(panel.scrollHeight, 500) - 8)) + 'px';
      panel.style.maxHeight = Math.max(120, window.innerHeight - parseFloat(panel.style.top) - 12) + 'px';
    }
    const state = { panel, trigger, position, busy: false };
    active = state; document.body.appendChild(panel);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); dismiss(); } });
    trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-expanded', 'true');
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    position(); exit.focus(); await load(); position();
    return true;
  }
  NS.features.haloApiPanel = { open };
})();
