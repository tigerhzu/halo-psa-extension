/**
 * template-data.js
 * 功能4（快速範本）的範本內容。集中於此方便日後調整 / 之後改為可由設定頁自訂。
 *
 * 每個範本：
 *  - id：唯一識別
 *  - label：按鈕顯示文字
 *  - content：插入的文字（以 \n 換行）
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  NS.config.templates = [
    {
      id: 'onsite',
      label: '到場處理',
      content: [
        '【到場處理】',
        '• 到達時間：',
        '• 現場狀況：',
        '• 處理內容：',
        '• 處理結果：',
      ].join('\n'),
    },
    {
      id: 'remote',
      label: '遠端處理',
      content: [
        '【遠端處理】',
        '• 連線方式：',
        '• 問題描述：',
        '• 處理內容：',
        '• 處理結果：',
      ].join('\n'),
    },
    {
      id: 'confirmed',
      label: '客戶確認正常',
      content: [
        '【客戶確認正常】',
        '已與客戶確認，相關功能 / 設備運作正常，本次問題已排除。',
      ].join('\n'),
    },
    {
      id: 'monitoring',
      label: '持續觀察中',
      content: [
        '【持續觀察中】',
        '已完成初步處理，目前狀況穩定，將持續觀察後續狀況，如有異常會再回報。',
      ].join('\n'),
    },
  ];
})();
