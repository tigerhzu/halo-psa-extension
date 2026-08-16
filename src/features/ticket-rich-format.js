/**
 * 將工單板的純文字語意標籤轉成 HaloPSA 可保存的精簡富文字。
 *
 * AI 只負責輸出標籤；本模組以固定映射上色，避免模型自行選色或污染正文。
 * 依 wiki-layout-extension 規則，只替短標籤上色，技術值與敘述保持預設色。
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.__HPX) root.__HPX.features.ticketRichFormat = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const LABEL_COLORS = Object.freeze({
    異常: 'red',
    待確認: 'orange',
    注意: 'orange',
    資訊: 'blue',
    設定: 'blue',
    處理動作: 'blue',
    已完成: 'green',
    確認結果: 'green',
    使用者回報: 'purple',
    負責單位: 'purple',
  });

  const LABEL_PATTERN = Object.keys(LABEL_COLORS).join('|');
  const LABELED_LINE = new RegExp(
    '^\\s*(?:[-*•]\\s*)?【(' + LABEL_PATTERN + ')】\\s*(.*)$'
  );

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function colorForLabel(label) {
    return LABEL_COLORS[String(label || '')] || '';
  }

  function lineToHtml(line) {
    if (!line.trim()) return '<div><br></div>';
    const match = line.match(LABELED_LINE);
    if (!match) return '<div>' + escapeHtml(line) + '</div>';

    const label = match[1];
    const content = match[2];
    return (
      '<div>• <font color="' +
      LABEL_COLORS[label] +
      '">【' +
      label +
      '】</font>' +
      (content ? ' ' + escapeHtml(content) : '') +
      '</div>'
    );
  }

  function toHtml(text) {
    const value = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    if (!value) return '';
    return value.split('\n').map(lineToHtml).join('');
  }

  return {
    LABEL_COLORS: LABEL_COLORS,
    colorForLabel: colorForLabel,
    toHtml: toHtml,
  };
});
