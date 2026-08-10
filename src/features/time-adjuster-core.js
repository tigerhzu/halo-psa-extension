/**
 * time-adjuster-core.js
 * Time Taken 的時間換算邏輯：純函式，不碰 DOM、不呼叫任何 API。
 * 可直接在 Node 測試（見 tests/time-adjuster.test.js）。
 *
 * 一律以「總秒數」為單一事實來源，避免時／分／秒三個欄位各自進位造成不一致。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const cfg = NS.config.timeAdjuster;

  const SECONDS_PER_MINUTE = 60;
  const SECONDS_PER_HOUR = 3600;

  function maxSeconds() {
    return (cfg.MAX_HOURS + 1) * SECONDS_PER_HOUR - 1; // 99:59:59
  }

  /** 寬鬆解析單一欄位：空字串、空白與非數字都視為 0。 */
  function parseUnit(value) {
    if (value == null) return 0;
    const digits = String(value).trim().replace(/[^\d]/g, '');
    if (!digits) return 0;
    const num = parseInt(digits, 10);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  }

  /**
   * 由三個欄位值算出總秒數。
   * 允許「分 / 秒 > 59」（使用者手動輸入 90 分是合法輸入），一律換算後再進位。
   */
  function toTotalSeconds(parts) {
    const raw = parts || {};
    const total =
      parseUnit(raw.hours) * SECONDS_PER_HOUR +
      parseUnit(raw.minutes) * SECONDS_PER_MINUTE +
      parseUnit(raw.seconds);
    return clamp(total);
  }

  /** 夾在 00:00:00 ~ 99:59:59 之間：扣除後不可小於 0，也不可寫入欄位放不下的值。 */
  function clamp(totalSeconds) {
    const num = Math.round(Number(totalSeconds) || 0);
    if (num < 0) return 0;
    const max = maxSeconds();
    return num > max ? max : num;
  }

  /** 總秒數 → 補零後的三個欄位字串（分、秒自動進位）。 */
  function toParts(totalSeconds) {
    const total = clamp(totalSeconds);
    const hours = Math.floor(total / SECONDS_PER_HOUR);
    const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const seconds = total % SECONDS_PER_MINUTE;
    return {
      hours: pad2(hours),
      minutes: pad2(minutes),
      seconds: pad2(seconds),
      totalSeconds: total,
    };
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  /**
   * 加減分鐘。保留原本的秒數（需求：除非使用「分鐘數套用」或「歸零」）。
   * 結果小於 0 時一律歸零，不會變成負值。
   */
  function addMinutes(totalSeconds, deltaMinutes) {
    const delta = Math.round(Number(deltaMinutes) || 0) * SECONDS_PER_MINUTE;
    return clamp(clamp(totalSeconds) + delta);
  }

  /** 直接套用分鐘數：秒數歸零（例如輸入 90 → 01:30:00）。 */
  function fromMinutes(minutes) {
    const value = Math.round(Number(minutes) || 0);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return clamp(value * SECONDS_PER_MINUTE);
  }

  /** 歸零。 */
  function reset() {
    return 0;
  }

  /** HH:MM:SS 顯示（用於 title 與測試）。 */
  function toClock(totalSeconds) {
    const parts = toParts(totalSeconds);
    return parts.hours + ':' + parts.minutes + ':' + parts.seconds;
  }

  /**
   * 可讀的中文摘要：1 小時 30 分鐘 / 19 分鐘 40 秒 / 0 分鐘。
   * 秒數為 0 時不顯示秒，避免「1 小時 30 分鐘 0 秒」這種冗字。
   */
  function formatSummary(totalSeconds) {
    const parts = toParts(totalSeconds);
    const hours = parseUnit(parts.hours);
    const minutes = parseUnit(parts.minutes);
    const seconds = parseUnit(parts.seconds);
    if (!parts.totalSeconds) return '0 分鐘';

    const segments = [];
    if (hours) segments.push(hours + ' 小時');
    if (minutes) segments.push(minutes + ' 分鐘');
    if (seconds) segments.push(seconds + ' 秒');
    return segments.join(' ');
  }

  /** 解析使用者輸入的分鐘數；無效輸入回傳 null，讓呼叫端可以提示而不是靜默寫 0。 */
  function parseMinutesInput(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return null;
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const num = Number(text);
    if (!Number.isFinite(num) || num < 0) return null;
    return num;
  }

  NS.features.timeAdjusterCore = {
    parseUnit: parseUnit,
    toTotalSeconds: toTotalSeconds,
    toParts: toParts,
    clamp: clamp,
    addMinutes: addMinutes,
    fromMinutes: fromMinutes,
    reset: reset,
    toClock: toClock,
    formatSummary: formatSummary,
    parseMinutesInput: parseMinutesInput,
    maxSeconds: maxSeconds,
  };
})();
