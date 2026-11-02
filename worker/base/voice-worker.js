import base, { CodexLabRelay as TextRelay } from './text-worker.js';

const ID=/^[A-Za-z0-9_.-]{1,64}$/;
const INPUT=new Set(['hello','audio_start','audio_chunk','audio_end','reply_ack','reply_resend','tts_ack','tts_resend','tts_stop']);
const OUTPUT=new Set(['reply','asr_result','caps_query','cloud_caps','tts_start','tts_chunk','tts_end','tts_cancel','tts_skip','tts_truncated','tts_done']);
export default base;

export class CodexLabRelay extends TextRelay {
  live(tag,exclude){return super.live(tag,exclude).filter(socket=>!socket.deserializeAttachment()?.retired);}
  async fetch(request){
    const url=new URL(request.url);
    if(url.searchParams.get('role')==='cloud'){
      for(const old of this.live('cloud')){
        const meta=old.deserializeAttachment();
        if(meta.voiceVersion!==2||Date.now()-(meta.lastSeen||0)>45000){
          old.serializeAttachment({...meta,retired:true});
          try{old.close(4001,'voice receiver reconnect')}catch{}
        }
      }
    }
    const result=await super.fetch(request);
    if(result.status===101){
      if(url.searchParams.get('role')==='device'){
        for(const cloud of this.live('cloud'))this.send(cloud,{type:'status',event:'device_connected',device_id:url.searchParams.get('id')});
      }else{
        const cloud=this.live('cloud')[0];
        if(cloud){cloud.serializeAttachment({...cloud.deserializeAttachment(),voiceVersion:2,lastSeen:Date.now()});for(const device of this.live('device'))this.send(cloud,{type:'status',event:'device_connected',device_id:device.deserializeAttachment().id});}
      }
    }
    return result;
  }
  async webSocketMessage(ws,raw){
    const meta=ws.deserializeAttachment();let msg;
    if(meta.retired){try{ws.close(4001,'retired connection')}catch{}return;}
    if(meta.role==='cloud')ws.serializeAttachment({...meta,lastSeen:Date.now()});
    if(typeof raw!=='string'||new TextEncoder().encode(raw).length>32768)return super.webSocketMessage(ws,raw);
    try{msg=JSON.parse(raw)}catch{return super.webSocketMessage(ws,raw)}
    if(!msg||typeof msg!=='object'||Array.isArray(msg))return super.webSocketMessage(ws,raw);
    if(meta.role==='device'&&INPUT.has(msg.type)){
      if(msg.device_id!==undefined&&msg.device_id!==meta.id)return this.send(ws,{type:'error',reason:'invalid_device',reply_to:msg.message_id});
      if(msg.type.startsWith('audio_')&&!ID.test(msg.message_id||''))return this.send(ws,{type:'error',reason:'invalid_audio_id'});
      if(msg.type==='audio_chunk'&&(!Number.isInteger(msg.seq)||msg.seq<0||msg.seq>=240||typeof msg.data!=='string'||msg.data.length>3200||!/^[A-Za-z0-9+/]*={0,2}$/.test(msg.data)))return this.send(ws,{type:'error',reason:'invalid_audio_chunk',reply_to:msg.message_id});
      const cloud=this.live('cloud')[0];
      if(!cloud){if(msg.type==='hello'||msg.type.startsWith('tts_')||msg.type.startsWith('reply_'))return;return this.send(ws,{type:'error',reason:'cloud offline',reply_to:msg.message_id})}
      this.send(cloud,{...msg,device_id:meta.id});return;
    }
    if(meta.role==='cloud'&&OUTPUT.has(msg.type)){
      if(!ID.test(msg.device_id||''))return this.send(ws,{type:'error',reason:'invalid_target'});
      for(const device of this.live('device:'+msg.device_id))this.send(device,msg);
      return;
    }
    return super.webSocketMessage(ws,raw);
  }
}
