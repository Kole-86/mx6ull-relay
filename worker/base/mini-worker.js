// Extend only the new lab Worker; preserve the existing voice/text implementation.
import original, {CodexLabRelay as VoiceRelay} from './voice-worker.js';
import {PAGE} from './mini-page.js';
const DEVICE='imx6ull_temp_led_01';
const ID=/^[A-Za-z0-9_.-]{1,64}$/;
const response=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export default {
  fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/mini')return new Response(PAGE,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}});
    if(url.pathname==='/mini/ws'){
      const kind=url.searchParams.get('kind');
      if(!['board','panel'].includes(kind))return response({error:'invalid_mini_kind'},400);
      // Reuse exact current device-token/origin/upgrade authentication, no cloud role.
      url.pathname='/ws';url.search='';url.searchParams.set('role','device');
      url.searchParams.set('id',DEVICE);url.searchParams.set('mini',kind);
      return original.fetch(new Request(url,request),env,ctx);
    }
    // Prevent bypassing authentication/routing through /ws?mini=... .
    if(url.searchParams.has('mini'))return response({error:'use_mini_ws'},400);
    return original.fetch(request,env,ctx);
  }
};
export class CodexLabRelay extends VoiceRelay {
  panels(){return this.ctx.getWebSockets('mini:panel').filter(s=>s.readyState===1);}
  board(){return this.ctx.getWebSockets('mini:board').find(s=>s.readyState===1&&!s.deserializeAttachment()?.retired);}
  notify(value){for(const panel of this.panels())this.send(panel,value);}
  snapshot(panel){
    const board=this.board(),meta=board?.deserializeAttachment();
    const fresh=!!(meta?.state&&Date.now()-meta.state.received_at_ms<7000);
    this.send(panel,{type:'mini_status',device_id:DEVICE,online:!!board});
    if(fresh)this.send(panel,meta.state);
  }
  async fetch(request){
    const kind=new URL(request.url).searchParams.get('mini');
    if(!kind)return super.fetch(request);
    if(kind==='panel'&&this.panels().length>=12)return response({error:'too_many_panels'},429);
    const [client,server]=Object.values(new WebSocketPair());
    if(kind==='board'){
      const old=this.board();if(old){old.serializeAttachment({...old.deserializeAttachment(),retired:true});try{old.close(4001,'mini board replaced')}catch{}}
    }
    this.ctx.acceptWebSocket(server,['mini:'+kind]);
    server.serializeAttachment({role:'mini_'+kind,id:DEVICE});
    this.send(server,{type:'mini_connected',device_id:DEVICE,kind});
    if(kind==='panel')this.snapshot(server);
    else this.notify({type:'mini_status',device_id:DEVICE,online:true});
    return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':'codex-lab.v1'}});
  }
  async webSocketMessage(ws,raw){
    const meta=ws.deserializeAttachment();
    if(!meta?.role?.startsWith('mini_'))return super.webSocketMessage(ws,raw);
    if(meta.retired)return;
    let msg;try{if(typeof raw!=='string'||new TextEncoder().encode(raw).length>4096)throw Error();msg=JSON.parse(raw);if(!msg||typeof msg!=='object'||Array.isArray(msg))throw Error();}catch{return this.send(ws,{type:'mini_error',reason:'invalid_frame'});}
    if(msg.device_id!==DEVICE)return this.send(ws,{type:'mini_error',reason:'invalid_target'});
    if(meta.role==='mini_board'){
      if(msg.type==='mini_state'){
        if(!(msg.temperature_c===null||Number.isFinite(msg.temperature_c)&&msg.temperature_c>=-40&&msg.temperature_c<=150)||!(msg.led_on===null||typeof msg.led_on==='boolean')||!['steady','nonsteady','error'].includes(msg.led_mode))return;
        const state={type:'mini_state',device_id:DEVICE,temperature_c:msg.temperature_c,led_on:msg.led_on,led_mode:msg.led_mode,observed_at:typeof msg.observed_at==='string'?msg.observed_at.slice(0,40):null,received_at_ms:Date.now()};
        ws.serializeAttachment({...meta,state});this.notify(state);return;
      }
      if(msg.type==='mini_result'&&ID.test(msg.request_id||'')&&typeof msg.ok==='boolean'&&(msg.led_on===null||typeof msg.led_on==='boolean')){
        for(const panel of this.panels()){
          const p=panel.deserializeAttachment();
          if(p.pending?.id===msg.request_id){panel.serializeAttachment({...p,pending:null});this.send(panel,{type:'mini_result',device_id:DEVICE,request_id:msg.request_id,ok:msg.ok,led_on:msg.led_on,reason:typeof msg.reason==='string'?msg.reason.slice(0,100):undefined});}
        }
      }
      return;
    }
    if(msg.type!=='mini_command'||msg.command!=='set_led'||typeof msg.value!=='boolean'||!ID.test(msg.request_id||''))return this.send(ws,{type:'mini_error',reason:'invalid_command'});
    const previous=meta.pending;
    if(previous&&Date.now()-previous.at<10000){
      // Same ID is not forwarded again while in flight; board also deduplicates.
      if(previous.id!==msg.request_id)this.send(ws,{type:'mini_result',device_id:DEVICE,request_id:msg.request_id,ok:false,led_on:null,reason:'busy'});
      return;
    }
    const board=this.board();if(!board)return this.send(ws,{type:'mini_result',device_id:DEVICE,request_id:msg.request_id,ok:false,led_on:null,reason:'device_offline'});
    ws.serializeAttachment({...meta,pending:{id:msg.request_id,at:Date.now()}});
    this.send(board,{type:'mini_command',device_id:DEVICE,request_id:msg.request_id,command:'set_led',value:msg.value});
  }
  async webSocketClose(ws){
    const meta=ws.deserializeAttachment();
    if(!meta?.role?.startsWith('mini_'))return super.webSocketClose(ws);
    if(meta.role==='mini_board'&&!meta.retired){
      this.notify({type:'mini_status',device_id:DEVICE,online:false});
      for(const panel of this.panels()){const p=panel.deserializeAttachment();if(p.pending){this.send(panel,{type:'mini_result',device_id:DEVICE,request_id:p.pending.id,ok:false,led_on:null,reason:'device_offline'});panel.serializeAttachment({...p,pending:null});}}
    }
  }
  async webSocketError(ws){
    const meta=ws.deserializeAttachment();
    if(!meta?.role?.startsWith('mini_'))return super.webSocketError(ws);
    try{ws.close(1011,'mini connection error')}catch{}await this.webSocketClose(ws);
  }
}
