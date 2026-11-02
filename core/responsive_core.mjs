import {VoiceCore} from '../voice/core.mjs';

// Recognize and route each request before waiting for an unrelated model answer.
export class ResponsiveVoiceCore extends VoiceCore{
  constructor(options){super(options);this.active=0}
  enqueue(msg){
    if(this.active>=5)return this.error(msg,'当前问题较多，请稍后再试。');
    if(this.cache.size>=50)for(const [key,cached] of this.cache){if(cached.reply){this.cache.delete(key);if(this.cache.size<35)break;}}
    const key=msg.device_id+'/'+msg.message_id,cache={};
    this.cache.set(key,cache);this.ack(msg);this.active++;
    void this.run(msg,cache).finally(()=>{this.active--});
  }
  async run(msg,cache){
    try{
      let text=msg.text;
      if(msg.voice){
        text=await this.speech.recognize(msg.pcm);
        if(this.closed)return;
        cache.asr={type:'asr_result',device_id:msg.device_id,reply_to:msg.message_id,text};this.send(cache.asr);
        if(!text?.trim())throw new Error('没有听清楚，请重新说一次。');
      }
      const history=this.history.get(msg.device_id)||[];
      const result=await this.answer(text,history,msg.voice,msg);
      if(this.closed)return;
      const answer=String(typeof result==='string'?result:result.text).trim().slice(0,4000);
      if(!answer)throw new Error('empty_answer');
      cache.reply={type:'ai_reply',device_id:msg.device_id,reply_to:msg.message_id,seq:1,final:true,text:answer};this.send(cache.reply);
      if(result.kind==='model'){
        const recent=this.history.get(msg.device_id)||[];
        recent.push({role:'user',text},{role:'assistant',text:answer});this.history.set(msg.device_id,recent.slice(-12));
        if(this.history.size>30)this.history.delete(this.history.keys().next().value);
      }
      const device=this.devices.get(msg.device_id);
      if(device?.caps.includes('tts')&&(msg.voice||device.caps.includes('tts_queue')))await this.speak(msg,answer,device.maxBytes);
    }catch(error){
      if(this.closed)return;
      cache.reply={type:'error',device_id:msg.device_id,reply_to:msg.message_id,reason:'本机助手暂未完成本次处理，请重试。'};this.send(cache.reply);
      console.error('语音问答处理失败：'+(error.code||error.message||'unknown'));
    }
  }
}
