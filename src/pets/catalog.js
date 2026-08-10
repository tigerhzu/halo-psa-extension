(function () {
  'use strict';

  const requestId = new URLSearchParams(window.location.search).get('request') || '';
  const registry = window.HPX_PET_REGISTRY;

  Promise.resolve()
    .then(function () {
      if (!registry || typeof registry.discoverPackage !== 'function') return [];
      return registry.discoverPackage();
    })
    .catch(function () { return []; })
    .then(function (pets) {
      window.parent.postMessage({
        type: 'HPX_PET_CATALOG_RESULT',
        requestId: requestId,
        pets: Array.isArray(pets) ? pets : [],
      }, '*');
    });
})();
