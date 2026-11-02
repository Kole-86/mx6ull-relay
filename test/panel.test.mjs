import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceIntent, deviceReply } from '../assistant/device_intents.mjs';
import { routeUtterance, voiceModelContext } from '../assistant/route.mjs';
import { createMiniPanel, loadDeviceToken, panelUrl, toDeviceReceipt } from '../assistant/mini_panel.mjs';
import { ResponsiveVoiceCore } from '../core/responsive_core.mjs';

const TOKEN='d'.repeat(40);
const DEVICE='imx6ull_temp_led_01';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fake(){
  return {
    readyState:0,sent:[],
    send(data){this.sent.push(JSON.parse(data))},
    close(){this.readyState=3;this.onclose?.()},
    fireOpen(){this.readyState=1;this.onopen?.()},
    fireClose(){this.readyState=3;this.onclose?.()},
    push(obj){this.onmessage?.({data:JSON.stringify(obj)})}
  };
}
function panel(extra={}){
  const socket=fake();
  let clock=10_000;
  const client=createMiniPanel({relayUrl:'ws://127.0.0.1:18789/ws',deviceToken:TOKEN,reconnect:false,now:()=>clock,openSocket:()=>socket,...extra});
  return {socket,client,setTime(value){clock=value}};
}
function online(socket,state){
  socket.fireOpen();
  socket.push({type:'mini_status',device_id:DEVICE,online:true});
  if(state)socket.push({type:'mini_state',device_id:DEVICE,...state});
}

test('simple LED and temperature phrases route to hardware; negation and discussion do not',()=>{
  for(const s of ['开灯','请打开LED。','帮我把板子上的LED打开一下'])assert.deepEqual(deviceIntent(s),{action:'set_led',value:true});
  for(const s of ['关灯','关闭指示灯','请把LED关掉'])assert.deepEqual(deviceIntent(s),{action:'set_led',value:false});
  for(const s of ['现在温度多少度','查询温度','当前的温度是多少'])assert.equal(deviceIntent(s)?.action,'read_temperature');
  for(const s of ['不要开灯','如果我说开灯你会怎么办','开灯还是关灯','先开灯再关灯','为什么现在温度高','北京温度多少'])assert.equal(deviceIntent(s),null);
});

test('spoken success uses the read-back field led, and names the chip temperature',async()=>{
  assert.equal(await deviceReply({action:'set_led',value:true},async()=>({ok:true,led:true})),'灯已打开。');
  assert.equal(await deviceReply({action:'set_led',value:false},async()=>({ok:true,led:false})),'灯已关闭。');
  assert.match(await deviceReply({action:'set_led',value:true},async()=>({ok:true,led_on:true})),/不一致/);
  assert.equal(await deviceReply({action:'read_temperature'},async()=>({ok:true,temperature_c:36.2})),'当前芯片温度36.2摄氏度。');
  assert.doesNotMatch(await deviceReply({action:'read_temperature'},async()=>({ok:true,temperature_c:36.2})),/室温/);
  assert.equal(await deviceReply({action:'read_temperature'},async()=>({ok:false,temperature_c:36.2})),'没有确认到当前芯片温度。');
  assert.equal(await deviceReply({action:'read_temperature'},async()=>({ok:true,temperature_c:null})),'没有确认到当前芯片温度。');
  assert.match(await deviceReply({action:'set_led',value:true}),/未接入/);
  assert.equal(await deviceReply({action:'read_light'},async()=>({ok:true,illuminance_lux:80.6})),'当前光照80.6勒克斯。');
  assert.deepEqual(toDeviceReceipt({ok:true,led_on:false,request_id:'vled_x'}),{ok:true,led:false,reason:undefined});
});

test('panel URL supports a user TLS relay and rejects insecure public URLs',()=>{
  assert.equal(panelUrl('wss://relay.example.test/ws').href,'wss://relay.example.test/mini/ws?kind=panel');
  assert.equal(panelUrl('ws://127.0.0.1:18789/ws').protocol,'ws:');
  assert.throws(()=>panelUrl('https://relay.example.test/mini'),/配置自己的 WSS/);
  const token=loadDeviceToken('LAB_BRIDGE_TOKEN="b'.repeat(1)+'"\nLAB_DEVICE_TOKEN="' + 'd'.repeat(40) + '"\n');
  assert.equal(token,'d'.repeat(40));
  assert.throws(()=>loadDeviceToken('LAB_BRIDGE_TOKEN="'+'b'.repeat(40)+'"\n'),/设备口令/);
});

test('LED commands use an explicit value and a hardware request id, and a repeat does not invert the lamp',async()=>{
  const {socket,client}=panel();
  online(socket,{temperature_c:36.2,led_on:false,led_mode:'steady',observed_at:'t'});
  const first=client.transport({action:'set_led',value:true,device_id:'maixcam',message_id:'maix-msg-1'});
  const second=await client.transport({action:'set_led',value:false,message_id:'maix-msg-2'});
  assert.equal(socket.sent.length,1);
  assert.equal(socket.sent[0].type,'mini_command');
  assert.equal(socket.sent[0].device_id,DEVICE);
  assert.equal(socket.sent[0].command,'set_led');
  assert.equal(socket.sent[0].value,true);
  assert.notEqual(socket.sent[0].request_id,'maix-msg-1');
  assert.match(socket.sent[0].request_id,/^vled_[0-9a-f]{32}$/);
  assert.equal(second.ok,false);
  assert.equal(second.reason,'busy');
  socket.push({type:'mini_result',device_id:DEVICE,request_id:socket.sent[0].request_id,ok:true,led_on:true});
  assert.deepEqual(await first,{ok:true,led:true,reason:undefined});
  const off=client.transport({action:'set_led',value:false});
  assert.equal(socket.sent[1].value,false);
  socket.push({type:'mini_result',device_id:DEVICE,request_id:socket.sent[1].request_id,ok:true,led_on:false});
  assert.equal((await off).led,false);
  assert.equal(await deviceReply({action:'set_led',value:true},async()=>await first),'灯已打开。');
  client.close();
});

