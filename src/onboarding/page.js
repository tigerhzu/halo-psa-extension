/** Standalone first-login page bootstrap. */
(function () {
  'use strict';
  if (!window.__HPX || !window.__HPX.ui || !window.__HPX.ui.onboarding) return;
  window.__HPX.ui.onboarding.start({ force: true, page: true });
})();
