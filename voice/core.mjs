import { TtsSender } from './tts_sender.mjs';
const ID=/^[A-Za-z0-9_.-]{1,64}$/;
const keyOf=m=>m.device_id+'/'+(m.message_id||m.reply_to);

export class VoiceCore {
  constructor({speech,answer,send}){
    this.speech=speech;this.answer=answer;this.send=send;this.devices=new Map();this.audio=new Map();this.cache=new Map();this.history=new Map();this.jobs=[];this.busy=false;this.closed=false;
    this.tts=new TtsSender(send);
    this.timer=setInterval(()=>{for(const [key,s] of this.audio)if(Date.now()-s.at>25000){this.audio.delete(key);this.error(s,'录音接收超时，请重新说一次。')}},1000);
  }
  error(msg,reason){this.send({type:'error',device_id:msg.device_id,reply_to:msg.message_id||msg.reply_to,reason})}
  ack(msg,duplicate=false){this.send({type:'reply',device_id:msg.device_id,reply_to:msg.message_id,text:'本机助手已收到，正在处理。',duplicate})}
  receive(msg){
    if(this.closed||typeof msg?.type!=='string')return;
    if(msg.type==='status'&&msg.event==='device_connected'){this.send({type:'caps_query',device_id:msg.device_id,cloud_caps:['audio','tts','tts_queue']});return;}
    if(!ID.test(msg.device_id||''))return;
    if(msg.type==='hello'){
      const caps=Array.isArray(msg.caps)?msg.caps.filter(x=>typeof x==='string'):[];
      this.devices.set(msg.device_id,{caps,maxBytes:Math.min(320000,Math.max(32000,Number(msg.tts?.max_bytes)||320000))});
      this.send({type:'cloud_caps',device_id:msg.device_id,caps:['audio','tts','tts_queue']});return;
    }
    if(msg.type.startsWith('tts_'))return this.tts.receive(msg);
    if(msg.type==='reply_ack')return;
    if(msg.type==='reply_resend'){const cached=this.cache.get(keyOf(msg));if(cached?.reply)this.send(cached.reply);return;}
    if(!ID.test(msg.message_id||''))return;
    const key=keyOf(msg),cached=this.cache.get(key);
    if(cached){if(msg.type==='text'||msg.type==='audio_end'){this.ack(msg,true);if(cached.asr)this.send(cached.asr);if(cached.reply)this.send(cached.reply)}return;}
    if(msg.type==='text'){
      if(typeof msg.text!=='string'||!msg.text.trim()||msg.text.length>4000)return this.error(msg,'问题为空或过长。');
      this.enqueue({...msg,voice:false});return;
    }
    if(msg.type==='audio_start'){
      if(msg.sample_rate!==16000||msg.channels!==1||msg.format!=='pcm_s16le')return this.error(msg,'录音格式需为 16 kHz 单声道 PCM。');
      if(!this.audio.has(key)&&this.audio.size>=3)return this.error(msg,'正在接收其他录音，请稍后再试。');
      this.audio.set(key,{...msg,parts:new Map(),bytes:0,at:Date.now()});return;
    }
    const session=this.audio.get(key);
    if(!session){if(msg.type==='audio_end')this.error(msg,'录音开始信息缺失，请重试。');return;}
    session.at=Date.now();
    if(msg.type==='audio_chunk'){
      if(!Number.isInteger(msg.seq)||msg.seq<0||msg.seq>=240||typeof msg.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(msg.data)||msg.data.length>3200){this.audio.delete(key);return this.error(msg,'录音分块格式错误。');}
      const part=Buffer.from(msg.data,'base64');if(!part.length||part.length%2||part.length>2400){this.audio.delete(key);return this.error(msg,'录音分块长度错误。');}
      if(session.parts.has(msg.seq)){if(!session.parts.get(msg.seq).equals(part)){this.audio.delete(key);this.error(msg,'录音分块重复且内容不一致。')}return;}
      session.parts.set(msg.seq,part);session.bytes+=part.length;
      if(session.bytes>512000){this.audio.delete(key);this.error(msg,'录音超过时长限制。');}return;
    }
    if(msg.type==='audio_end'){
      this.audio.delete(key);
      if(!Number.isInteger(msg.chunks)||msg.chunks<1||msg.chunks>240||session.parts.size!==msg.chunks)return this.error(msg,'录音缺少分块，请重新说一次。');
      const parts=[];for(let i=0;i<msg.chunks;i++){if(!session.parts.has(i))return this.error(msg,'录音缺少分块，请重新说一次。');parts.push(session.parts.get(i));}
      if(session.bytes<16000)return this.error(msg,'录音太短，请说完整一些。');
      this.enqueue({...msg,voice:true,pcm:Buffer.concat(parts)});
    }
  }
  enqueue(msg){
    if(this.jobs.length+(this.busy?1:0)>=5)return this.error(msg,'当前问题较多，请稍后再试。');
    if(this.cache.size>=50){for(const [key,cached] of this.cache){if(cached.reply){this.cache.delete(key);if(this.cache.size<35)break;}}}
    this.cache.set(keyOf(msg),{});this.jobs.push(msg);this.ack(msg);void this.pump();
  }
  async pump(){
    if(this.busy)return;this.busy=true;
    try{while(this.jobs.length&&!this.closed){
      const msg=this.jobs.shift(),cache=this.cache.get(keyOf(msg));
      try{
        let text=msg.text;
        if(msg.voice){
          text=await this.speech.recognize(msg.pcm);
          cache.asr={type:'asr_result',device_id:msg.device_id,reply_to:msg.message_id,text};this.send(cache.asr);
          if(!text?.trim()){this.error(msg,'没有听清楚，请靠近麦克风重新说一次。');cache.reply={type:'error',device_id:msg.device_id,reply_to:msg.message_id,reason:'没有听清楚，请重新说一次。'};continue;}
        }
        const history=this.history.get(msg.device_id)||[];
        const answer=String(await this.answer(text,history,msg.voice)).trim().slice(0,4000);
        if(!answer)throw new Error('empty_answer');
        cache.reply={type:'ai_reply',device_id:msg.device_id,reply_to:msg.message_id,seq:1,final:true,text:answer};this.send(cache.reply);
        history.push({role:'user',text},{role:'assistant',text:answer});this.history.set(msg.device_id,history.slice(-12));
        if(this.history.size>30)this.history.delete(this.history.keys().next().value);
        const device=this.devices.get(msg.device_id);
        if(device?.caps.includes('tts')&&(msg.voice||device.caps.includes('tts_queue')))await this.speak(msg,answer,device.maxBytes);
      }catch(error){cache.reply={type:'error',device_id:msg.device_id,reply_to:msg.message_id,reason:'本机助手暂未完成本次处理，请重试。'};this.send(cache.reply);console.error('语音问答处理失败：'+(error.code||error.message||'unknown'));}
    }}finally{this.busy=false;}
  }
  async speak(msg,answer,maxBytes){
    let text=answer.replace(/```[\s\S]*?```/g,'代码请看屏幕。').replace(/https?:\/\/\S+/g,'链接请看屏幕。').replace(/[*#`>|]/g,'').replace(/\s+/g,' ').trim();
    if(text.length>300){text=text.slice(0,300);this.send({type:'tts_truncated',device_id:msg.device_id,reply_to:msg.message_id});}
    const pieces=Array.from(text).join('').match(/[^。！？!?；;\n]{1,20}[。！？!?；;，,]?/gu)||[];
    let item=0;
    while(pieces.length&&!this.closed){
      if(this.tts.cancelled.has(msg.device_id+'/'+msg.message_id))return;
      const piece=pieces.shift();if(!piece.trim())continue;
      try{
        const pcm=await this.speech.synthesize(piece);
        if(pcm.length>maxBytes&&piece.length>2){const split=Math.ceil(piece.length/2);pieces.unshift(piece.slice(0,split),piece.slice(split));continue;}
        const ok=await this.tts.sendPcm(msg.device_id,msg.message_id,++item,pcm,maxBytes);if(!ok)return;
      }catch(error){this.send({type:'tts_skip',device_id:msg.device_id,reply_to:msg.message_id,item:++item,reason:'本段语音合成失败'});console.error('本机合成失败：'+error.message);}
    }
    if(!this.closed)this.send({type:'tts_done',device_id:msg.device_id,reply_to:msg.message_id,items:item});
  }
  close(){this.closed=true;clearInterval(this.timer);this.tts.close();this.jobs=[];this.audio.clear()}
}
