/** Bounded native-action sequencing. Only prerequisite forms may be auto-saved. */
(function () {
  'use strict';
  const catalog = [
    { key: 'progress', label: 'In Progress', names: ['In Progress', 'In-Progress'] },
    { key: 'pending', label: 'Pending', names: ['Pending'] },
    { key: 'hold', label: 'On Hold', names: ['On Hold'] },
    { key: 'postponed', label: 'Postponed', names: ['Postponed'] },
    { key: 'awaiting', label: 'Awaiting Customer Reply', names: ['Awaiting Customer Reply', 'Awaiting Customer'] },
    { key: 'vendor', label: 'Vendor Processing', names: ['Vendor Processing'] },
    { key: 'final', label: 'Final Check with Customer/Sales', names: ['Final Check with Customer/Sales', 'Final Check'] },
    { key: 'resolved', label: 'Resolved Ticket', names: ['Resolved Ticket', 'Resolve Ticket'] },
  ];
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const definition = key => catalog.find(item => item.key === key);
  const keyOf = label => (catalog.find(item => item.names.some(name => normalize(name) === normalize(label))) || {}).key;
  function find(items, key) { return items.find(item => keyOf(item.label) === key); }

  function next(items, target, visited, stage) {
    const direct = find(items, target);
    if (direct) return direct.disabled ? null : { item: direct, key: target, final: true };
    // Never reopen a closed ticket or move a Final confirmation ticket backwards.
    if (/closed|resolved|final confirmation/i.test(stage || '')) return null;
    if (!definition(target) || target === 'progress') return null;
    const final = find(items, 'final');
    if (target === 'resolved' && final) {
      return final.disabled || visited.has('final') ? null : { item: final, key: 'final', final: false };
    }
    const progress = find(items, 'progress');
    return progress && !progress.disabled && !visited.has('progress') && !visited.has('final')
      ? { item: progress, key: 'progress', final: false } : null;
  }

  function create(adapter) {
    let running = null;
    function cancel() { if (running) running.cancelled = true; }
    function guard(run) {
      if (run.cancelled) throw new Error('已停止接續。已儲存的前置動作會保留。');
      if (adapter.ticketId() !== run.id) throw new Error('已切換工單，停止接續。已儲存的前置動作會保留。');
    }
    async function until(run, read, timeout) {
      const end = adapter.now() + timeout;
      while (adapter.now() < end) {
        guard(run);
        const result = read();
        if (result) return result;
        await adapter.delay(200);
      }
      throw new Error('等待 Halo 逾時，已停止；不會重複送出，請檢查工單與目前表單。');
    }
    async function execute(id, target) {
      if (running) return false;
      const run = { id, target, cancelled: false, visited: new Set() };
      running = run;
      try {
        guard(run);
        if (adapter.forms().length || adapter.modal()) throw new Error('請先完成或取消目前的原生表單／提示，再使用快速改狀態。');
        for (let count = 0; count < 3; count += 1) {
          guard(run);
          const state = adapter.state();
          if (!state || state.id !== id) throw new Error('工單尚未載入完成，請稍後再試。');
          const step = next(state.items, target, run.visited, state.stage);
          if (!step) throw new Error('目前流程沒有提供下一個必要動作，已停止；不會重複執行前置步驟。');
          adapter.report((step.final ? '開啟：' : '前置步驟：') + step.item.label);
          const before = adapter.history();
          guard(run);
          adapter.click(step.item);
          // Final action belongs to the user: open it, never automatically Save it.
          if (step.final) {
            await until(run, () => {
              if (adapter.modal()) { adapter.report('請先處理 Halo 提示，之後會開啟 ' + step.item.label + '。'); return false; }
              const forms = adapter.forms();
              if (forms.length) {
                if (forms.length !== 1 || keyOf(forms[0].label) !== step.key) throw new Error('出現不同的動作表單，已停止接續。');
                return true;
              }
              return adapter.saved(before, step.key);
            }, 180000);
            adapter.report('已開啟／交由 Halo 執行 ' + step.item.label + '；若有表單，請檢查內容並按 Save。', true);
            return true;
          }
          run.visited.add(step.key);
          let form = null;
          let submitted = false;
          let observedForm = false;
          let readySince = null;
          await until(run, () => {
            if (adapter.modal()) {
              adapter.report('請先處理 Halo 的提示（例如 Log Response）；完成後自動接續。');
              return false;
            }
            const forms = adapter.forms();
            if (forms.length) {
              if (forms.length !== 1 || keyOf(forms[0].label) !== step.key) throw new Error('原生動作表單已變更，已停止接續。');
              if (form && form.node !== forms[0].node) throw new Error('表單已重新建立，已停止以免重複儲存。');
              form = forms[0];
              observedForm = true;
              if (submitted) {
                adapter.report('等待 ' + step.item.label + ' 儲存；若有驗證錯誤，請補齊後手動 Save。');
                return false;
              }
              const reason = adapter.saveBlocker(form);
              if (reason) {
                readySince = null;
                adapter.report(step.item.label + '：' + reason + '。請處理後手動 Save，完成後自動接續。');
                // Once user input is needed, never unexpectedly submit after they start typing.
                submitted = true;
                return false;
              }
              if (readySince === null) readySince = adapter.now();
              if (adapter.now() - readySince < 600) return false;
              guard(run);
              submitted = true; // Mark before click: handlers can synchronously re-enter.
              adapter.report('正在儲存前置步驟：' + step.item.label);
              adapter.save(form);
              return false;
            }
            // A closed/discarded form alone is not a successful save. Require a NEW
            // matching native history record and the next usable action.
            const current = adapter.state();
            if (current && adapter.saved(before, step.key) && next(current.items, target, run.visited, current.stage)) return true;
            if (observedForm && !submitted) throw new Error('前置表單已關閉，未確認儲存，已停止接續。');
            return false;
          }, 180000);
        }
        throw new Error('已達前置步驟上限，停止接續。');
      } catch (error) {
        adapter.report(error.message || '操作失敗，已停止接續。', true, true);
        return false;
      } finally {
        running = null;
        adapter.finished();
      }
    }
    return { execute, cancel, busy: () => !!running };
  }
  window.__HPX.features.quickStatusChain = { catalog, keyOf, next, create };
})();
