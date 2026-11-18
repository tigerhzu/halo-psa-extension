'use strict';
// Local, dependency-free Chromium/CDP benchmark. Never connects to a Halo tenant.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = process.argv[2] && path.resolve(process.argv[2]);
const repeats = Number(process.env.HPX_BENCH_REPEATS || 3);
const modes = process.env.HPX_BENCH_MODE ? [process.env.HPX_BENCH_MODE] : ['native', ...(baseline ? ['baseline'] : []), 'optimized', 'quiet'];
const ultimateModes = process.env.HPX_BENCH_ULTIMATE ? [process.env.HPX_BENCH_ULTIMATE === '1'] : [false, true];
const browser = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
if (!browser) throw Error('Set CHROME_PATH to a Chromium browser.');
const temporary = path.join(root, 'temp'); fs.mkdirSync(temporary, {recursive:true});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let source = root;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') {
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
    res.setHeader('Content-Type', 'text/javascript');
    res.end(manifest.content_scripts.flatMap(g => g.js || []).map(p => fs.readFileSync(path.join(source,p),'utf8') + '\n;\n').join('\n')); return;
  }
  const runtime = url.pathname.startsWith('/runtime/');
  const base = runtime ? source : root;
  const relative = runtime ? url.pathname.slice(9) : 'tests/page-performance.html';
  let file = path.resolve(base, relative);
  if (!file.startsWith(base + path.sep)) {res.writeHead(403);res.end();return;}
  if (runtime && !fs.existsSync(file) && /^(assets|pet)\//.test(relative)) file = path.resolve(root, relative);
  const types = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).on('error',()=>{res.writeHead(404);res.end();}).pipe(res);
});
async function connect(url) {
  const ws = new WebSocket(url), pending = new Map(); let id=0;
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage = event => {const value=JSON.parse(event.data), pair=pending.get(value.id);if(pair){pending.delete(value.id);value.error?pair.reject(Error(JSON.stringify(value.error))):pair.resolve(value.result);}};
  return { close:()=>ws.close(), send(method,params={}) {return new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});} };
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const results=[];
  try {
    for (let repeat=0;repeat<repeats;repeat++) for (const ultimate of ultimateModes) for (const mode of modes.slice(repeat % modes.length).concat(modes.slice(0,repeat % modes.length))) {
      source=mode==='baseline'?baseline:root;
      const profile=fs.mkdtempSync(path.join(temporary,'perf-browser-'));
      const proc=spawn(browser,['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--remote-debugging-port=0','--window-size=1280,900','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
      let client;
      try {
        const portFile=path.join(profile,'DevToolsActivePort');
        let port;
        for(let i=0;i<150;i++) {
          try { port=fs.readFileSync(portFile,'utf8').split('\n')[0]; if (/^\d+$/.test(port)) break; } catch (_) { /* Chromium may still hold the file. */ }
          await sleep(100);
        }
        if (!port) throw Error('Chromium did not expose its local debugging port');
        const targets=await (await fetch('http://127.0.0.1:'+port+'/json')).json();
        client=await connect(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
        await client.send('Performance.enable');
        if (process.env.HPX_BENCH_PROFILE) {
          await client.send('Profiler.enable');
          await client.send('Profiler.start');
        }
        await client.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?mode='+mode+'&ultimate='+Number(ultimate)+'&pet='+Number(process.env.HPX_BENCH_PET === '1')});
        for (let i=0;i<200;i++) {
          const r=await client.send('Runtime.evaluate',{expression:'window.__benchRendering'});
          if(r.result.value) break;
          await sleep(10);
        }
        const point=await client.send('Runtime.evaluate',{expression:`(()=>{const r=document.getElementById('input-probe').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,returnByValue:true});
        for(let i=0;i<5;i++) {
          await sleep(75);
          for(const type of ['mousePressed','mouseReleased']) await client.send('Input.dispatchMouseEvent',{type,...point.result.value,button:'left',clickCount:1});
        }
        let data;
        for(let i=0;i<600;i++){
          await sleep(100);
          const value=await client.send('Runtime.evaluate',{expression:'window.__benchmarkResult',returnByValue:true});
          if(value.result.value){data=value.result.value;break;}
        }
        if(!data)throw Error('Benchmark timeout: '+mode);
        if(data.errors.length)throw Error(JSON.stringify(data.errors));
        const perf=await client.send('Performance.getMetrics');
        if (process.env.HPX_BENCH_PROFILE) {
          const profileData=await client.send('Profiler.stop');
          fs.writeFileSync(path.join(temporary,mode+'-'+Number(ultimate)+'.cpuprofile'),JSON.stringify(profileData.profile));
        }
        const counters=Object.fromEntries(perf.metrics.map(m=>[m.name,m.value]));
        Object.assign(data,{repeat,taskMs:counters.TaskDuration*1000,scriptMs:counters.ScriptDuration*1000,layoutMs:counters.LayoutDuration*1000,heapMB:counters.JSHeapUsedSize/1024/1024});
        if(data.input.length!==5) throw Error('Missing native input samples: '+data.input.length);
        if(mode==='quiet') {
          const check=await client.send('Runtime.evaluate',{expression:'window.__exerciseQuiet()',awaitPromise:true,returnByValue:true});
          if(check.exceptionDetails)throw Error(check.exceptionDetails.exception.description);
          data.activationMs=check.result.value;
        }
        results.push(data); console.log(JSON.stringify(data));
      } finally {
        if(client) {
          await Promise.race([client.send('Browser.close').catch(()=>{}),sleep(500)]);
          client.close();
        }
        proc.kill();
        await new Promise(resolve=>proc.exitCode!==null?resolve():proc.once('exit',resolve));
        // Fresh profile is created directly under the workspace's temp directory.
        if(path.dirname(profile)!==temporary)throw Error('Unexpected profile location');
        fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
      }
    }
    fs.writeFileSync(path.join(temporary,'performance-results.json'),JSON.stringify({browser,repeats,results},null,2));
  } finally {server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
