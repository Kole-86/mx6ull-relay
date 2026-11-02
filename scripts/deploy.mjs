import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,loadConfig} from '../lib/config.mjs';
const config=loadConfig(),file=join(ROOT,'.local/wrangler.jsonc');
if(!existsSync(file))throw Error('请先运行 npm run configure。');
const cli=join(ROOT,'node_modules/wrangler/bin/wrangler.js');
if(!existsSync(cli))throw Error('请先在项目目录运行 npm install。');
function run(args,input){
  return new Promise((yes,no)=>{
    const child=spawn(process.execPath,[cli,...args],{cwd:ROOT,windowsHide:true,stdio:[input?'pipe':'inherit','inherit','inherit']});
    child.on('error',no);child.on('exit',code=>code===0?yes():no(Error('部署命令未完成，请检查自己的 Cloudflare 账号配置。')));
    if(input){child.stdin.on('error',()=>{});child.stdin.end(input)}
  });
}
await run(['deploy','--config',file,'--durable-objects-code-update-mode','immediate']);
await run(['secret','bulk','--config',file],JSON.stringify({LAB_DEVICE_TOKEN:config.deviceToken,LAB_BRIDGE_TOKEN:config.bridgeToken}));
console.log('部署及口令配置完成。网页地址：https://'+new URL(config.relayUrl).hostname+'/mini');
