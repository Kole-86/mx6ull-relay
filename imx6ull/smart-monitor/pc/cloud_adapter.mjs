import {readFileSync} from 'node:fs';
import readline from 'node:readline';
const dev='imx6ull_temp_led_01';
const path=process.env.CLOUD_TOKEN_FILE;
const host=process.env.CLOUD_RELAY_HOST;
if(!path || !host || !/^[A-Za-z0-9.-]+$/.test(host)) throw Error('请设置 CLOUD_TOKEN_FILE 和 CLOUD_RELAY_HOST');
let token;for(const line of readFileSync(path,'utf8').split(/\r?\n/))if(/^\s*LAB_DEVICE_TOKEN\s*=/.test(line))token=line.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g,'');
if(!token)throw Error('设备口令不可用');
let ws,online=false,backoff=1000,pending=new Map(),last=0,pong=0;
const emit=x=>console.log(JSON.stringify(x));
function connect(){ws=new WebSocket('wss://'+host+'/mini/ws?kind=panel',['codex-lab.v1','auth.'+token]);const current=ws;
 current.onopen=()=>{backoff=1000;pong=Date.now();emit({type:'connection',online:true,detail:'中转已连接'});};
 current.onmessage=e=>{if(e.data==='pong'){pong=Date.now();return}let m;try{m=JSON.parse(e.data)}catch{return}if(m.device_id!==dev)return;
 if(m.type==='mini_status'){online=m.online===true;if(!online){last=0;emit({type:'offline'})}}
 if(m.type==='mini_state'){online=true;last=Date.now();emit(m)}
 if(m.type==='mini_result'){const wanted=pending.get(m.request_id);if(wanted===undefined)return;pending.delete(m.request_id);emit({type:'result',ok:m.ok===true&&m.led_on===wanted,reason:m.reason||'',led_on:m.led_on});}};
 current.onclose=()=>{if(ws!==current)return;online=false;last=0;for(const id of pending.keys())emit({type:'result',ok:false,reason:'连接断开，结果未知'});pending.clear();emit({type:'connection',online:false,detail:'断开，正在重连'});setTimeout(connect,backoff);backoff=Math.min(30000,backoff*2)};
 current.onerror=()=>{};
}
setInterval(()=>{if(ws?.readyState===1){if(Date.now()-pong>35000)ws.close();else ws.send('ping')}if(last&&Date.now()-last>7000){last=0;online=false;emit({type:'offline'})}},15000);
readline.createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}if(m.type!=='set_led'||typeof m.value!=='boolean'||!online||!last||Date.now()-last>7000||ws?.readyState!==1){emit({type:'result',ok:false,reason:'设备离线或状态过期'});return}const id='pc_'+crypto.randomUUID().replaceAll('-','');pending.set(id,m.value);ws.send(JSON.stringify({type:'mini_command',device_id:dev,request_id:id,command:'set_led',value:m.value}));setTimeout(()=>{if(pending.delete(id))emit({type:'result',ok:false,reason:'回执超时，结果未知'})},8000)});
connect();
