export const PAGE=String.raw`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IMX 温度与 LED</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fa;color:#172b45;font:17px system-ui,sans-serif}main{max-width:540px;margin:45px auto;padding:28px;background:white;border-radius:16px;box-shadow:0 8px 28px #20395712}h1{font-size:25px;margin-top:0}.muted{color:#62738a;font-size:14px}.row{padding:22px 0;border-bottom:1px solid #e7edf3}.value{font-size:40px;font-weight:650;margin-top:10px}input,button{font:inherit;border-radius:8px;padding:12px}input{width:100%;border:1px solid #bdc9d7;margin:8px 0}button{border:0;background:#165fbe;color:white;cursor:pointer}button:disabled{background:#b5bfcc;cursor:default}.buttons{display:flex;gap:12px;margin-top:20px}.buttons button{flex:1}#off{background:#334c68}#off:disabled{background:#b5bfcc}#result{min-height:48px;font-size:15px;padding-top:16px}#connection{color:#53687f}label{display:block;font-size:14px}
</style><main><h1>IMX 温度与 LED</h1><p class="muted">设备 imx6ull_temp_led_01 · 真实硬件直通测试</p>
<form id="auth"><label for="token">新站设备口令</label><input id="token" type="password" autocomplete="off" required><button id="connect">连接</button></form>
<p id="connection" role="status">尚未连接</p><section class="row">芯片温度<div class="value" id="temperature">—</div></section><section class="row">LED 实际状态<div class="value" id="led">—</div></section>
<div class="buttons"><button id="on" disabled>开灯</button><button id="off" disabled>关灯</button></div><div id="result" role="status"></div><p class="muted" id="updated">尚未收到实时数据</p></main>
<script>
'use strict';
const DEV='imx6ull_temp_led_01',get=id=>document.getElementById(id);
let ws=null,online=false,last=0,pending=null,pendingTimer=null,heartbeat=null,lastPong=0;
const fresh=()=>online&&ws&&ws.readyState===1&&Date.now()-last<7000;
function controls(){get('on').disabled=get('off').disabled=!fresh()||!!pending;}
function clearValues(message){last=0;get('temperature').textContent='—';get('led').textContent='—';get('updated').textContent=message;controls();}
function failPending(message){if(!pending)return;clearTimeout(pendingTimer);pending=null;get('result').textContent=message;controls();}
function offline(message){online=false;clearValues(message);get('connection').textContent=message;failPending('操作结果未知：设备或连接已离线，未确认成功。');}
get('auth').onsubmit=event=>{
 event.preventDefault();const secret=get('token').value.trim();if(!secret)return;
 if(ws)ws.close();clearInterval(heartbeat);offline('正在连接…');
 const scheme=location.protocol==='https:'?'wss:':'ws:';
 const current=new WebSocket(scheme+'//'+location.host+'/mini/ws?kind=panel',['codex-lab.v1','auth.'+secret]);ws=current;get('token').value='';
 current.onopen=()=>{if(ws!==current)return;if(current.protocol!=='codex-lab.v1'){current.close();return;}get('auth').hidden=true;get('connection').textContent='已连接，等待设备';lastPong=Date.now();heartbeat=setInterval(()=>{if(ws!==current)return;if(Date.now()-lastPong>35000){current.close();return;}if(current.readyState===1)current.send('ping');},15000);};
 current.onmessage=event=>{if(ws!==current)return;if(event.data==='pong'){lastPong=Date.now();return;}let m;try{m=JSON.parse(event.data);}catch{return;}if(m.device_id!==DEV)return;
  if(m.type==='mini_status'){online=m.online===true;if(!online)offline('设备离线');else{get('connection').textContent='设备已连接，等待实时数据';controls();}}
  if(m.type==='mini_state'){online=true;last=Date.now();get('temperature').textContent=Number.isFinite(m.temperature_c)?m.temperature_c.toFixed(1)+' °C':'读取失败';get('led').textContent=m.led_mode==='steady'&&typeof m.led_on==='boolean'?(m.led_on?'开':'关'):(m.led_mode==='nonsteady'?'非稳定模式':'读取失败');get('connection').textContent='设备在线';get('updated').textContent='实时数据 · '+new Date().toLocaleTimeString();controls();}
  if(m.type==='mini_result'&&pending&&m.request_id===pending.id){const desired=pending.value;clearTimeout(pendingTimer);pending=null;get('result').textContent=m.ok===true&&m.led_on===desired?'已确认：LED '+(m.led_on?'开':'关'):'操作未成功：'+(m.reason||'实际状态不符');controls();}
 };
 current.onclose=()=>{if(ws!==current)return;clearInterval(heartbeat);get('auth').hidden=false;offline('连接已断开，请重新输入口令连接');};
 current.onerror=()=>{if(ws===current)get('connection').textContent='连接失败，请检查口令或网络';};
};
function setLed(value){if(!fresh()||pending)return;const id='mini_'+Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');pending={id,value};get('result').textContent='正在等待板子确认…';controls();ws.send(JSON.stringify({type:'mini_command',device_id:DEV,request_id:id,command:'set_led',value}));pendingTimer=setTimeout(()=>failPending('操作超时，结果未知；请查看最新实际状态。'),8000);}
get('on').onclick=()=>setLed(true);get('off').onclick=()=>setLed(false);
setInterval(()=>{if(last&&Date.now()-last>=7000){clearValues('数据已过期');get('connection').textContent='数据已过期，等待设备更新';}controls();},500);
</script></html>`;
