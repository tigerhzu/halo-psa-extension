/** ultimate-mode/user-info.js — End-User Details 欄位白名單。 */
(function () {
  'use strict';
  const NS = window.__HPX;
  NS.ultimate.userInfo = {
    apply: function () {
      return NS.ultimate.shared.filterDetailSection(NS.ultimate.shared.cfg.USER_INFO);
    },
  };
})();
