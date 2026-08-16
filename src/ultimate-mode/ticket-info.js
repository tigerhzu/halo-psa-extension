/** ultimate-mode/ticket-info.js — Ticket Information 欄位白名單。 */
(function () {
  'use strict';
  const NS = window.__HPX;
  NS.ultimate.ticketInfo = {
    apply: function () {
      return NS.ultimate.shared.filterDetailSection(NS.ultimate.shared.cfg.TICKET_INFO);
    },
  };
})();
