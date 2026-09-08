(function () {
  const NS = window.__HPX;
  NS.features.templates = {list(){return NS.config.templates;},insert(id,editor){const p=document.createElement('p');p.textContent=NS.config.templates.find(x=>x.id===id).content;editor.appendChild(p);}};
  NS.features.noteWindow = {open(){window.open('/src/editor-window/editor.html?preview=1&session=preview','_blank');}};
  NS.features.aiRewrite = {ACTIONS:NS.config.aiActions, async run(action,editor){
    const result = await NS.ui.previewModal.open({title:NS.config.aiActions[action].label,original:editor.innerText,result:'您好，\n\n我們已完成網路連線檢查，更新驅動程式後連線已恢復。請持續觀察使用情況，若再次發生問題，請直接回覆此工單。\n\n謝謝。',note:'示範草稿 · 此頁面不會呼叫 AI 服務。'});
    if(result!==null) {editor.textContent=result;NS.ui.toast.show('已套用示範草稿',{type:'success'});}
  }};
  NS.features.ultimateMode = {setEnabled(enabled){NS.ui.toast.show(enabled?'已開啟簡單模式（示範）':'已關閉簡單模式（示範）');}};
  NS.core.petRegistry.discover = async function () {return NS.core.petRegistry.builtIns();};
})();
