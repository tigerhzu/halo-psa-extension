/** Shared, local-only defaults for native status action notes. */
(function () {
  'use strict';
  const catalog = [
    { key: 'open', label: 'Open / Opened', names: ['Open', 'Opened', 'Open / Opened', 'Reopen', 'Re-open', 'Reopen Ticket', 'Re-open Ticket'], text: '案件進入受理階段。' },
    { key: 'progress', label: 'In Progress', names: ['In Progress', 'In-Progress'], text: '案件列為處理中。' },
    { key: 'awaiting', label: 'Awaiting Customer Reply', names: ['Awaiting Customer Reply', 'Awaiting Customer'], text: '案件列為等待客戶回覆。' },
    { key: 'pending', label: 'Pending', names: ['Pending'], text: '案件列為暫緩處理。' },
    { key: 'hold', label: 'On Hold', names: ['On Hold'], text: '案件列為暫停處理。' },
    { key: 'postponed', label: 'Postponed', names: ['Postponed'], text: '案件列為延後處理。' },
    { key: 'final', label: 'Final Check with Customer/Sales', names: ['Final Check with Customer/Sales', 'Final Check'], text: '案件進入客戶 / 業務最終確認階段。' },
    { key: 'closed', label: 'Closed', names: ['Closed', 'Close', 'Close Ticket', 'Closed Ticket', 'Resolved', 'Resolve Ticket', 'Resolved Ticket'], text: '案件列為已結案狀態。' },
  ];
  const normalizeLabel = value => String(value || '').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim().toLowerCase();
  const keyOf = label => (catalog.find(entry => entry.names.some(name => normalizeLabel(name) === normalizeLabel(label))) || {}).key;
  function normalize(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const texts = source.texts && typeof source.texts === 'object' ? source.texts : {};
    return {
      enabled: source.enabled !== false,
      texts: Object.fromEntries(catalog.map(entry => [entry.key,
        typeof texts[entry.key] === 'string' ? texts[entry.key].slice(0, 4000) : entry.text])),
    };
  }
  const toHtml = text => String(text).split(/\r?\n/).map(line => '<div>' +
    (line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '<br>') + '</div>').join('');
  window.HPX_STATUS_NOTES = { catalog, keyOf, normalize, toHtml, field: 'statusNotes' };
})();