test('temperature follows the newest fresh chip reading and is not spoken after it goes stale or offline',async()=>{
  const {socket,client,setTime}=panel();
  online(socket,{temperature_c:36.2,led_on:false,led_mode:'steady'});
  assert.equal(await deviceReply({action:'read_temperature'},client.transport),'当前芯片温度36.2摄氏度。');
  assert.equal(client.boardConnected(),true);
  setTime(10_000+7000);
  assert.equal(client.boardConnected(),false);
  assert.equal(await deviceReply({action:'read_temperature'},client.transport),'没有确认到当前芯片温度。');
  setTime(10_000);
  socket.push({type:'mini_state',device_id:DEVICE,temperature_c:null,led_on:false,led_mode:'steady'});
  assert.equal(await deviceReply({action:'read_temperature'},client.transport),'没有确认到当前芯片温度。');
  socket.push({type:'mini_status',device_id:DEVICE,online:false});
  const offline=client.transport({action:'set_led',value:true});
  assert.equal(socket.sent.length,0);
  assert.equal((await offline).reason,'offline');
  const context=voiceModelContext({boardConnected:()=>true},new Date('2026-11-01T00:00:00Z'));
  assert.equal(context.boardConnected,true);
  assert.equal(context.schedulerAvailable,false);
  assert.equal(voiceModelContext(client).boardConnected,false);
  assert.equal(voiceModelContext(client).schedulerAvailable,false);
  client.close();
});

test('a dropped panel connection fails the open command and does not replay it',async()=>{
  const sockets=[];
  const client=createMiniPanel({
    relayUrl:'ws://127.0.0.1:18789/ws',deviceToken:TOKEN,reconnect:true,retryMs:20,
    openSocket(){const socket=fake();sockets.push(socket);return socket}
  });
  online(sockets[0],{temperature_c:36.2,led_on:false,led_mode:'steady'});
  const pending=client.transport({action:'set_led',value:true});
  assert.equal(sockets[0].sent.length,1);
  sockets[0].fireClose();
  assert.deepEqual(await pending,{ok:false,reason:'disconnected'});
  await pause(60);
  assert.ok(sockets.length>=2);
  assert.equal(sockets[1].sent.length,0);
  client.close();
});

test('a command timeout does not become a spoken success',async()=>{
  const {socket,client}=panel({commandTimeoutMs:30});
  online(socket,{temperature_c:36.2,led_on:false,led_mode:'steady'});
  const text=await deviceReply({action:'set_led',value:true},client.transport);
  assert.match(text,/未确认/);
  assert.equal(socket.sent.length,1);
  socket.push({type:'mini_result',device_id:DEVICE,request_id:socket.sent[0].request_id,ok:true,led_on:true});
  assert.equal(socket.sent.length,1);
  client.close();
});

test('device phrases do not wait for an unrelated model answer and do not call the model',async()=>{
  let modelCalls=0,hardwareCalls=0;
  const transport=async intent=>{hardwareCalls++;if(intent.action==='read_light')return {ok:true,illuminance_lux:80.6};assert.equal(intent.action,'set_led');return {ok:true,led:true}};
  assert.equal((await routeUtterance('开灯',transport)).kind,'device');
  assert.equal((await routeUtterance('你好',transport)).kind,'quick');
  assert.equal((await routeUtterance('用一句话解释PWM',transport)).kind,'model');
  assert.equal((await routeUtterance('现在光照多少',transport)).text,'当前光照80.6勒克斯。');
  assert.equal(hardwareCalls,2);
  const sent=[];let finish;
  const pending=new Promise(resolve=>{finish=resolve});
  const core=new ResponsiveVoiceCore({speech:{},send:msg=>sent.push(msg),answer:async text=>{
    const routed=await routeUtterance(text,transport);
    if(routed.kind!=='model')return routed;
    modelCalls++;return pending;
  }});
  try{
    core.receive({type:'text',device_id:'maixcam',message_id:'slow',text:'解释PWM'});
    core.receive({type:'text',device_id:'maixcam',message_id:'fast',text:'开灯'});
    await pause(20);
    const fast=sent.find(m=>m.type==='ai_reply'&&m.reply_to==='fast');
    assert.equal(fast?.text,'灯已打开。');
    assert.equal(fast?.device_id,'maixcam');
    assert.equal(sent.some(m=>m.reply_to==='slow'&&m.type==='ai_reply'),false);
    assert.equal(modelCalls,1);
    finish({text:'PWM是一种调节功率的方式。',kind:'model'});
    await pause(20);
    assert.equal(sent.some(m=>m.type==='ai_reply'&&m.reply_to==='slow'),true);
  }finally{core.close()}
});
