/** Quick access to the current ticket's native actions, including collapsed More items. */
(function () {
  'use strict';
  const NS = window.__HPX;
  const STATUS = /^(?:new|open|pending|in[ -]?progress|on hold|postponed|awaiting\b.*|waiting\b.*|vendor processing|resolved?(?: ticket)?|close(?:d)?(?: ticket)?|re[ -]?open(?: ticket)?|p-in[ -]?progress)$/i;
  let mounted = null;
  let active = null;
  let started = false;
  const chain = NS.features.quickStatusChain;
  let runner = null;
  let progress = null;
  let opening = false;
  const visible = node => !!node.getClientRects().length;

  function ticketId() {
    const id = new URL(window.location.href).searchParams.get('id');
    return id && /^\d+$/.test(id) ? String(Number(id)) : '';
  }

  function label(node) {
    return (node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function disabled(node, root) {
    for (let current = node; current; current = current.parentElement) {
      if (current.disabled || current.getAttribute('aria-disabled') === 'true' || current.classList.contains('disabled')) return true;
      if (current === root) break;
    }
    return false;
  }

  function context() {
    const id = new URL(window.location.href).searchParams.get('id');
    if (!id || !/^\d+$/.test(id)) return null;
    const titles = Array.from(document.querySelectorAll('.details_page_title')).filter(node => node.getClientRects().length);
    if (titles.length !== 1) return null;
    const roots = Array.from(titles[0].querySelectorAll('.buttons-container')).filter(node =>
      node.querySelector(':scope > .actionmenubtn, :scope > [role="listbox"] > .menu > .item[role="option"][title]'));
    if (roots.length !== 1) return null;
    const heading = Array.from(document.querySelectorAll('h1.profile-full-name')).filter(node => node.getClientRects().length);
    if (heading.length !== 1) return null;
    const match = heading[0].textContent.match(/\[ID:\s*(\d+)\]/i);
    if (!match || Number(match[1]) !== Number(id)) return null;
    return { id: String(Number(id)), root: roots[0] };
  }

  function actions(root) {
    const nodes = Array.from(root.querySelectorAll(':scope > .actionmenubtn, :scope > [role="listbox"] > .menu > .item[role="option"]'));
    return nodes.map(node => ({ node, label: label(node), disabled: disabled(node, root) })).filter(item => item.label);
  }

  function forms() {
    return Array.from(document.querySelectorAll('form.action-form')).filter(visible).map(node => {
      const owner = node.closest('.newaction');
      return { node, label: owner ? label(owner.querySelector('.history-header .outcome') || owner) : '' };
    });
  }

  function history() {
    return Array.from(document.querySelectorAll('.action-history-item[data-id]')).map(node => ({
      id: Number(node.getAttribute('data-id')),
      key: chain.keyOf((node.querySelector('.history-header .outcome') || {}).textContent),
    }));
  }

  function modal() {
    return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).some(node => visible(node) && !node.closest('.hpx-quick-status-panel')) ||
      Array.from(document.querySelectorAll('h1')).some(node => visible(node) && /^(Log Response|Discard Changes|Warning|Confirm.*)$/i.test(node.textContent.trim()));
  }

  function saveBlocker(form) {
    const node = form.node;
    if (node.querySelector(':invalid, [aria-invalid="true"], .field-validation-error')) return '有必填資料或驗證錯誤';
    const extras = Array.from(node.querySelectorAll('input, textarea, select, [role="combobox"]')).filter(visible).filter(input =>
      !(input.tagName === 'INPUT' && (input.type === 'submit' || /^timetaken_!/.test(input.name))));
    if (extras.length) return '有額外欄位或寄信選項需要確認';
    const saves = Array.from(node.querySelectorAll('.details-form-controls input[type="submit"]')).filter(input => input.value === 'Save' && visible(input));
    if (saves.length !== 1 || disabled(saves[0], node)) return 'Save 尚未可用';
    return '';
  }

  function report(text, done, error) {
    if (!progress || !progress.isConnected) {
      progress = document.createElement('div');
      progress.className = 'hpx-quick-status-progress';
      const status = document.createElement('span');
      status.setAttribute('role', 'status');
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.addEventListener('click', () => {
        if (runner && runner.busy()) { runner.cancel(); status.textContent = '正在停止接續…'; }
        else { progress.remove(); progress = null; }
      });
      progress.append(status, stop);
      document.body.appendChild(progress);
    }
    if (progress.firstChild.textContent !== text) progress.firstChild.textContent = text;
    progress.dataset.error = error ? 'true' : 'false';
    progress.lastChild.textContent = done ? '關閉' : '停止接續';
  }

  function getRunner() {
    if (!runner) runner = chain.create({
      ticketId,
      state: () => { const current = context(); return current && { id: current.id, items: actions(current.root), stage: (document.querySelector('.workflow-steps-wrap .rc-steps-item-active') || {}).textContent || '' }; },
      forms, modal, history, saveBlocker,
      saved: (before, key) => {
        const maximum = Math.max(0, ...before.map(item => item.id).filter(Number.isFinite));
        return history().some(item => item.id > maximum && item.key === key);
      },
      click: item => {
        const current = context();
        if (!current || !item.node.isConnected || !actions(current.root).some(value => value.node === item.node && value.label === item.label && !value.disabled)) throw new Error('動作已更新，已停止接續。');
        item.node.click();
      },
      save: form => {
        if (!form.node.isConnected || saveBlocker(form)) throw new Error('表單已變更，請手動檢查與儲存。');
        Array.from(form.node.querySelectorAll('.details-form-controls input[type="submit"]'))
          .find(input => input.value === 'Save' && visible(input)).click();
      },
      now: () => Date.now(), delay: ms => new Promise(resolve => setTimeout(resolve, ms)), report,
      finished: () => { if (mounted) { mounted.button.disabled = false; mounted.button.textContent = '快速改狀態 ▾'; } },
    });
    return runner;
  }

  function executeTarget(snapshot, key) {
    const current = context();
    if (!current || current.id !== snapshot.id || current.root !== snapshot.root) {
      close(true);
      NS.ui.toast.show('工單已更新，請重新開啟快速改狀態。');
      return;
    }
    close(false);
    const activeRunner = getRunner();
    if (activeRunner.busy()) return;
    if (mounted) { mounted.button.disabled = true; mounted.button.textContent = '正在接續…'; }
    activeRunner.execute(snapshot.id, key);
  }

  function close(focus) {
    if (!active) return;
    active.panel.remove();
    active = null;
    if (mounted) {
      mounted.button.setAttribute('aria-expanded', 'false');
      if (focus && mounted.button.isConnected) mounted.button.focus();
    }
  }

  function invoke(snapshot, item) {
    if (runner && runner.busy()) return false;
    const current = context();
    if (!current || current.id !== snapshot.id || current.root !== snapshot.root ||
        !item.node.isConnected || !actions(current.root).some(action => action.node === item.node && action.label === item.label && !action.disabled)) {
      close(true);
      NS.ui.toast.show('工單或動作已更新，請重新開啟快速改狀態。', { type: 'info' });
      return false;
    }
    close(false);
    // The original handler preserves Halo's form, validation, audit and save behavior.
    // No status IDs, API tokens, intermediate statuses or synthetic success messages.
    item.node.click();
    return true;
  }

  async function open() {
    if (opening || (runner && runner.busy())) return;
    if (active) { close(true); return; }
    const snapshot = context();
    if (!snapshot || !mounted || snapshot.root !== mounted.root) return;
    if (NS.features.haloApiPanel) {
      opening = true;
      try {
        const handled = await NS.features.haloApiPanel.open(snapshot, mounted.button, () => {
          const current = context();
          return !!current && current.id === snapshot.id && current.root === snapshot.root;
        });
        if (handled) return;
      } catch (error) { NS.ui.toast.show(error.message); return; }
      finally { opening = false; }
      const current = context();
      if (!current || current.id !== snapshot.id || current.root !== snapshot.root) return;
    }
    openNative();
  }

  function openNative() {
    if (active) { close(true); return; }
    const snapshot = context();
    if (!snapshot || !mounted || snapshot.root !== mounted.root) return;
    const panel = document.createElement('section');
    panel.className = 'hpx-quick-status-panel';
    panel.id = 'hpx-quick-status-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '快速改狀態');
    const title = document.createElement('strong');
    title.textContent = '快速改狀態';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'hpx-quick-status-close';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', '關閉快速改狀態');
    dismiss.addEventListener('click', () => close(true));
    const hint = document.createElement('p');
    hint.textContent = '自動完成並儲存必要的 In Progress／Final Check，最後停在你選的動作表單，由你按 Save。前置動作會留下歷程，工時沿用 Halo 預設。';
    panel.append(title, dismiss, hint);
    const list = document.createElement('div');
    list.className = 'hpx-quick-status-list';
    const items = actions(snapshot.root);
    function addItem(item, target) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.disabled = item.disabled;
      button.addEventListener('click', () => item.key ? executeTarget(snapshot, item.key) : invoke(snapshot, item));
      if (item.hint) {
        const sub = document.createElement('small');
        sub.textContent = item.hint;
        button.appendChild(sub);
      }
      target.appendChild(button);
    }
    const stage = (document.querySelector('.workflow-steps-wrap .rc-steps-item-active') || {}).textContent || '';
    chain.catalog.forEach(entry => {
      const native = items.find(item => chain.keyOf(item.label) === entry.key);
      const step = chain.next(items, entry.key, new Set(), stage);
      addItem({ key: entry.key, label: native ? native.label : entry.label, disabled: !step,
        hint: !step ? '目前無可用路徑' : step.final ? '直接開啟' : '自動完成前置步驟後開啟' }, list);
    });
    items.filter(item => STATUS.test(item.label) && !chain.keyOf(item.label)).forEach(item => addItem(item, list));
    if (!list.children.length) {
      const empty = document.createElement('p');
      empty.textContent = '目前沒有可辨識的狀態動作，可查看下方其他動作。';
      list.appendChild(empty);
    }
    panel.appendChild(list);
    const note = document.createElement('p');
    note.className = 'hpx-quick-status-note';
    note.textContent = 'Resolved Ticket 缺少入口時會先完成 Final Check；已可直接使用的動作不重跑前置步驟。遇到必填欄位或 Halo 提示會等你處理。';
    panel.appendChild(note);
    const other = items.filter(item => !STATUS.test(item.label) && !chain.keyOf(item.label) && !/^(delete|刪除)$/i.test(item.label));
    if (other.length) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = '其他原生動作（含自訂狀態）';
      const remaining = document.createElement('div');
      remaining.className = 'hpx-quick-status-list';
      other.forEach(item => addItem(item, remaining));
      details.append(summary, remaining);
      panel.appendChild(details);
    }
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
    });
    document.body.appendChild(panel);
    active = { panel, id: snapshot.id, root: snapshot.root, items };
    mounted.button.setAttribute('aria-expanded', 'true');
    position();
    const first = list.querySelector('button:not(:disabled)');
    (first || dismiss).focus();
  }

  function position() {
    if (!active || !mounted) return;
    const rect = mounted.button.getBoundingClientRect();
    const panel = active.panel;
    panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 160)) + 'px';
    panel.style.maxHeight = Math.max(120, window.innerHeight - parseFloat(panel.style.top) - 12) + 'px';
  }

  function reconcile() {
    const current = context();
    if (active && (!current || current.id !== active.id || current.root !== active.root || active.items.some(item =>
      !item.node.isConnected || label(item.node) !== item.label || disabled(item.node, active.root) !== item.disabled))) close(false);
    if (mounted && (!current || current.root !== mounted.root || !mounted.button.isConnected)) {
      close(false);
      mounted.button.remove();
      mounted = null;
    }
    if (!current || mounted) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hpx-quick-status-trigger';
    button.textContent = '快速改狀態 ▾';
    if (runner && runner.busy()) { button.disabled = true; button.textContent = '正在接續…'; }
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'hpx-quick-status-panel');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', open);
    current.root.appendChild(button);
    mounted = { root: current.root, button };
  }

  function start() {
    if (started) return;
    started = true;
    document.addEventListener('pointerdown', event => {
      if (active && !active.panel.contains(event.target) && event.target !== mounted.button) close(false);
    });
    document.addEventListener('focusin', event => {
      if (active && !active.panel.contains(event.target) && event.target !== mounted.button) close(false);
    });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.addEventListener('popstate', () => { close(false); reconcile(); });
    document.addEventListener('click', event => {
      if (!runner || !runner.busy() || !event.isTrusted) return;
      const button = event.target.closest('button, input[type="submit"], .item[role="option"]');
      if (button && (button.matches('[title="Cancel Action"]') || /^(Discard|Cancel)$/i.test(button.textContent.trim()) || button.closest('.details_page_title'))) runner.cancel();
    }, true);
    let scheduled = false;
    const watched = '.details_page_title, h1.profile-full-name';
    const observer = new MutationObserver(records => {
      const relevant = records.some(record => {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (target && target.closest('.hpx-quick-status-trigger, .hpx-quick-status-panel')) return false;
        if (target && target.closest(watched)) return true;
        return Array.from(record.addedNodes || []).concat(Array.from(record.removedNodes || [])).some(node =>
          node.nodeType === 1 && (node.matches(watched) || node.querySelector(watched)));
      });
      if (!relevant || scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => { scheduled = false; reconcile(); });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'class', 'title'] });
    reconcile();
  }

  NS.features.quickStatus = { start, reconcile, _context: context, _actions: actions, _invoke: invoke };
})();
