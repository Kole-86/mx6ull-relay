import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
export const ROOT=resolve(import.meta.dirname,'..');
export const CONFIG_FILE=resolve(ROOT,'config.local.json');
const defaults={relayUrl:'',deviceToken:'',bridgeToken:'',voiceModel:'gpt-6-luna',voiceEffort:'none',timeoutMs:90000,codexBinary:'',pythonBinary:'',boardDeviceId:'imx6ull_temp_led_01',workerName:'imx-ai-relay',cloudflareAccountId:'',scheduleFile:'data/schedules.md'};
export function loadConfig(required=true){
  if(!existsSync(CONFIG_FILE)){
    if(required)throw Error('请先运行 npm run configure，再填写 config.local.json 中的中转地址。');
    return {...defaults};
  }
  const config={...defaults,...JSON.parse(readFileSync(CONFIG_FILE,'utf8'))};
  if(required){
    let url;try{url=new URL(config.relayUrl)}catch{throw Error('请填写自己的 relayUrl。')}
    if(url.protocol!=='wss:'||url.username||url.password||url.search||url.hash)throw Error('relayUrl 应是无口令、无参数的 wss://域名/ws 地址。');
    if(/YOUR_/i.test(url.hostname))throw Error('请把 relayUrl 里的示例域名改成自己的域名。');
    if(!/^[A-Za-z0-9_.~-]{32,512}$/.test(config.deviceToken)||!/^[A-Za-z0-9_-]{32,512}$/.test(config.bridgeToken)||config.deviceToken===config.bridgeToken)throw Error('请使用两段不同的随机设备口令和电脑口令。');
    if(!/^[a-z][a-z0-9-]{1,60}$/.test(config.workerName))throw Error('workerName 格式不正确。');
    if(config.boardDeviceId!=='imx6ull_temp_led_01')throw Error('当前板端协议设备编号固定为 imx6ull_temp_led_01，请保持此项默认值。');
  }
  return config;
}
