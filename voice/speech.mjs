import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

export class LocalSpeech {
  constructor(config={}){
    this.pending=new Map();this.serial=0;this.failure=null;
    const python=config.pythonBinary||process.env.IMX_AI_PYTHON||resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
    this.process=spawn(python,[resolve('voice/audio_service.py')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONUNBUFFERED:'1'}});
    let stderr='';this.process.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-3000)});
    this.process.stdin.on('error',()=>{});
    this.ready=new Promise((yes,no)=>{
      const timer=setTimeout(()=>no(new Error('本机语音模型加载超时。')),60000);
      this.process.on('error',()=>{clearTimeout(timer);no(new Error('无法启动本机语音环境。'))});
      this.process.on('exit',()=>{clearTimeout(timer);this.failure=new Error('语音服务已停止。'+stderr.slice(-300));no(this.failure);for(const p of this.pending.values()){clearTimeout(p.timer);p.no(this.failure)}this.pending.clear()});
      createInterface({input:this.process.stdout}).on('line',line=>{let result;try{result=JSON.parse(line)}catch{return}
        if(result.ready){clearTimeout(timer);yes();return}const p=this.pending.get(result.id);if(!p)return;this.pending.delete(result.id);clearTimeout(p.timer);if(result.error)p.no(new Error(result.error));else p.yes(result);
      });
    });
  }
  async request(op,data){
    await this.ready;if(this.failure)throw this.failure;
    const id=++this.serial;
    return new Promise((yes,no)=>{const timer=setTimeout(()=>{this.pending.delete(id);no(new Error('本机语音处理超时。'))},60000);this.pending.set(id,{yes,no,timer});this.process.stdin.write(JSON.stringify({id,op,...data})+'\n')});
  }
  async recognize(pcm){return (await this.request('asr',{pcm:pcm.toString('base64')})).text}
  async synthesize(text){return Buffer.from((await this.request('tts',{text})).pcm,'base64')}
  close(){this.process.kill()}
}
