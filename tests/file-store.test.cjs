'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../可视化页面/quiz-file-store.js'), 'utf8');
const deferred = () => {let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {for(let i=0;i<100;i++){if(predicate())return;await tick();}throw new Error('condition did not settle');}
const record = n => ({version:1,n});
function validate(raw) {if(!raw||raw.version!==1||!Number.isInteger(raw.n))throw new Error('invalid record');return {version:1,n:raw.n};}
function fakeIDB(memory, events, options={}) {
  const db = {objectStoreNames:{contains:()=>true},close(){},createObjectStore(){},
    transaction(_name,mode) {
      const transaction = {error:null};
      transaction.objectStore = () => {
        function request(kind,value,key) {
          const req = {};
          queueMicrotask(async () => {
            events.push('idb:'+kind);
            if(options.gatePut && kind==='put')await options.gatePut.promise;
            if(options.failPut && kind==='put') {transaction.error=new Error('IDB unavailable');transaction.onerror?.();return;}
            if(kind==='put')memory.set(key,value);
            if(kind==='delete')memory.delete(key);
            req.result=kind==='get'?memory.get(key):undefined;req.onsuccess?.();transaction.oncomplete?.();
          });
          return req;
        }
        return {get:key=>request('get',null,key),put:(value,key)=>request('put',value,key),delete:key=>request('delete',null,key)};
      };
      return transaction;
    }};
  return {open(){events.push('idb:open');const req={};queueMicrotask(()=>{req.result=db;req.onsuccess?.();});return req;}};
}
function environment(options={}) {
  const events=[], statuses=[], memory=new Map(), tracker={active:0,max:0,commits:[]};
  const win={isSecureContext:options.secure!==false,showSaveFilePicker:()=>{throw new Error('picker not configured');},showOpenFilePicker:()=>{throw new Error('picker not configured');}};
  if(options.idb!==false)win.indexedDB=fakeIDB(memory,events,options);
  vm.runInNewContext(source,{window:win,Blob,Promise,Date,JSON,Object,Array,Number,TypeError,Error});
  const api=win.QuizFileStore.create({validate,onStatus:s=>{statuses.push(s);options.onStatus?.(s);}});
  return {win,api,events,statuses,memory,tracker};
}
function handle(env,name,content='',options={}) {
  const h={kind:'file',name,content,permission:options.permission||'granted',getCalls:0,textCalls:0,requestCalls:0,createCalls:0,abortCalls:0,
    async getFile(){this.getCalls++;env.events.push('get:'+name);if(options.getGate)await options.getGate.promise;const text=this.content;return {name,size:options.size??Buffer.byteLength(text),text:async()=>{this.textCalls++;return text;}};},
    async queryPermission(){env.events.push('query:'+name);return this.permission;},
    async requestPermission(){this.requestCalls++;env.events.push('request:'+name);this.permission=options.requestResult||'granted';return this.permission;},
    async createWritable(){
      this.createCalls++;env.events.push('create:'+name);
      if(options.failCreate)throw new Error('create failed');
      env.tracker.active++;env.tracker.max=Math.max(env.tracker.max,env.tracker.active);
      let output='',done=false;
      const finish=()=>{if(!done){done=true;env.tracker.active--;}};
      return {write:async text=>{output=text;env.events.push('write:'+name);if(options.writeGate)await options.writeGate.promise;if(options.failWrite)throw new Error('write failed');},
        close:async()=>{env.events.push('close:'+name);if(options.closeGate)await options.closeGate.promise;if(options.failClose){options.failClose=false;throw new Error('close failed');}this.content=output;env.tracker.commits.push({name,record:JSON.parse(output)});finish();},
        abort:async()=>{this.abortCalls++;env.events.push('abort:'+name);finish();}};
    }};
  return h;
}
async function acceptNew(env,h) {env.win.showSaveFilePicker=()=>{env.events.push('save-picker');return Promise.resolve(h);};const candidate=await env.api.chooseNew();assert.equal(candidate.name,h.name);assert.equal(await env.api.acceptCandidate(),true);}
const tests=[];
function test(name,body){tests.push([name,body]);}

test('unsupported performs no file or IDB work',async()=>{
  const env=environment({secure:false});assert.equal(env.api.supported,false);assert.equal(await env.api.initialize(),null);assert.equal(await env.api.save(record(1)),false);assert.deepEqual(env.events,[]);assert.equal(env.statuses.at(-1).phase,'unsupported');
});
test('picker first, candidate never writes, explicit accept then save',async()=>{
  const env=environment(),h=handle(env,'第一章-作答记录.json');
  env.win.showSaveFilePicker=options=>{assert.equal(options.suggestedName,'第一章-作答记录.json');env.events.push('save-picker');return Promise.resolve(h);};
  const candidate=await env.api.chooseNew();assert.equal(candidate.record,null);assert.equal(env.events[0],'save-picker');assert.equal(await env.api.save(record(1)),false);assert.equal(h.createCalls,0);
  assert.equal(await env.api.acceptCandidate(),true);assert.equal(h.content,'');assert.equal(h.createCalls,0);assert.equal(await env.api.save(record(2)),true);assert.equal(JSON.parse(h.content).n,2);assert.equal(env.statuses.at(-1).phase,'saved');assert.ok(env.statuses.at(-1).savedAt);assert.equal(env.statuses.at(-1).remembered,true);
});
test('nonempty valid file is candidate data, not overwritten by selection/accept',async()=>{
  const env=environment(),h=handle(env,'existing.json',JSON.stringify(record(4)));
  env.win.showOpenFilePicker=()=>Promise.resolve([h]);const candidate=await env.api.chooseExisting();assert.equal(candidate.record.n,4);await env.api.acceptCandidate();assert.equal(JSON.parse(h.content).n,4);assert.equal(h.createCalls,0);await env.api.save(record(5));assert.equal(JSON.parse(h.content).n,5);
});
test('invalid, nonempty whitespace, BOM-only and oversized files preserve old connection',async()=>{
  const env=environment(),good=handle(env,'good.json');await acceptNew(env,good);
  for(const value of ['broken','   ','\uFEFF',JSON.stringify({version:9,n:3})]) {
    const bad=handle(env,'bad.json',value);env.win.showOpenFilePicker=()=>Promise.resolve([bad]);await assert.rejects(env.api.chooseExisting());assert.equal(await env.api.acceptCandidate(),false);assert.equal(bad.createCalls,0);assert.equal(bad.content,value);
  }
  const big=handle(env,'big.json','',{size:10000001});env.win.showOpenFilePicker=()=>Promise.resolve([big]);await assert.rejects(env.api.chooseExisting(),/10 MB/);assert.equal(big.textCalls,0);assert.equal(await env.api.save(record(6)),true);assert.equal(JSON.parse(good.content).n,6);
});
test('initialize only queries permission, reconnect directly requests and yields candidate',async()=>{
  const env=environment(),h=handle(env,'remembered.json',JSON.stringify(record(7)),{permission:'prompt'});env.memory.set('current',h);
  assert.equal(await env.api.initialize(),null);assert.equal(h.requestCalls,0);assert.equal(env.statuses.at(-1).phase,'permission');env.events.length=0;
  const candidate=await env.api.reconnect();assert.equal(env.events[0],'request:remembered.json');assert.equal(candidate.record.n,7);assert.equal(h.createCalls,0);assert.equal(await env.api.save(record(8)),false);await env.api.acceptCandidate();assert.equal(JSON.parse(h.content).n,7);
});
test('initialize granted remembered file still requires accept',async()=>{
  const env=environment(),h=handle(env,'remembered.json',JSON.stringify(record(8)));env.memory.set('current',h);
  const candidate=await env.api.initialize();assert.equal(candidate.record.n,8);assert.equal(h.requestCalls,0);assert.equal(h.createCalls,0);assert.equal(await env.api.save(record(9)),false);env.api.cancelCandidate();assert.equal(await env.api.acceptCandidate(),false);
});
test('autosave preserves pending remembered permission and reconnect remains available',async()=>{
  const env=environment(),h=handle(env,'restore.json',JSON.stringify(record(7)),{permission:'prompt'});env.memory.set('current',h);
  assert.equal(await env.api.initialize(),null);assert.equal(env.statuses.at(-1).phase,'permission');assert.equal(await env.api.save(record(8)),false);assert.equal(env.statuses.at(-1).phase,'permission');assert.equal(env.statuses.at(-1).remembered,true);assert.equal(h.requestCalls,0);
  const candidate=await env.api.reconnect();assert.equal(candidate.record.n,7);assert.equal(await env.api.acceptCandidate(),true);assert.equal(await env.api.save(record(8)),true);assert.equal(JSON.parse(h.content).n,8);
});
test('IndexedDB failure permits session-only saving with explicit status',async()=>{
  const env=environment({idb:false}),h=handle(env,'session.json');await acceptNew(env,h);assert.equal(env.statuses.at(-1).remembered,false);assert.match(env.statuses.at(-1).detail,/本次会话/);assert.equal(await env.api.save(record(10)),true);
});
test('coalescing writes A then latest C, never overlaps or reports queued B saved',async()=>{
  const env=environment(),gate=deferred(),h=handle(env,'queue.json','',{closeGate:gate});await acceptNew(env,h);
  const a=env.api.save(record(1));await until(()=>env.events.includes('close:queue.json'));
  const b=env.api.save(record(2)),c=env.api.save(record(3));assert.equal(h.createCalls,1);gate.resolve();assert.deepEqual(await Promise.all([a,b,c]),[true,true,true]);
  assert.deepEqual(env.tracker.commits.map(x=>x.record.n),[1,3]);assert.equal(env.tracker.max,1);assert.equal(env.statuses.filter(s=>s.phase==='saved').length,1);assert.equal(JSON.parse(h.content).n,3);
});
test('save snapshots are immutable after the call',async()=>{
  const env=environment(),h=handle(env,'clone.json');await acceptNew(env,h);const input=record(11);const pending=env.api.save(input);input.n=99;assert.equal(await pending,true);assert.equal(JSON.parse(h.content).n,11);
});
test('save queued from saved-status microtask starts a fresh drain',async()=>{
  let env,second,scheduled=false;
  env=environment({onStatus:status=>{if(status.phase==='saved'&&!scheduled){scheduled=true;Promise.resolve().then(()=>{second=env.api.save(record(2));});}}});
  const h=handle(env,'microtask.json');await acceptNew(env,h);assert.equal(await env.api.save(record(1)),true);await until(()=>second);assert.equal(await second,true);assert.deepEqual(env.tracker.commits.map(x=>x.record.n),[1,2]);assert.equal(env.tracker.max,1);assert.equal(JSON.parse(h.content).n,2);
});
test('close failure aborts, keeps latest pending and reports saved only after retry close',async()=>{
  const env=environment(),gate=deferred(),h=handle(env,'retry.json','',{closeGate:gate,failClose:true});await acceptNew(env,h);
  const a=env.api.save(record(1));await until(()=>env.events.includes('close:retry.json'));const c=env.api.save(record(3));gate.resolve();assert.deepEqual(await Promise.all([a,c]),[false,false]);assert.equal(h.content,'');assert.equal(h.abortCalls,1);assert.equal(env.statuses.at(-1).phase,'error');assert.equal(env.statuses.filter(s=>s.phase==='saved').length,0);
  assert.equal(await env.api.save(record(3)),true);assert.equal(JSON.parse(h.content).n,3);assert.equal(env.statuses.at(-1).phase,'saved');
});
test('permission denied during autosave retains file and never requests permission',async()=>{
  const env=environment(),h=handle(env,'permission.json');await acceptNew(env,h);h.permission='prompt';assert.equal(await env.api.save(record(12)),false);assert.equal(h.createCalls,0);assert.equal(h.requestCalls,0);assert.equal(h.content,'');assert.equal(env.statuses.at(-1).phase,'permission');
});
test('disconnect mid-close never publishes stale saved and next handle waits',async()=>{
  const env=environment(),gate=deferred(),aHandle=handle(env,'old.json','',{closeGate:gate}),bHandle=handle(env,'new.json');await acceptNew(env,aHandle);
  const a=env.api.save(record(1));await until(()=>env.events.includes('close:old.json'));await env.api.disconnect();await acceptNew(env,bHandle);const b=env.api.save(record(2));await tick();assert.equal(bHandle.createCalls,0);gate.resolve();assert.equal(await a,false);assert.equal(await b,true);assert.equal(env.tracker.max,1);assert.equal(env.statuses.filter(s=>s.phase==='saved'&&s.name==='old.json').length,0);assert.equal(JSON.parse(bHandle.content).n,2);
});
test('reaccepting the same file also serializes stale close before latest write',async()=>{
  const env=environment(),gate=deferred(),h=handle(env,'same.json','',{closeGate:gate});await acceptNew(env,h);
  const a=env.api.save(record(1));await until(()=>env.events.includes('close:same.json'));await env.api.disconnect();await acceptNew(env,h);const b=env.api.save(record(3));await tick();assert.equal(h.createCalls,1);gate.resolve();assert.equal(await a,false);assert.equal(await b,true);assert.equal(env.tracker.max,1);assert.equal(JSON.parse(h.content).n,3);
});
test('IDB put/delete ordering prevents late accept resurrecting disconnected handle',async()=>{
  const gate=deferred(),env=environment({gatePut:gate}),h=handle(env,'remember.json');env.win.showSaveFilePicker=()=>Promise.resolve(h);await env.api.chooseNew();const accepted=env.api.acceptCandidate();await until(()=>env.events.includes('idb:put'));const disconnected=env.api.disconnect();gate.resolve();assert.equal(await accepted,false);await disconnected;assert.equal(env.memory.has('current'),false);assert.equal(h.createCalls,0);
});
test('cancel and a newer selection invalidate a pending picker/read',async()=>{
  const env=environment(),picker=deferred(),old=handle(env,'cancel.json');env.win.showSaveFilePicker=()=>picker.promise;const task=env.api.chooseNew();env.api.cancelCandidate();picker.resolve(old);assert.equal(await task,null);assert.equal(await env.api.acceptCandidate(),false);assert.equal(old.createCalls,0);
  const readGate=deferred(),slow=handle(env,'slow.json','',{getGate:readGate}),fast=handle(env,'fast.json');env.win.showSaveFilePicker=()=>Promise.resolve(slow);const first=env.api.chooseNew();await until(()=>slow.getCalls===1);env.win.showOpenFilePicker=()=>Promise.resolve([fast]);assert.equal((await env.api.chooseExisting()).name,'fast.json');readGate.resolve();assert.equal(await first,null);assert.equal(await env.api.acceptCandidate(),true);await env.api.save(record(14));assert.equal(slow.createCalls,0);assert.equal(JSON.parse(fast.content).n,14);
});
test('picker AbortError is cancellation, not activation or file error',async()=>{
  const env=environment();env.win.showSaveFilePicker=()=>Promise.reject(Object.assign(new Error('cancelled'),{name:'AbortError'}));assert.equal(await env.api.chooseNew(),null);assert.equal(await env.api.acceptCandidate(),false);assert.equal(env.statuses.some(s=>s.phase==='error'),false);
});

(async()=>{let passed=0;for(const [name,body] of tests){await body();passed++;process.stdout.write('PASS '+name+'\n');}process.stdout.write(JSON.stringify({passed,failed:0,realFileAccess:false,UIAccess:false})+'\n');})().catch(error=>{console.error(error);process.exitCode=1;});
