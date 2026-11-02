import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexLabRelay} from '../worker/base/panel-worker.js';
import {createMiniPanel} from '../assistant/mini_panel.mjs';
import {routeUtterance} from '../assistant/route.mjs';

test('existing Worker forwards the same light reading to web and voice clients',async()=>{
  // Exercise the actual existing Worker message handler with in-memory sockets.
  // No Worker runtime constructor or deployed configuration is changed.
  const socket={readyState:1,close(){},send(){throw Error('Read-only query')}};
  const voice=createMiniPanel({relayUrl:'ws://localhost/ws',deviceToken:'d'.repeat(40),reconnect:false,openSocket:()=>socket});
  const webMessages=[];
  let attachment={role:'mini_board',id:'imx6ull_temp_led_01'};
  const board={readyState:1,deserializeAttachment:()=>attachment,serializeAttachment:value=>{attachment=value}};
  const web={readyState:1,send:raw=>webMessages.push(JSON.parse(raw))};
  const voicePeer={readyState:1,send:raw=>socket.onmessage({data:raw})};
  const relay=Object.create(CodexLabRelay.prototype);
  relay.ctx={getWebSockets:tag=>tag==='mini:panel'?[web,voicePeer]:tag==='mini:board'?[board]:[]};
  socket.onopen();
  try{
    for(const lux of [80.6,0,null]){
      await relay.webSocketMessage(board,JSON.stringify({type:'mini_state',device_id:'imx6ull_temp_led_01',temperature_c:36.2,illuminance_lux:lux,led_on:false,led_mode:'steady'}));
      assert.equal(webMessages.at(-1).illuminance_lux,lux);
      const reply=await routeUtterance('现在光照多少',voice.transport);
      assert.equal(reply.kind,'device');
      if(lux===null)assert.match(reply.text,/没有确认/);
      else assert.equal(reply.text,'当前光照'+lux.toFixed(1)+'勒克斯。');
      assert.equal((await routeUtterance('现在温度多少度',voice.transport)).text,'当前芯片温度36.2摄氏度。');
    }
    socket.onmessage({data:JSON.stringify({type:'mini_status',device_id:'imx6ull_temp_led_01',online:false})});
    assert.match((await routeUtterance('现在光照多少',voice.transport)).text,/没有确认/);
  }finally{voice.close()}
});
