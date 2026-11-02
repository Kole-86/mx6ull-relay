import { crc32 } from 'node:zlib';
import { randomUUID } from 'node:crypto';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export class TtsSender {
  constructor(send){this.send=send;this.entries=new Map();this.cancelled=new Set();}
  receive(msg){
    if(msg.type==='tts_stop'){
      this.cancelled.add(msg.device_id+'/'+msg.reply_to);
      if(this.cancelled.size>100)this.cancelled.delete(this.cancelled.values().next().value);
      for(const entry of this.entries.values())if(entry.device===msg.device_id&&entry.reply===msg.reply_to)entry.finish?.(false);
      this.send({type:'tts_cancel',device_id:msg.device_id,reply_to:msg.reply_to});return;
    }
    const entry=this.entries.get(msg.tts_id);
    if(!entry||entry.device!==msg.device_id)return;
    if(msg.type==='tts_ack')entry.finish?.(msg.ok===true);
    if(msg.type==='tts_resend'&&Array.isArray(msg.missing))void this.parts(entry,msg.missing.filter(i=>Number.isInteger(i)&&i>=1&&i<=entry.chunks.length));
  }
  async parts(entry,sequences){
    for(const seq of sequences){
      if(this.cancelled.has(entry.device+'/'+entry.reply))return;
      this.send({type:'tts_chunk',device_id:entry.device,tts_id:entry.id,seq,data:entry.chunks[seq-1]});await pause(12);
    }
    this.send({type:'tts_end',device_id:entry.device,reply_to:entry.reply,tts_id:entry.id,chunks:entry.chunks.length});
  }
  async sendPcm(device,reply,item,pcm,maxBytes=320000){
    if(!pcm.length||pcm.length%2||pcm.length>maxBytes)throw new Error('invalid_tts_size');
    if(this.cancelled.has(device+'/'+reply))return false;
    const entry={id:'tts_'+randomUUID().replaceAll('-',''),device,reply,chunks:[]};
    for(let pos=0;pos<pcm.length;pos+=2400)entry.chunks.push(pcm.subarray(pos,pos+2400).toString('base64'));
    entry.header={type:'tts_start',device_id:device,reply_to:reply,tts_id:entry.id,item,queue:true,sample_rate:16000,format:'s16le',channels:1,total_bytes:pcm.length,chunks:entry.chunks.length,crc32:crc32(pcm)>>>0};
    this.entries.set(entry.id,entry);
    try{
      for(let attempt=0;attempt<2;attempt++){
        let timer;
        const ack=new Promise(resolve=>{entry.finish=value=>{clearTimeout(timer);resolve(value)};timer=setTimeout(()=>resolve(false),8000)});
        this.send(entry.header);await this.parts(entry,entry.chunks.map((_,i)=>i+1));
        if(await ack)return true;
        if(this.cancelled.has(device+'/'+reply))return false;
      }
      this.send({type:'tts_skip',device_id:device,reply_to:reply,tts_id:entry.id,item,reason:'语音传输未得到设备确认'});return false;
    }finally{this.entries.delete(entry.id);}
  }
  close(){for(const e of this.entries.values())e.finish?.(false);this.entries.clear()}
}
