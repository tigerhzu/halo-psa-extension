/**
 * timesheet-align.js
 * Detects overlapping HaloPSA React Big Calendar entries, previews a
 * duration-preserving schedule, then asks Halo's mounted Timesheet component
 * to perform its own normal update.
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const SELECTORS = NS.config.selectors.TIMESHEET;
  const TIME_RANGE_RE = /^\s*(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})\s*$/;
  const MOUNT_ATTR = 'data-hpx-timesheet-align';
  const BRIDGE_REQUEST = 'hpx:timesheet:move';
  const BRIDGE_RESULT = 'hpx:timesheet:move-result';
  let observer = null;
  let refreshTimer = null;
  let applying = false;

  function toMinutes(hour, minute) {
    return (Number(hour) * 60) + Number(minute);
  }

  function parseRange(text) {
    const match = String(text || '').match(TIME_RANGE_RE);
    if (!match) return null;
    const start = toMinutes(match[1], match[2]);
    const end = toMinutes(match[3], match[4]);
    if (start < 0 || end <= start || end > 1440) return null;
    return { start: start, end: end };
  }

  function formatTime(minutes) {
    const safe = Math.max(0, Math.min(1440, Math.round(minutes)));
    const hour = Math.floor(safe / 60);
    const minute = safe % 60;
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  function formatRange(start, end) {
    return formatTime(start) + ' – ' + formatTime(end);
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Halo Timesheet 日曆文字格式範例：
   * Ticket 638015 - [KYM/凱麥博] Edge 跳告警通知 - 處理內容 (No Charge)
   * 僅解析畫面已顯示的資訊，不額外呼叫 API。
   */
  function parseEntryDetails(text) {
    const raw = normalizeText(text);
    const ticketMatch = raw.match(/^Ticket\s+([^\s-]+)\s*-\s*/i);
    const ticketId = ticketMatch ? ticketMatch[1] : '';
    let remainder = ticketMatch ? raw.slice(ticketMatch[0].length) : raw;

    const billingMatch = remainder.match(/\s*\(([^()]*(?:charge|收費)[^()]*)\)\s*$/i);
    const billing = billingMatch ? billingMatch[1].trim() : '';
    if (billingMatch) remainder = remainder.slice(0, billingMatch.index).trim();

    const clientMatch = remainder.match(/^\[([^\]]+)\]\s*/);
    const client = clientMatch ? clientMatch[1].trim() : '';
    if (clientMatch) remainder = remainder.slice(clientMatch[0].length).trim();

    const parts = remainder.split(/\s+-\s+/);
    const summary = normalizeText(parts.shift());
    const workNote = normalizeText(parts.join(' - '));
    return {
      ticketId: ticketId,
      client: client,
      summary: summary || '未提供案件摘要',
      workNote: workNote,
      billing: billing,
      raw: raw,
    };
  }

  function textHash(text) {
    const value = normalizeText(text);
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function collectEntries(screen) {
    return Array.from(screen.querySelectorAll(SELECTORS.event)).map(function (eventEl, index) {
      const labelEl = eventEl.querySelector(SELECTORS.eventLabel);
      const range = parseRange(labelEl && labelEl.textContent);
      if (!range) return null;
      const contentEl = eventEl.querySelector(SELECTORS.eventContent);
      const titleEl = contentEl && contentEl.querySelector('[title]');
      const fingerprint = normalizeText(contentEl && contentEl.textContent);
      const title = normalizeText(
        (titleEl && titleEl.getAttribute('title')) ||
        fingerprint ||
        '時間紀錄'
      );
      const details = parseEntryDetails(fingerprint || title);
      return {
        index: index,
        start: range.start,
        end: range.end,
        duration: range.end - range.start,
        originalLabel: formatRange(range.start, range.end),
        title: title,
        fingerprint: fingerprint,
        fingerprintHash: textHash(fingerprint),
        ticketId: details.ticketId,
        client: details.client,
        summary: details.summary,
        workNote: details.workNote,
        billing: details.billing,
      };
    }).filter(Boolean);
  }

  function planEntries(entries) {
    const sorted = entries.slice().sort(function (a, b) {
      return a.start - b.start || a.index - b.index;
    });
    let cursor = -1;
    let overflow = false;
    const planned = sorted.map(function (entry) {
      const nextStart = cursor >= 0 && entry.start < cursor ? cursor : entry.start;
      const nextEnd = nextStart + entry.duration;
      if (nextEnd > 1440) overflow = true;
      cursor = Math.max(cursor, nextEnd);
      return Object.assign({}, entry, {
        nextStart: nextStart,
        nextEnd: nextEnd,
        changed: nextStart !== entry.start,
        nextLabel: formatRange(nextStart, nextEnd),
      });
    });
    return {
      entries: planned,
      changes: planned.filter(function (entry) { return entry.changed; }),
      overflow: overflow,
    };
  }

  function analyze(screen) {
    return planEntries(collectEntries(screen));
  }

  function findSubmitButton(screen) {
    return Array.from(screen.querySelectorAll('button')).find(function (button) {
      const label = normalizeText(button.textContent).toLowerCase();
      return label === 'submit' || label === 'revert submit';
    }) || null;
  }

  function removePreview() {
    const existing = document.querySelector('.hpx-ts-preview-backdrop');
    if (existing) existing.remove();
  }

  function showResult(message, tone) {
    if (NS.ui && NS.ui.toast && typeof NS.ui.toast.show === 'function') {
      NS.ui.toast.show(message, { type: tone === 'error' ? 'error' : 'success' });
      return;
    }
    const notice = document.createElement('div');
    notice.className = 'hpx-ts-notice hpx-ts-' + (tone || 'success');
    notice.textContent = message;
    document.body.appendChild(notice);
    setTimeout(function () { notice.remove(); }, 3600);
  }

  function waitForLabel(screen, entry, timeout) {
    return new Promise(function (resolve) {
      const started = Date.now();
      const timer = setInterval(function () {
        const found = Array.from(screen.querySelectorAll(SELECTORS.event)).some(function (eventEl) {
          const label = eventEl.querySelector(SELECTORS.eventLabel);
          const content = eventEl.querySelector(SELECTORS.eventContent);
          return normalizeText(label && label.textContent).replace('-', '–') === entry.nextLabel &&
            textHash(content && content.textContent) === entry.fingerprintHash;
        });
        if (found) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - started >= timeout) {
          clearInterval(timer);
          resolve(false);
        }
      }, 100);
    });
  }

  function requestNativeMove(entry) {
    return new Promise(function (resolve) {
      const requestId = 'ts-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      let settled = false;
      const timeout = setTimeout(function () {
        finish({ ok: false, reason: 'HaloPSA 更新橋接沒有回應。' });
      }, 2500);

      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        document.removeEventListener(BRIDGE_RESULT, onResult);
        resolve(result);
      }

      function onResult(event) {
        const detail = event.detail || {};
        if (detail.requestId !== requestId) return;
        finish({ ok: !!detail.ok, reason: detail.reason || '' });
      }

      document.addEventListener(BRIDGE_RESULT, onResult);
      document.dispatchEvent(new CustomEvent(BRIDGE_REQUEST, {
        detail: {
          requestId: requestId,
          originalLabel: entry.originalLabel,
          fingerprintHash: entry.fingerprintHash,
          nextStart: entry.nextStart,
          nextEnd: entry.nextEnd,
        },
      }));
    });
  }

  async function moveEntry(screen, entry) {
    const bridgeResult = await requestNativeMove(entry);
    if (!bridgeResult.ok) return bridgeResult;
    const changed = await waitForLabel(screen, entry, 8000);
    if (!changed) {
      return { ok: false, reason: 'HaloPSA 已收到更新，但畫面沒有回寫新的時間。' };
    }
    await new Promise(function (resolve) { setTimeout(resolve, 250); });
    return { ok: true, reason: '' };
  }

  async function applyPlan(screen, plan, statusEl, applyButton) {
    if (applying) return;
    applying = true;
    applyButton.disabled = true;
    const backdrop = applyButton.closest('.hpx-ts-preview-backdrop');
    if (backdrop) backdrop.classList.add('hpx-ts-applying');
    let completed = 0;
    try {
      for (const entry of plan.changes) {
        statusEl.textContent = '正在調整 ' + (completed + 1) + ' / ' + plan.changes.length + '…';
        const result = await moveEntry(screen, entry);
        if (!result.ok) {
          throw new Error('「' + entry.originalLabel + '」：' + result.reason);
        }
        completed += 1;
      }
      statusEl.textContent = '全部完成';
      removePreview();
      showResult('已完成 ' + completed + ' 筆 Timesheet 對齊。', 'success');
      scheduleRefresh(screen, 300);
    } catch (error) {
      statusEl.textContent = '已完成 ' + completed + ' 筆後停止：' + error.message;
      statusEl.classList.add('hpx-ts-error');
      applyButton.disabled = false;
    } finally {
      applying = false;
      if (backdrop && backdrop.isConnected) backdrop.classList.remove('hpx-ts-applying');
    }
  }

  function showPreview(screen, plan) {
    removePreview();
    const backdrop = document.createElement('div');
    backdrop.className = 'hpx-ts-preview-backdrop';
    backdrop.setAttribute('data-hpx-ignore-besties', '1');
    const modal = document.createElement('section');
    modal.className = 'hpx-ts-preview';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Timesheet 自動對齊預覽');

    const title = document.createElement('h2');
    title.textContent = 'Timesheet 自動對齊';
    const description = document.createElement('p');
    description.className = 'hpx-ts-description';
    description.textContent = '保留每筆原始時長，依開始時間排序，把重疊項目往後順延。';
    const list = document.createElement('div');
    list.className = 'hpx-ts-change-list';

    plan.changes.forEach(function (entry) {
      const row = document.createElement('div');
      row.className = 'hpx-ts-change';
      const times = document.createElement('div');
      times.className = 'hpx-ts-change-times';
      times.innerHTML = '<del>' + entry.originalLabel + '</del><span aria-hidden="true">→</span><strong>' + entry.nextLabel + '</strong>';
      const name = document.createElement('div');
      name.className = 'hpx-ts-change-title';
      name.textContent = entry.title;
      name.title = entry.title;
      row.appendChild(times);
      row.appendChild(name);
      list.appendChild(row);
    });

    const status = document.createElement('div');
    status.className = 'hpx-ts-status';
    status.textContent = '將調整 ' + plan.changes.length + ' 筆；尚未修改 HaloPSA。';
    const actions = document.createElement('div');
    actions.className = 'hpx-ts-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'hpx-ts-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', removePreview);
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'hpx-ts-apply';
    apply.textContent = '套用自動對齊';
    apply.addEventListener('click', function () {
      applyPlan(screen, plan, status, apply);
    });
    actions.appendChild(cancel);
    actions.appendChild(apply);

    modal.appendChild(title);
    modal.appendChild(description);
    modal.appendChild(list);
    modal.appendChild(status);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop && !applying) removePreview();
    });
    document.body.appendChild(backdrop);
  }

  function validateManualEntries(entries) {
    const normalized = entries.map(function (entry) {
      return Object.assign({}, entry, {
        nextStart: Number(entry.nextStart),
        nextEnd: Number(entry.nextEnd),
      });
    });

    const invalid = normalized.find(function (entry) {
      return !Number.isInteger(entry.nextStart) ||
        !Number.isInteger(entry.nextEnd) ||
        entry.nextStart < 0 ||
        entry.nextEnd <= entry.nextStart ||
        entry.nextEnd > 1440;
    });
    if (invalid) {
      return {
        valid: false,
        error: '每筆結束時間必須晚於開始時間，且不可跨越午夜。',
        entries: normalized,
        changes: [],
        overlaps: [],
        overflow: true,
      };
    }

    const sorted = normalized.slice().sort(function (a, b) {
      return a.nextStart - b.nextStart || a.index - b.index;
    });
    const overlaps = [];
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].nextStart < sorted[index - 1].nextEnd) {
        overlaps.push({
          previous: sorted[index - 1],
          current: sorted[index],
        });
      }
    }
    normalized.forEach(function (entry) {
      entry.changed = entry.nextStart !== entry.start || entry.nextEnd !== entry.end;
      entry.nextLabel = formatRange(entry.nextStart, entry.nextEnd);
    });
    return {
      valid: overlaps.length === 0,
      error: overlaps.length ? '仍有 ' + overlaps.length + ' 組時間重疊，請先調整後再套用。' : '',
      entries: normalized,
      changes: normalized.filter(function (entry) { return entry.changed; }),
      overlaps: overlaps,
      overflow: false,
    };
  }

  function timeInput(minutes, label) {
    const input = document.createElement('input');
    input.type = 'time';
    input.step = '60';
    input.value = formatTime(minutes);
    input.setAttribute('aria-label', label);
    return input;
  }

  function inputMinutes(input) {
    const match = String(input.value || '').match(/^(\d{2}):(\d{2})$/);
    return match ? toMinutes(match[1], match[2]) : NaN;
  }

  function showManualEditor(screen) {
    removePreview();
    const entries = collectEntries(screen);
    if (!entries.length) {
      showResult('目前 Timesheet 沒有可調整的時間紀錄。', 'error');
      return;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'hpx-ts-preview-backdrop';
    backdrop.setAttribute('data-hpx-ignore-besties', '1');
    const modal = document.createElement('section');
    modal.className = 'hpx-ts-preview hpx-ts-editor';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Timesheet 工時調整');

    const heading = document.createElement('div');
    heading.className = 'hpx-ts-editor-heading';
    const headingCopy = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = 'Timesheet 工時調整';
    const description = document.createElement('p');
    description.className = 'hpx-ts-description';
    description.textContent = '直接修改每筆工作的開始與結束時間；有重疊時不會送出。';
    headingCopy.appendChild(title);
    headingCopy.appendChild(description);
    const summary = document.createElement('div');
    summary.className = 'hpx-ts-editor-summary';
    summary.textContent = entries.length + ' 筆紀錄';
    heading.appendChild(headingCopy);
    heading.appendChild(summary);

    const table = document.createElement('div');
    table.className = 'hpx-ts-editor-list';
    const rows = entries.map(function (entry) {
      const row = document.createElement('article');
      row.className = 'hpx-ts-editor-row';

      const info = document.createElement('div');
      info.className = 'hpx-ts-editor-info';
      const meta = document.createElement('div');
      meta.className = 'hpx-ts-editor-meta';
      const ticket = document.createElement('strong');
      ticket.textContent = entry.ticketId ? 'Ticket ' + entry.ticketId : '非 Ticket 紀錄';
      const client = document.createElement('span');
      client.textContent = entry.client || 'Client 未提供';
      meta.appendChild(ticket);
      meta.appendChild(client);
      if (entry.billing) {
        const billing = document.createElement('span');
        billing.className = 'hpx-ts-editor-billing';
        billing.textContent = entry.billing;
        meta.appendChild(billing);
      }
      const caseSummary = document.createElement('div');
      caseSummary.className = 'hpx-ts-editor-case';
      caseSummary.textContent = entry.summary;
      caseSummary.title = entry.summary;
      info.appendChild(meta);
      info.appendChild(caseSummary);
      if (entry.workNote) {
        const note = document.createElement('div');
        note.className = 'hpx-ts-editor-note';
        note.textContent = entry.workNote;
        note.title = entry.workNote;
        info.appendChild(note);
      }

      const controls = document.createElement('div');
      controls.className = 'hpx-ts-editor-time';
      const startWrap = document.createElement('label');
      startWrap.appendChild(document.createTextNode('開始'));
      const startInput = timeInput(entry.start, 'Ticket ' + (entry.ticketId || '') + ' 開始時間');
      startWrap.appendChild(startInput);
      const arrow = document.createElement('span');
      arrow.textContent = '→';
      const endWrap = document.createElement('label');
      endWrap.appendChild(document.createTextNode('結束'));
      const endInput = timeInput(entry.end, 'Ticket ' + (entry.ticketId || '') + ' 結束時間');
      endWrap.appendChild(endInput);
      const duration = document.createElement('output');
      duration.className = 'hpx-ts-editor-duration';
      controls.appendChild(startWrap);
      controls.appendChild(arrow);
      controls.appendChild(endWrap);
      controls.appendChild(duration);
      row.appendChild(info);
      row.appendChild(controls);
      table.appendChild(row);
      return {
        entry: entry,
        row: row,
        startInput: startInput,
        endInput: endInput,
        duration: duration,
      };
    });

    const status = document.createElement('div');
    status.className = 'hpx-ts-status';
    const actions = document.createElement('div');
    actions.className = 'hpx-ts-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'hpx-ts-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', removePreview);
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'hpx-ts-apply';
    apply.textContent = '套用時間調整';

    function currentPlan() {
      return validateManualEntries(rows.map(function (item) {
        return Object.assign({}, item.entry, {
          nextStart: inputMinutes(item.startInput),
          nextEnd: inputMinutes(item.endInput),
        });
      }));
    }

    function refreshEditor() {
      const plan = currentPlan();
      rows.forEach(function (item) {
        const start = inputMinutes(item.startInput);
        const end = inputMinutes(item.endInput);
        const minutes = Number.isFinite(start) && Number.isFinite(end) ? end - start : 0;
        item.duration.textContent = minutes > 0
          ? Math.floor(minutes / 60) + ' 小時 ' + (minutes % 60) + ' 分'
          : '時間無效';
        item.row.classList.toggle('hpx-ts-editor-changed', start !== item.entry.start || end !== item.entry.end);
        item.row.classList.remove('hpx-ts-editor-overlap');
      });
      plan.overlaps.forEach(function (pair) {
        rows.forEach(function (item) {
          if (item.entry.index === pair.previous.index || item.entry.index === pair.current.index) {
            item.row.classList.add('hpx-ts-editor-overlap');
          }
        });
      });
      status.classList.toggle('hpx-ts-error', !plan.valid);
      if (!plan.valid) {
        status.textContent = plan.error;
      } else if (!plan.changes.length) {
        status.textContent = '尚未修改任何時間。';
      } else {
        status.textContent = '將調整 ' + plan.changes.length + ' 筆；尚未修改 HaloPSA。';
      }
      apply.disabled = !plan.valid || !plan.changes.length || applying;
      return plan;
    }

    rows.forEach(function (item) {
      item.startInput.addEventListener('input', refreshEditor);
      item.endInput.addEventListener('input', refreshEditor);
    });
    apply.addEventListener('click', function () {
      const plan = refreshEditor();
      if (plan.valid && plan.changes.length) applyPlan(screen, plan, status, apply);
    });

    actions.appendChild(cancel);
    actions.appendChild(apply);
    modal.appendChild(heading);
    modal.appendChild(table);
    modal.appendChild(status);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop && !applying) removePreview();
    });
    document.body.appendChild(backdrop);
    refreshEditor();
  }

  function paintTrigger(screen, button) {
    const plan = analyze(screen);
    button.disabled = !plan.changes.length || plan.overflow || applying;
    button.classList.toggle('hpx-ts-clear', !plan.changes.length);
    if (plan.overflow) {
      button.textContent = '無法自動對齊';
      button.title = '調整後會超過午夜，請先手動移動部分紀錄。';
    } else if (plan.changes.length) {
      button.textContent = '自動對齊（' + plan.changes.length + '）';
      button.title = '預覽並整理重疊的 Timesheet 時間';
    } else {
      button.textContent = '時間無重疊 ✓';
      button.title = '目前 Timesheet 沒有重疊時間';
    }
  }

  function scheduleRefresh(screen, delay) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      const button = screen.querySelector('.hpx-ts-align-trigger');
      if (button) paintTrigger(screen, button);
      const editorButton = screen.querySelector('.hpx-ts-edit-trigger');
      if (editorButton) {
        editorButton.disabled = !collectEntries(screen).length || applying;
      }
    }, typeof delay === 'number' ? delay : 120);
  }

  function mount(screen) {
    if (!screen || screen.getAttribute(MOUNT_ATTR) === '1') return;
    const calendar = screen.querySelector(SELECTORS.calendar);
    const submit = findSubmitButton(screen);
    if (!calendar || !submit) return;
    screen.setAttribute(MOUNT_ATTR, '1');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'hpx-ts-align-trigger';
    trigger.addEventListener('click', function () {
      const plan = analyze(screen);
      if (plan.changes.length && !plan.overflow) showPreview(screen, plan);
    });
    submit.insertAdjacentElement('afterend', trigger);

    const editorTrigger = document.createElement('button');
    editorTrigger.type = 'button';
    editorTrigger.className = 'hpx-ts-edit-trigger';
    editorTrigger.textContent = '調整工時';
    editorTrigger.title = '查看案件資訊並直接修改每筆工作的開始與結束時間';
    editorTrigger.addEventListener('click', function () {
      showManualEditor(screen);
    });
    trigger.insertAdjacentElement('afterend', editorTrigger);

    paintTrigger(screen, trigger);
    editorTrigger.disabled = !collectEntries(screen).length;

    const calendarObserver = new MutationObserver(function () {
      if (!applying) scheduleRefresh(screen);
    });
    calendarObserver.observe(calendar, { childList: true, subtree: true, characterData: true });
  }

  function scan() {
    document.querySelectorAll(SELECTORS.screen).forEach(mount);
  }

  const TimesheetAlign = {
    start: function () {
      if (observer) return;
      scan();
      observer = new MutationObserver(scan);
      observer.observe(document.body, { childList: true, subtree: true });
    },
    analyzeData: planEntries,
    parseEntryDetails: parseEntryDetails,
    validateManualEntries: validateManualEntries,
  };

  NS.features.timesheetAlign = TimesheetAlign;
})();
