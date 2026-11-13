/** Fill only the note of a recognised native status action; never submit it. */
(function () {
  'use strict';
  const NS = window.__HPX;
  const config = window.HPX_STATUS_NOTES;
  const adapter = NS.core.adapter;
  const states = new WeakMap();
  const touched = new WeakSet();
  let settings = config.normalize();
  let loaded = false;
  let ready;
  const visible = el => el.isConnected && !!el.getClientRects().length;
  const ticketId = () => new URL(window.location.href).searchParams.get('id') || '';

  function context(form) {
    const id = ticketId();
    if (!/^\d+$/.test(id) || !visible(form)) return null;
    const heading = Array.from(document.querySelectorAll('h1.profile-full-name')).filter(visible);
    if (heading.length !== 1 || Number((heading[0].textContent.match(/\[ID:\s*(\d+)\]/i) || [])[1]) !== Number(id)) return null;
    const owner = form.closest('.newaction');
    if (!owner) return null;
    const historyItem = owner.closest('.action-history-item[data-id]');
    // Halo renders a NEW action inside the history list too. Only its explicit
    // unsaved sentinel is eligible; persisted records (including edits) stay protected.
    if (historyItem && !(historyItem.getAttribute('data-id') === '-1' && historyItem.classList.contains('isadding'))) return null;
    // An email action can have several note-like fields. Never guess its message body.
    if (form.querySelector('input[name="emailto" i], input[name="emailcc" i], input[name="emailbcc" i]')) return null;
    const outcome = owner.querySelector('.history-header .outcome');
    const key = config.keyOf(outcome && outcome.textContent);
    if (!key) return null;
    const editors = Array.from(form.querySelectorAll(NS.config.selectors.EDITOR_SELECTORS.join(',')))
      .filter(el => visible(el) && !el.closest('[data-hpx-extension-toolbar="true"]'));
    if (editors.length !== 1) return null;
    return { id, key, editor: editors[0] };
  }

  function empty(editor) {
    const text = adapter.getText(editor).replace(/[\s\u200b\ufeff]/g, '');
    if (text && text !== '$SERVICESTATUSNOTE') return false;
    // Preserve image-only notes, tables and other non-text content as well.
    return !/<(?:img|table|video|audio|iframe|object|embed|svg|hr)\b/i.test(adapter.getHtml(editor));
  }

  function fill(form) {
    if (!loaded || !settings.enabled) return Promise.resolve();
    const current = context(form);
    if (!current) return Promise.resolve();
    const { id, key, editor } = current;
    const previous = states.get(editor);
    if (previous && previous.id === id && previous.key === key) return previous.promise || Promise.resolve();
    const text = settings.texts[key];
    if (!text.trim()) return Promise.resolve();
    const before = adapter.getHtml(editor);
    const replaceOwn = previous && previous.id === id && previous.html === before;
    if (touched.has(editor) || (!empty(editor) && !replaceOwn)) return Promise.resolve();
    const state = { id, key, html: null, promise: null };
    states.set(editor, state);
    const canWrite = () => {
      const now = context(form);
      return settings.enabled && settings.texts[key] === text && now && now.id === id && now.key === key &&
        now.editor === editor && !touched.has(editor) && adapter.getHtml(editor) === before;
    };
    state.promise = adapter.setHtmlReliable(editor, adapter.getKind(editor) === 'textarea' ? text : config.toHtml(text), { canWrite })
      .then(result => { if (result && result.ok) state.html = adapter.getHtml(editor); })
      .catch(error => NS.warn('狀態文字帶入失敗', error));
    return state.promise;
  }

  function reconcile() {
    if (!loaded) return;
    document.querySelectorAll('.newaction form.action-form').forEach(fill);
  }

  function start() {
    if (ready) return ready;
    document.addEventListener('input', event => {
      if (!event.isTrusted || !event.target.closest) return;
      const form = event.target.closest('.newaction form.action-form');
      if (!form) return;
      const current = context(form);
      if (current && (current.editor === event.target || current.editor.contains(event.target))) touched.add(current.editor);
    }, true);
    ready = new Promise(resolve => {
      chrome.storage.local.get('hpx_settings', data => {
        if (chrome.runtime.lastError) { NS.warn('無法讀取狀態文字設定'); resolve(); return; }
        settings = config.normalize(data && data.hpx_settings && data.hpx_settings[config.field]);
        loaded = true;
        reconcile();
        resolve();
      });
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.hpx_settings) return;
      settings = config.normalize((changes.hpx_settings.newValue || {})[config.field]);
      // Apply new preferences on the next action, leaving an open draft intact.
    });
    return ready;
  }
  NS.features.statusNotes = { start, reconcile, prepare: async form => { await start(); await fill(form); } };
})();
