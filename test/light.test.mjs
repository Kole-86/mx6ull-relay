import test from 'node:test';
import assert from 'node:assert/strict';
import {createMiniPanel,toLightReceipt} from '../assistant/mini_panel.mjs';
import {deviceIntent,deviceReply} from '../assistant/device_intents.mjs';
import {routeUtterance} from '../assistant/route.mjs';

test('light requests use fresh board telemetry, including zero, and reject missing or stale readings',async()=>{
  let clock=10000;
  const socket={readyState:1,close(){},send(){throw Error('Light read must not send commands')}};
  const client=createMiniPanel({relayUrl:'ws://localhost/ws',deviceToken:'d'.repeat(40),reconnect:false,now:()=>clock,openSocket:()=>socket});
  const push=msg=>socket.onmessage({data:JSON.stringify({device_id:'imx6ull_temp_led_01',...msg})});
  const state=value=>push({type:'mini_state',temperature_c:36.2,led_on:false,led_mode:'steady',illuminance_lux:value});
  socket.onopen();
  try{
    for(const phrase of ['现在光照多少','现在光照多少度','读取板子上的光照','查询光照强度','当前照度是多少'])assert.equal(deviceIntent(phrase)?.action,'read_light');
    for(const phrase of ['北京光照多少','为什么光照这么低','如果光照低就开灯','不要读取光照'])assert.equal(deviceIntent(phrase),null);
    for(const value of [80.6,0,30000]){
      state(value);
      assert.deepEqual(await client.transport({action:'read_light'}),{ok:true,illuminance_lux:value});
      assert.equal((await routeUtterance('现在光照多少',client.transport)).text,'当前光照'+value.toFixed(1)+'勒克斯。');
    }
    clock+=7000;
    assert.equal((await client.transport({action:'read_light'})).reason,'stale');
    assert.match(await deviceReply({action:'read_light'},client.transport),/没有确认/);
    for(const value of [undefined,null,-1,30001,'80.6',Infinity,NaN]){
      state(value);
      assert.equal((await client.transport({action:'read_light'})).ok,false);
      assert.match(await deviceReply({action:'read_light'},client.transport),/没有确认/);
      assert.equal((await client.transport({action:'read_temperature'})).temperature_c,36.2);
    }
    state(42.5);
    push({type:'mini_state',device_id:'wrong-board',temperature_c:36.2,illuminance_lux:999,led_on:false,led_mode:'steady'});
    assert.equal((await client.transport({action:'read_light'})).illuminance_lux,42.5);
    push({type:'mini_status',online:false});
    assert.equal((await client.transport({action:'read_light'})).reason,'offline');
    assert.match(await deviceReply({action:'read_light'},client.transport),/没有确认/);
    assert.equal(toLightReceipt({receivedAt:clock,illuminance_lux:NaN},clock).ok,false);
  }finally{client.close()}
});
