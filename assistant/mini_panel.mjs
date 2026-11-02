import { randomBytes } from 'node:crypto';

const DEVICE_ID='imx6ull_temp_led_01';
const FRESH_MS=7000;
const COMMAND_TIMEOUT_MS=8000;

export function loadDeviceToken(text){
  let token='';
  for(const line of String(text).split(/\r?\n/)){
    const matched=line.match(/^\s*LAB_DEVICE_TOKEN\s*=\s*(.*)$/);
    if(matched)token=matched[1].trim().replace(/^['"]|['"]$/g,'');
  }
  if(!/^[A-Za-z0-9_.~-]{32,512}$/.test(token))throw new Error('缺少设备口令，未连接硬件通道。');
  return token;
}

export function panelUrl(relayUrl){
  const url=new URL(relayUrl);
  const local=url.protocol==='ws:'&&(url.hostname==='127.0.0.1'||url.hostname==='localhost');
  const remote=url.protocol==='wss:'&&!!url.hostname&&!url.username&&!url.password;
  if(!local&&!remote)throw new Error('请配置自己的 WSS 中转站地址。');
  url.username='';url.password='';url.pathname='/mini/ws';url.search='';url.hash='';
  url.searchParams.set('kind','panel');
  return url;
}

export function hasFreshHardware(state,now,freshMs=FRESH_MS){
  if(!state||now-state.receivedAt>=freshMs)return false;
  const tempOk=typeof state.temperature_c==='number'&&Number.isFinite(state.temperature_c)&&state.temperature_c>=-40&&state.temperature_c<=150;
  return tempOk||validLight(state.illuminance_lux)||typeof state.led_on==='boolean';
}

function validLight(value){
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=30000;
}

export function toLightReceipt(state,now,freshMs=FRESH_MS){
  if(!state)return {ok:false,reason:'offline'};
  if(now-state.receivedAt>=freshMs)return {ok:false,reason:'stale'};
  if(!validLight(state.illuminance_lux))return {ok:false,reason:'invalid'};
  return {ok:true,illuminance_lux:state.illuminance_lux};
}

export function toTemperatureReceipt(state,now,freshMs=FRESH_MS){
  if(!state)return {ok:false,reason:'offline'};
  if(now-state.receivedAt>=freshMs)return {ok:false,reason:'stale'};
  if(typeof state.temperature_c!=='number'||!Number.isFinite(state.temperature_c)||state.temperature_c<-40||state.temperature_c>150)return {ok:false,reason:'invalid'};
  return {ok:true,temperature_c:state.temperature_c};
}

// Worker receipts say led_on. The voice reply checks led. Keep that mapping explicit.
export function toDeviceReceipt(msg){
  if(!msg||typeof msg!=='object')return {ok:false,reason:'empty'};
  return {ok:msg.ok===true,led:msg.led_on,reason:typeof msg.reason==='string'?msg.reason:undefined};
}

function acceptState(msg,deviceId,receivedAt){
  if(msg.device_id!==deviceId)return null;
  const tempOk=msg.temperature_c===null||(typeof msg.temperature_c==='number'&&Number.isFinite(msg.temperature_c)&&msg.temperature_c>=-40&&msg.temperature_c<=150);
  const ledOk=msg.led_on===null||typeof msg.led_on==='boolean';
  if(!tempOk||!ledOk||!['steady','nonsteady','error'].includes(msg.led_mode))return null;
  return {temperature_c:msg.temperature_c,illuminance_lux:validLight(msg.illuminance_lux)?msg.illuminance_lux:null,led_on:msg.led_on,led_mode:msg.led_mode,receivedAt};
}

export function createMiniPanel(options){
  const deviceId=options.deviceId||DEVICE_ID;
  const freshMs=options.freshMs??FRESH_MS;
  const commandTimeoutMs=options.commandTimeoutMs??COMMAND_TIMEOUT_MS;
  const reconnect=options.reconnect!==false;
  const initialBackoff=options.retryMs??500;
  const now=options.now||(()=>Date.now());
  const openSocket=options.openSocket||((url,protocols)=>new WebSocket(url,protocols));
  const target=panelUrl(options.relayUrl);
  if(!/^[A-Za-z0-9_.~-]{32,512}$/.test(options.deviceToken||''))throw new Error('缺少设备口令，未连接硬件通道。');
  let socket=null,online=false,state=null,stopped=false,backoff=initialBackoff,retryTimer=null,opened=false;
  let markOpen=()=>{};
  const whenOpen=new Promise(resolve=>{markOpen=resolve});
  const pending=new Map();
  function failPending(reason){
    for(const [id,item] of pending){clearTimeout(item.timer);pending.delete(id);item.resolve({ok:false,reason})}
  }
  function scheduleReconnect(){
    if(stopped||!reconnect)return;
    clearTimeout(retryTimer);
    const wait=backoff;
    backoff=Math.min(30000,Math.max(wait*2,wait+1));
    retryTimer=setTimeout(connect,wait);
  }
  function handle(raw){
    let msg;try{msg=JSON.parse(raw)}catch{return}
    if(!msg||typeof msg!=='object')return;
    if(msg.type==='mini_status'){
      if(msg.device_id!==deviceId)return;
      online=msg.online===true;
      if(!online)state=null;
      return;
    }
    if(msg.type==='mini_state'){
      const next=acceptState(msg,deviceId,now());
      if(!next)return;
      state=next;online=true;return;
    }
    if(msg.type==='mini_result'){
      const item=pending.get(msg.request_id);
      if(!item)return;
      pending.delete(msg.request_id);clearTimeout(item.timer);item.resolve(toDeviceReceipt(msg));
    }
  }
  function connect(){
    if(stopped||socket)return;
    const ws=openSocket(target.href,['codex-lab.v1','auth.'+options.deviceToken]);
    socket=ws;let settled=false;
    const finish=reason=>{
      if(settled)return;
      settled=true;
      if(socket===ws)socket=null;
      online=false;state=null;failPending(reason);
      try{ws.close()}catch{}
      scheduleReconnect();
    };
    ws.onopen=()=>{
      if(stopped||settled){try{ws.close()}catch{}return}
      backoff=initialBackoff;
      if(!opened){opened=true;markOpen()}
    };
    ws.onmessage=event=>{if(!settled&&typeof event?.data==='string')handle(event.data)};
    ws.onerror=()=>finish('disconnected');
    ws.onclose=()=>finish('disconnected');
  }
  function boardConnected(){return socket?.readyState===1&&online&&hasFreshHardware(state,now(),freshMs)}
  async function transport(intent){
    if(intent?.action==='read_light'){
      if(socket?.readyState!==1||!online)return {ok:false,reason:'offline'};
      return toLightReceipt(state,now(),freshMs);
    }
    if(intent?.action==='read_temperature'){
      if(socket?.readyState!==1||!online)return {ok:false,reason:'offline'};
      return toTemperatureReceipt(state,now(),freshMs);
    }
    if(intent?.action!=='set_led'||typeof intent.value!=='boolean')return {ok:false,reason:'unsupported'};
    if(socket?.readyState!==1||!online)return {ok:false,reason:'offline'};
    if(pending.size)return {ok:false,reason:'busy'};
    const request_id='vled_'+randomBytes(16).toString('hex');
    const command={type:'mini_command',device_id:deviceId,request_id,command:'set_led',value:intent.value};
    return await new Promise(resolve=>{
      const timer=setTimeout(()=>{if(!pending.has(request_id))return;pending.delete(request_id);resolve({ok:false,reason:'timeout'})},commandTimeoutMs);
      pending.set(request_id,{resolve,timer});
      try{socket.send(JSON.stringify(command))}catch{clearTimeout(timer);pending.delete(request_id);resolve({ok:false,reason:'disconnected'})}
    });
  }
  connect();
  return {
    transport,boardConnected,whenOpen,url:target,
    snapshot:()=>({open:socket?.readyState===1,online,state,pending:pending.size}),
    close(){stopped=true;clearTimeout(retryTimer);const ws=socket;socket=null;online=false;state=null;failPending('closed');if(ws){ws.onclose=null;ws.onerror=null;ws.onmessage=null;try{ws.close()}catch{}}}
  };
}
