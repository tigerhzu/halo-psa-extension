/** Uses the settings page's shared write queue, preserving unrelated preferences. */
(function () {
  'use strict';
  const config = window.HPX_STATUS_NOTES;
  const list = document.getElementById('statusNotesFields');
  const toggle = document.getElementById('statusNotesEnabled');
  const status = document.getElementById('statusNotesStatus');
  const reset = document.getElementById('resetStatusNotes');
  let revision = 0;
  let timer;
  const fields = new Map();
  config.catalog.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'field';
    const label = document.createElement('label');
    label.htmlFor = 'statusNote-' + entry.key;
    label.textContent = entry.label;
    const input = document.createElement('textarea');
    input.id = label.htmlFor;
    input.rows = 2;
    input.maxLength = 4000;
    input.disabled = true;
    input.placeholder = '留白時不自動帶入';
    input.addEventListener('change', save);
    input.addEventListener('input', () => {
      clearTimeout(timer);
      status.textContent = '儲存中…';
      timer = setTimeout(save, 300);
    });
    input.addEventListener('blur', () => { if (timer) save(); });
    row.append(label, input);
    list.append(row);
    fields.set(entry.key, input);
  });
  function render(value) {
    toggle.checked = value.enabled;
    fields.forEach((input, key) => { input.value = value.texts[key]; input.disabled = !value.enabled; });
  }
  function save() {
    clearTimeout(timer);
    timer = null;
    const currentRevision = ++revision;
    const value = { enabled: toggle.checked, texts: Object.fromEntries(Array.from(fields, ([key, input]) => [key, input.value])) };
    fields.forEach(input => { input.disabled = !toggle.checked; });
    status.textContent = '儲存中…';
    mergeFields({ [config.field]: config.normalize(value) }).then(() => {
      if (currentRevision === revision) status.textContent = '已儲存，下次開啟狀態動作時生效。';
    }).catch(() => { if (currentRevision === revision) status.textContent = '儲存失敗，請重試。'; });
  }
  toggle.disabled = reset.disabled = true;
  chrome.storage.local.get('hpx_settings', data => {
    if (chrome.runtime.lastError) { status.textContent = '無法讀取設定，請重新載入。'; return; }
    render(config.normalize(data && data.hpx_settings && data.hpx_settings[config.field]));
    toggle.disabled = reset.disabled = false;
  });
  toggle.addEventListener('change', save);
  reset.addEventListener('click', () => { render(config.normalize()); save(); });
})();
