import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import worker,{CodexLabRelay} from '../worker/index.js';
import {PAGE} from '../worker/page.js';
import {createScheduleService} from '../assistant/schedule.mjs';
const DEVICE='imx6ull_temp_led_01';
const NOW=Date.parse('2026-11-02T08:00:00+08:00');
function peer(meta){return {meta,readyState:1,messages:[],send(raw){this.messages.push(JSON.parse(raw))},deserializeAttachment(){return this.meta},serializeAttachment(value){this.meta=value}}}
function fixture(){
  const panel=peer({role:'mini_panel',id:DEVICE}),otherPanel=peer({role:'mini_panel',id:DEVICE}),cloud=peer({role:'cloud',id:'cloud'});
  const relay=Object.create(CodexLabRelay.prototype);
  const sockets={cloud:[cloud],'mini:panel':[panel,otherPanel],'mini:board':[]};
  relay.ctx={getWebSockets:tag=>sockets[tag]||[]};
  return {relay,panel,otherPanel,cloud,sockets};
}
test('saved local schedules reach authenticated panels without a connected board',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'calendar-sync-'));
  try{
    const service=createScheduleService({file:join(dir,'日程.md'),now:()=>NOW});
    const {relay,panel,otherPanel,cloud}=fixture();
    await relay.webSocketMessage(panel,JSON.stringify({type:'schedule_get',device_id:DEVICE}));
    assert.equal(cloud.messages[0].type,'schedule_request');
    await relay.webSocketMessage(panel,JSON.stringify({type:'schedule_get',device_id:DEVICE}));
    assert.equal(cloud.messages.length,1);
    assert.match(await service.reply({action:'add',description:'明天下午三点开会'}),/已保存/);
    await relay.webSocketMessage(cloud,JSON.stringify({type:'schedule_state',...service.snapshot()}));
    for(const target of [panel,otherPanel]){
      const state=target.messages.at(-1);
      assert.equal(state.type,'schedule_state');assert.equal(state.device_id,DEVICE);
      assert.equal(state.items[0].title,'开会');assert.equal(state.items[0].startsAt,'2026-11-03T15:00:00+08:00');
      assert.equal(state.ok,true);assert.equal('file' in state,false);
    }
    const afterRestart=createScheduleService({file:join(dir,'日程.md'),now:()=>NOW});
    assert.deepEqual(afterRestart.snapshot().items,service.snapshot().items);
    assert.equal(createScheduleService({file:join(dir,'日程.md'),now:()=>NOW+2*86400000}).snapshot().total,0);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
test('device and panel cannot publish schedules; malformed or retired cloud data is rejected',async()=>{
  const {relay,panel,cloud}=fixture();
  const good={type:'schedule_state',ok:true,items:[{id:'test1',startsAt:'2026-11-03T15:00:00+08:00',title:'开会'}],total:1};
  for(const sender of [panel,peer({role:'device'}),peer({role:'cloud',retired:true})])await relay.webSocketMessage(sender,JSON.stringify(good));
  assert.equal(panel.messages.length,0);
  for(const bad of [{...good,items:[{...good.items[0],title:'x'.repeat(181)}]},{...good,total:0},{...good,items:[{...good.items[0],startsAt:'wrong'}]}])await relay.webSocketMessage(cloud,JSON.stringify(bad));
  assert.equal(panel.messages.length,0);
  await relay.webSocketMessage(cloud,JSON.stringify({type:'schedule_state',ok:false,items:[],total:0}));
  assert.equal(panel.messages.at(-1).ok,false);assert.deepEqual(panel.messages.at(-1).items,[]);
});
test('calendar offline is reported independently of board status',async()=>{
  const {relay,panel,cloud,sockets}=fixture();sockets.cloud=[];
  await relay.webSocketMessage(panel,JSON.stringify({type:'schedule_get',device_id:DEVICE}));
  assert.deepEqual(panel.messages.at(-1),{device_id:DEVICE,type:'schedule_status',online:false});
  await relay.webSocketClose(cloud);
  assert.equal(panel.messages.at(-1).online,false);
});
test('page renders local schedule titles as text and clears them on loss of sync',async()=>{
  const script=PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);
  const elements=new Map();
  function element(){return {children:[],_text:'',set textContent(v){this._text=v;this.children=[]},get textContent(){return this._text},appendChild(v){this.children.push(v)}}}
  const dom={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement:()=>element()};
  const snippet=script.slice(script.indexOf('function clearSchedule('),script.indexOf('function $(id)'));
  const context=vm.createContext({document:dom,Intl,Date,scheduleAt:0,$:id=>dom.getElementById(id),clock:()=> '08:00:00'});
  vm.runInContext(snippet,context);
  context.payload={ok:true,items:[{startsAt:'2026-11-03T15:00:00+08:00',title:'<img src=x onerror=alert(1)>'}],total:1};
  vm.runInContext('renderSchedule(payload)',context);
  assert.match(dom.getElementById('scheduleList').children[0].textContent,/<img src=x/);
  vm.runInContext('clearSchedule("电脑离线")',context);
  assert.equal(dom.getElementById('scheduleList').children.length,0);
  assert.equal(dom.getElementById('scheduleStatus').textContent,'电脑离线');
  for(const path of ['/mini','/panel'])assert.match(await (await worker.fetch(new Request('https://lab.test'+path))).text(),/我的日程/);
  assert.equal((await worker.fetch(new Request('https://lab.test/mini/ws?kind=panel'))).status,426);
});
