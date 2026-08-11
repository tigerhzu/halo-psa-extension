/**
 * timesheet-bridge.js
 * Runs in HaloPSA's MAIN world and forwards an explicit, user-confirmed
 * Timesheet adjustment to the mounted Timesheet component's own moveEvent().
 * No tokens, API credentials, or ticket text are copied out of the page.
 */
(function () {
  'use strict';
  const REQUEST_EVENT = 'hpx:timesheet:move';
  const RESULT_EVENT = 'hpx:timesheet:move-result';
  const MOVE_TARGET_ATTR = 'data-hpx-timesheet-move-token';
  const RANGE_RE = /^\s*(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})\s*$/;

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
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

  function normalizedLabel(label) {
    const match = String(label || '').match(RANGE_RE);
    if (!match) return '';
    return String(match[1]).padStart(2, '0') + ':' + match[2] +
      ' – ' + String(match[3]).padStart(2, '0') + ':' + match[4];
  }

  function reactFiber(node) {
    if (!node) return null;
    const key = Object.getOwnPropertyNames(node).find(function (name) {
      return name.indexOf('__reactFiber$') === 0 ||
        name.indexOf('__reactInternalInstance$') === 0;
    });
    return key ? node[key] : null;
  }

  function walkOwners(fiber, predicate) {
    let current = fiber;
    let depth = 0;
    while (current && depth < 120) {
      if (predicate(current)) return current;
      current = current.return;
      depth += 1;
    }
    return null;
  }

  function eventFromNode(node) {
    const owner = walkOwners(reactFiber(node), function (fiber) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      return !!(props && props.event && typeof props.event === 'object');
    });
    const props = owner && (owner.memoizedProps || owner.pendingProps);
    return props && props.event;
  }

  function eventDropHandler(node) {
    const owner = walkOwners(reactFiber(node), function (fiber) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      return !!(props && typeof props.onEventDrop === 'function');
    });
    const props = owner && (owner.memoizedProps || owner.pendingProps);
    return props && props.onEventDrop;
  }

  function timesheetInstance(screen) {
    const owner = walkOwners(reactFiber(screen), function (fiber) {
      return !!(fiber.stateNode && typeof fiber.stateNode.moveEvent === 'function');
    });
    return owner && owner.stateNode;
  }

  function findEventNode(screen, detail) {
    const markedTarget = detail.targetToken && screen.querySelector(
      '.rbc-event[' + MOVE_TARGET_ATTR + '="' + detail.targetToken + '"]'
    );
    if (markedTarget) return markedTarget;

    const matches = Array.from(screen.querySelectorAll('.rbc-event')).filter(function (node) {
      const label = node.querySelector('.rbc-event-label');
      const content = node.querySelector('.rbc-event-content');
      return normalizedLabel(label && label.textContent) === detail.originalLabel &&
        textHash(content && content.textContent) === detail.fingerprintHash;
    });
    return matches[0] || null;
  }

  function dateAtMinutes(base, minutes) {
    const date = new Date(base);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return date;
  }

  function respond(requestId, ok, reason) {
    document.dispatchEvent(new CustomEvent(RESULT_EVENT, {
      detail: {
        requestId: requestId,
        ok: !!ok,
        reason: reason || '',
      },
    }));
  }

  function invokeMove(node, instance, event, start, end) {
    const onEventDrop = eventDropHandler(node);
    if (onEventDrop) {
      // 這是 React Big Calendar DnD 元件實際使用的公開 callback；優先走它，
      // 可避免直接猜測某個 HaloPSA 元件私有 moveEvent 的參數形式。
      return onEventDrop({ event: event, start: start, end: end, isAllDay: false });
    }
    // HaloPSA releases have exposed both moveEvent({ event, start, end }) and
    // moveEvent(event, start, end). Select by declared arity while preserving
    // the component as `this` for class-method implementations.
    if (instance.moveEvent.length >= 3) {
      return instance.moveEvent.call(instance, event, start, end);
    }
    return instance.moveEvent.call(instance, { event: event, start: start, end: end });
  }

  document.addEventListener(REQUEST_EVENT, function (request) {
    const detail = request.detail || {};
    const requestId = String(detail.requestId || '');
    if (!requestId) return;

    try {
      const nextStart = Number(detail.nextStart);
      const nextEnd = Number(detail.nextEnd);
      if (!Number.isInteger(nextStart) || !Number.isInteger(nextEnd) ||
          nextStart < 0 || nextEnd <= nextStart || nextEnd > 1440) {
        respond(requestId, false, '新的時間範圍無效。');
        return;
      }

      const screen = document.querySelector('.timesheet-screen');
      if (!screen) {
        respond(requestId, false, '找不到 Timesheet 視窗。');
        return;
      }
      const node = findEventNode(screen, detail);
      if (!node) {
        respond(requestId, false, '找不到要調整的時間紀錄。');
        return;
      }
      const event = eventFromNode(node);
      if (!event) {
        respond(requestId, false, '無法取得 HaloPSA Calendar 的紀錄資料。');
        return;
      }
      const instance = timesheetInstance(screen);
      if (!instance && !eventDropHandler(node)) {
        respond(requestId, false, '無法連接 HaloPSA Timesheet 更新功能。');
        return;
      }

      const baseStart = event.start_date || event.start ||
        event.actionarrivaldate || event.datetime;
      const start = dateAtMinutes(baseStart, nextStart);
      const end = dateAtMinutes(baseStart, nextEnd);
      if (!start || !end) {
        respond(requestId, false, '無法解析原始紀錄日期。');
        return;
      }

      const result = invokeMove(node, instance, event, start, end);
      if (result && typeof result.then === 'function') {
        // 不等待 HaloPSA 的背景儲存 Promise：它可能比橋接逾時時間長。
        // Content script 會接著以日曆畫面是否真的更新判斷結果；此處只
        // 消化 rejection，避免頁面出現未處理的 Promise error。
        result.then(null, function () {});
        respond(requestId, true, '');
      } else {
        respond(requestId, result === false ? false : true,
          result === false ? 'HaloPSA 未接受這次時間調整。' : '');
      }
    } catch (error) {
      respond(requestId, false, error && error.message ? error.message : 'HaloPSA 更新失敗。');
    }
  });
})();
