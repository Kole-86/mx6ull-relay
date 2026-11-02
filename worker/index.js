// Add read-only calendar sync to the existing experiment Worker only.
import base,{CodexLabRelay as ExistingRelay} from './base/panel-worker.js';
import {PAGE} from './page.js';
const DEVICE='imx6ull_temp_led_01';
const frame=value=>({device_id:DEVICE,...value});
const validItem=item=>item&&typeof item.id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(item.id)&&typeof item.startsAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(item.startsAt)&&Number.isFinite(Date.parse(item.startsAt))&&typeof item.title==='string'&&item.title.length>0&&item.title.length<=180&&!/[\r\n]/.test(item.title);
export class CodexLabRelay extends ExistingRelay{
  async webSocketMessage(ws,raw){
    const meta=ws.deserializeAttachment();
    let msg;
    if(typeof raw==='string'&&new TextEncoder().encode(raw).length<=32000){try{msg=JSON.parse(raw)}catch{}}
    if(msg?.type==='schedule_get'){
      if(meta?.role!=='mini_panel'||meta.retired||msg.device_id!==DEVICE)return this.send(ws,frame({type:'mini_error',reason:'invalid_schedule_request'}));
      // One read per two seconds per panel; no write command is provided.
      if(meta.scheduleRequestedAt&&Date.now()-meta.scheduleRequestedAt<2000)return;
      ws.serializeAttachment({...meta,scheduleRequestedAt:Date.now()});
      const cloud=this.live('cloud')[0];
      if(!cloud)return this.send(ws,frame({type:'schedule_status',online:false}));
      this.send(cloud,{type:'schedule_request'});return;
    }
    if(msg?.type==='schedule_state'){
      if(meta?.role!=='cloud'||meta.retired||!this.live('cloud').includes(ws))return;
      if(typeof msg.ok!=='boolean'||!Array.isArray(msg.items)||msg.items.length>30||!Number.isInteger(msg.total)||msg.total<msg.items.length||!msg.items.every(validItem))return;
      const items=msg.ok?msg.items.map(({id,startsAt,title})=>({id,startsAt,title})):[];
      this.notify(frame({type:'schedule_state',ok:msg.ok,items,total:msg.ok?msg.total:0,synced_at_ms:Date.now()}));return;
    }
    return super.webSocketMessage(ws,raw);
  }
  async webSocketClose(ws,...args){
    if(ws.deserializeAttachment()?.role==='cloud'&&!ws.deserializeAttachment()?.retired&&!this.live('cloud').some(peer=>peer!==ws))this.notify(frame({type:'schedule_status',online:false}));
    return super.webSocketClose(ws,...args);
  }
}
export default{
  fetch(request,env,ctx){
    if(['/mini','/panel'].includes(new URL(request.url).pathname))return new Response(PAGE,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}});
    return base.fetch(request,env,ctx);
  }
};
