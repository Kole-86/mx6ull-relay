import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {ROOT,CONFIG_FILE,loadConfig} from '../lib/config.mjs';
const first=!existsSync(CONFIG_FILE);
if(first){
  const config=JSON.parse(readFileSync(join(ROOT,'config.example.json'),'utf8'));
  config.deviceToken=randomBytes(32).toString('base64url');
  config.bridgeToken=randomBytes(32).toString('base64url');
  writeFileSync(CONFIG_FILE,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log('已生成私人配置 config.local.json 和独立随机口令。填写 relayUrl 后再运行一次 npm run configure。');
  process.exit(0);
}
const config=loadConfig(),url=new URL(config.relayUrl),folder=join(ROOT,'.local');
if(!/^[A-Za-z0-9.-]+$/.test(url.hostname)||url.port)throw Error('请输入使用标准 HTTPS 端口的中转站域名。');
if(config.boardProxy&&!/^[A-Za-z0-9.-]+:\d{1,5}$/.test(config.boardProxy))throw Error('boardProxy 格式应为主机:端口，或留空。');
mkdirSync(folder,{recursive:true});
const cameraFolder=join(folder,'camera'),boardFolder=join(folder,'board');
mkdirSync(cameraFolder,{recursive:true});mkdirSync(boardFolder,{recursive:true});
const save=(path,text)=>writeFileSync(path,text,{mode:0o600});
save(join(cameraFolder,'config.local.json'),JSON.stringify({relay_url:config.relayUrl,device_token:config.deviceToken,device_id:config.cameraDeviceId||'maixcam_01',use_proxy:!!config.cameraUseProxy,proxy_host:config.cameraProxyHost||'127.0.0.1',proxy_port:config.cameraProxyPort||7890,photo_enabled:false},null,2)+'\n');
save(join(boardFolder,'relay.conf'),`CLOUD_RELAY_HOST=${url.hostname}\nLAB_DEVICE_TOKEN=${config.deviceToken}\nMODE=production\nPROXY=${config.boardProxy||''}\n`);
const wrangler=JSON.parse(readFileSync(join(ROOT,'worker/wrangler.example.jsonc'),'utf8'));
wrangler.name=config.workerName;
if(config.cloudflareAccountId){if(!/^[a-f0-9]{32}$/.test(config.cloudflareAccountId))throw Error('cloudflareAccountId 格式不正确');wrangler.account_id=config.cloudflareAccountId}
save(join(folder,'wrangler.jsonc'),JSON.stringify(wrangler,null,2)+'\n');
console.log('配置已准备：.local/camera/config.local.json、.local/board/relay.conf、.local/wrangler.jsonc。');
console.log('这些文件只在自己设备之间传递，不提交 GitHub。');
