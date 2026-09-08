(function(){
  const NS=window.__HPX;
  NS.ui.theme.applyAppearance({theme:'cute-ios',accent:'#0067e6'});
  NS.ui.toolbar.mount(document.getElementById('preview-editor'));
  NS.ui.settingsPanel.start();
  NS.config.selectors.HALO_SIGNATURE_SELECTORS.push('.review-main');
  NS.features.timeAdjuster.start();
})();
