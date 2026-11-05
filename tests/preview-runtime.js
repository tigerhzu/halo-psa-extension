/* Development-only browser API substitute. Never contacts Halo or an AI service. */
(function () {
  'use strict';
  const listeners = [];
  // Halo preview data is isolated, in memory, and never contacts a real tenant.
  let haloConfig = {};
  let haloStatus = 1;
  const haloStatuses = [{id:1,name:'Open'},{id:2,name:'On Hold'},{id:9,name:'Resolved'}];
  window.__hpxHaloPreviewCalls = [];
  const initial = { theme:'cute-ios', accent:'#0067e6', ultimateMode:false, petHidden:true, pet:'claude-crab', onboardingVersion:0, ultimateTeams:['Op Team A','Op Team B','Technical Solutions Division'], shortcutLinks:[{name:'知識庫',url:'https://example.com/knowledge'},{name:'服務狀態',url:'https://example.com/status'}] };
  function read() { try { return JSON.parse(localStorage.getItem('hpx_preview_ios_settings')) || initial; } catch (_) { return initial; } }
  const local = {
    get(key, callback) { const result = {hpx_settings:read()}; if(callback) queueMicrotask(() => callback(result)); else return Promise.resolve(result); },
    set(values, callback) { const before = read(); localStorage.setItem('hpx_preview_ios_settings', JSON.stringify(values.hpx_settings || before)); listeners.forEach(fn => fn({hpx_settings:{oldValue:before,newValue:read()}},'local')); if(callback) queueMicrotask(callback); else return Promise.resolve(); },
    remove(key, callback) { localStorage.removeItem('hpx_preview_ios_settings'); if(callback) callback(); return Promise.resolve(); }
  };
  window.chrome = {
    permissions:{request:async()=>true,contains:async()=>true},
    storage:{local, session:local, onChanged:{addListener(fn){listeners.push(fn);},removeListener(fn){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);}}},
    runtime:{
      id:'local-review', getURL(p){return '/' + p;}, getManifest(){return {version:'1.1.2'};}, onMessage:{addListener(){}},
      sendMessage(message,callback){
        let response = {ok:false,error:'此為本機示範，請在擴充功能中使用此操作。'};
        if(message.type==='HPX_HALO_API'){
          const p=message.payload||{};
          window.__hpxHaloPreviewCalls.push({operation:message.operation,payload:p});
          if(message.operation==='config.get')response={ok:true,config:haloConfig};
          if(message.operation==='config.save'){haloConfig=p;response={ok:true};}
          if(message.operation==='config.clear'){haloConfig={};response={ok:true};}
          if(message.operation==='available')response={ok:true,enabled:haloConfig.enabled===true};
          if(message.operation==='test'||message.operation==='statuses')response={ok:true,statuses:haloStatuses};
          if(message.operation==='ticket')response={ok:true,ticket:{id:123,summary:'示範案件：網路連線異常',statusId:haloStatus},statuses:haloStatuses,closeStatusId:9,canClose:true};
          if(message.operation==='status'||message.operation==='close'){haloStatus=message.operation==='close'?9:Number(p.statusId);response={ok:true,ticket:{id:123,summary:'示範案件',statusId:haloStatus}};}
          if(message.operation==='create')response={ok:true,ticket:{id:456,summary:p.summary},url:'/tests/halo-api-browser-preview.html?id=456'};
        }
        if(message.type==='HPX_OPEN_HALO_OPTIONS'){window.open('/src/options/options.html?preview=1#halo','_blank');response={ok:true};}
        if(message.type==='HPX_NOTE_SESSION_GET') response={ok:true,title:'網路連線異常 · Activity Note',html:'<h2>處理紀錄</h2><p>已與使用者確認，辦公區網路出現間歇性中斷。</p><h3>檢查與處理</h3><ul><li>檢查交換器與上行連線，設備運作正常。</li><li>更新網路卡驅動程式，重新連線後已恢復。</li><li>請使用者持續觀察，若再次發生則回覆工單。</li></ul><p><strong>後續追蹤</strong>：明日上午確認連線狀態。</p>'};
        if(message.type==='HPX_OPEN_OPTIONS'){window.open('/src/options/options.html?preview=1','_blank');response={ok:true};}
        if(callback) queueMicrotask(()=>callback(response)); else return Promise.resolve(response);
      }
    }
  };
})();
