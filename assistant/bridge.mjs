import { mkdirSync } from 'node:fs';
import { ROOT,loadConfig } from '../lib/config.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LocalSpeech } from '../voice/speech.mjs';
import { ResponsiveVoiceCore } from '../core/responsive_core.mjs';
import { CodexServer } from '../core/codex_server.mjs';
import { createMiniPanel, loadDeviceToken } from './mini_panel.mjs';
import { createImageInbox } from './images.mjs';
import { routeUtterance, voiceModelContext, startQuickServices, getScheduleSnapshot, subscribeSchedule } from './route.mjs';
import { reasoningEffort } from '../core/reasoning_route.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const lab=ROOT;


export async function startVoiceLedBridge(config){
  const url=new URL(config.relayUrl);
  if(!(url.protocol==='wss:'&&!url.username&&!url.password||(url.protocol==='ws:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw new Error('请配置自己的 WSS 地址。');
  if(!/^[A-Za-z0-9_-]{32,}$/.test(config.bridgeToken||''))throw new Error('缺少新实验站的 bridgeToken。');
  if(config.deviceToken===config.bridgeToken)throw new Error('设备口令与云端口令不能相同。');
  url.pathname='/ws';url.search='';url.searchParams.set('role','cloud');
  const panel=createMiniPanel({relayUrl:config.relayUrl,deviceToken:config.deviceToken,deviceId:config.boardDeviceId});
  mkdirSync(resolve(ROOT,"data/answer-workspace"),{recursive:true});
  const speech=new LocalSpeech(config);let server=new CodexServer(config);
  try{await Promise.all([speech.ready,server.ready])}catch(error){panel.close();speech.close();server.close();throw error}
  console.log('语音模型及常驻 Codex 已就绪；模型 '+config.voiceModel+'，推理档位 '+config.voiceEffort+'，标准额度模式。硬件面板通道已另行连接。');
  const stopQuickServices=startQuickServices();
  let socket,heartbeat,retry,stopped=false,lastPong=0,backoff=1000;
  const phases=new Map();
  const send=msg=>{
    const key=msg.device_id+'/'+msg.reply_to,phase=phases.get(key);
    if(phase&&msg.type==='asr_result')phase.asrMs=Date.now()-phase.at;
    if(phase&&msg.type==='ai_reply')phase.answerMs=Date.now()-phase.at;
    if(phase&&msg.type==='tts_start'&&!phase.ttsMs)phase.ttsMs=Date.now()-phase.at;
    if(phase&&msg.type==='tts_done'){console.log('阶段耗时（不含录音上传）：'+JSON.stringify({asrMs:phase.asrMs,answerMs:phase.answerMs,firstAudioMs:phase.ttsMs,totalMs:Date.now()-phase.at}));phases.delete(key)}
    if(socket?.readyState===1)socket.send(JSON.stringify(msg));
  };
  const modelQueues=new Map();
  const publishSchedule=()=>send({type:'schedule_state',...getScheduleSnapshot()});
  const unsubscribeSchedule=subscribeSchedule(publishSchedule);
  const answer=async(text,history,voice,msg)=>{
    const routed=await routeUtterance(text,intent=>panel.transport(intent));
    if(routed.kind!=='model'){console.log('快捷分流：'+routed.kind+'；未调用模型。');return routed}
    const previous=modelQueues.get(msg.device_id)||Promise.resolve();
    const run=previous.catch(()=>{}).then(async()=>{
      if(server.closed){server=new CodexServer(config);await server.ready}
      const settings=loadConfig();
      const effort=reasoningEffort(text,settings.voiceEffort);
      const result=await server.ask(text,history,{model:settings.voiceModel,effort,sessionKey:msg.device_id,context:voiceModelContext(panel),images:msg.imagePath?[msg.imagePath]:[]});
      console.log('模型耗时：'+JSON.stringify({model:result.model,effort:result.effort,firstTokenMs:result.firstTokenMs,totalMs:result.totalMs,reusedSession:result.reusedSession}));
      return {text:result.text,kind:'model'};
    });
    modelQueues.set(msg.device_id,run);
    try{return await run}finally{if(modelQueues.get(msg.device_id)===run)modelQueues.delete(msg.device_id)}
  };
  const photos=createImageInbox();
  const core=new ResponsiveVoiceCore({speech,send,answer});
  function connect(){
    if(stopped)return;socket=new WebSocket(url,['codex-lab.v1','auth.'+config.bridgeToken]);const current=socket;let disconnected=false;
    const handshake=setTimeout(()=>{offline();current.close()},20000);
    function offline(){if(disconnected)return;disconnected=true;clearTimeout(handshake);clearInterval(heartbeat);if(!stopped){retry=setTimeout(connect,backoff);backoff=Math.min(30000,backoff*2)}}
    socket.onopen=()=>{if(disconnected){current.close();return}clearTimeout(handshake);backoff=1000;lastPong=Date.now();console.log('轻模型语音接收端已连接新站，日程网页同步已启用。');publishSchedule();heartbeat=setInterval(()=>{if(Date.now()-lastPong>45000){offline();current.close();return}send({type:'cloud_ping',id:Date.now()})},15000)};
    socket.onmessage=event=>{let msg;try{msg=JSON.parse(event.data)}catch{return}if(msg.type==='schedule_request'){publishSchedule();return}if(msg.type==='cloud_pong'){lastPong=Date.now();return}if(msg.type==='image_start'||msg.type==='image_chunk'||msg.type==='image_end'){const receipt=photos.handle(msg);if(receipt)send(receipt);return}if(msg.type==='text'&&msg.image_id){const path=photos.pathFor(msg.image_id);if(path)msg.imagePath=path}if(msg.type==='audio_end'){phases.set(msg.device_id+'/'+msg.message_id,{at:Date.now()});if(phases.size>30)phases.delete(phases.keys().next().value)}core.receive(msg)};
    socket.onerror=event=>{if(!stopped)console.error('新站连接暂不可用：'+(event.error?.message||'握手失败'));offline()};socket.onclose=offline;
  }
  connect();
  return ()=>{stopped=true;unsubscribeSchedule();stopQuickServices();clearInterval(heartbeat);clearTimeout(retry);core.close();socket?.close();panel.close();speech.close();server.close()};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    process.chdir(lab);
    const config=loadConfig();
    const stop=await startVoiceLedBridge(config);
    process.on('SIGINT',()=>{stop();process.exit(0)});
    process.on('SIGTERM',()=>{stop();process.exit(0)});
  }catch(error){console.error(error.message);process.exitCode=1}
}
