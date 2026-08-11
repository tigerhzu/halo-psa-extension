/** ticket-rich-format.js 的語意顏色與安全輸出檢查。 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const formatter = require(path.join(__dirname, '..', 'src', 'features', 'ticket-rich-format.js'));

const html = formatter.toHtml(
  [
    '- 【使用者回報】VPN 無法連線',
    '- 【異常】錯誤碼 0x80070005',
    '- 【處理動作】重啟 VPN 服務',
    '- 【確認結果】已可正常連線',
    '- 【待確認】請確認 10.0.0.1:443',
  ].join('\n')
);

assert.ok(html.includes('<font color="purple">【使用者回報】</font>'), '來源標籤應為紫色');
assert.ok(html.includes('<font color="red">【異常】</font>'), '異常標籤應為紅色');
assert.ok(html.includes('<font color="blue">【處理動作】</font>'), '處理標籤應為藍色');
assert.ok(html.includes('<font color="green">【確認結果】</font>'), '結果標籤應為綠色');
assert.ok(html.includes('<font color="orange">【待確認】</font>'), '待確認標籤應為橘色');
assert.ok(html.includes('錯誤碼 0x80070005'), '技術值必須原樣保留');
assert.ok(html.includes('10.0.0.1:443'), 'IP 與連接埠必須原樣保留');
assert.ok(!html.includes('<font color="red">【異常】錯誤碼'), '只能替標籤上色，不得替正文上色');

const escaped = formatter.toHtml('- 【資訊】<img src=x onerror=alert(1)> & "測試"');
assert.ok(!escaped.includes('<img'), '使用者內容不得成為 HTML');
assert.ok(escaped.includes('&lt;img src=x onerror=alert(1)&gt;'), 'HTML 字元必須跳脫');
assert.ok(escaped.includes('&amp; &quot;測試&quot;'), '特殊字元必須跳脫');

const unknown = formatter.toHtml('使用者自行補充 <b>原文</b>');
assert.equal(unknown, '<div>使用者自行補充 &lt;b&gt;原文&lt;/b&gt;</div>', '未標記文字應安全保留且不自行分類');
assert.equal(formatter.toHtml(''), '', '空字串應保持為空');

console.log('ticket-rich-format.test.js ✓ 全部通過');
