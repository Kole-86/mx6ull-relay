import {existsSync,readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
export function findCodex(config={}){
  if(config.codexBinary){
    if(isAbsolute(config.codexBinary)&&!existsSync(config.codexBinary))throw Error('codexBinary 指向的文件不存在。');
    return config.codexBinary;
  }
  if(process.env.CODEX_APP_RUNTIME_CLI_PATH&&existsSync(process.env.CODEX_APP_RUNTIME_CLI_PATH))return process.env.CODEX_APP_RUNTIME_CLI_PATH;
  if(process.platform!=='win32')return 'codex';
  const found=spawnSync('where.exe',['codex.exe'],{encoding:'utf8',windowsHide:true});
  const first=found.stdout?.split(/\r?\n/).find(p=>p.trim()&&existsSync(p.trim()));
  if(first)return first.trim();
  const candidates=[join(homedir(),'.local/bin/codex.exe'),join(homedir(),'AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe')];
  for(const path of candidates)if(existsSync(path))return path;
  const app=join(process.env.LOCALAPPDATA||join(homedir(),'AppData/Local'),'OpenAI/Codex/bin');
  if(existsSync(app))for(const dir of readdirSync(app).reverse()){const path=join(app,dir,'codex.exe');if(existsSync(path))return path}
  throw Error('请在私人配置 config.local.json 中填写 codexBinary。');
}
