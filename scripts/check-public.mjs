// Safe to run before uploading source. Prints paths, never matched secret values.
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {ROOT} from '../lib/config.mjs';
const skipped=new Set(['node_modules','.git','.venv','.local','.wrangler','data','build','dist','evidence','models','downloads','__pycache__']);
const findings=[];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(skipped.has(entry.name))continue;
  const path=join(dir,entry.name),name=relative(ROOT,path).replaceAll('\\','/');
  if(entry.isSymbolicLink()){findings.push(name+' (symbolic link)');continue}
  if(entry.isDirectory()){walk(path);continue}
  // Private files are intentionally ignored by Git, but may still exist locally.
  if(entry.name==='config.local.json'||entry.name==='.dev.vars'||entry.name==='relay.conf')continue;
  if(/(?:auth\.json|cookies|credentials|\.(?:pem|key|token)$)/i.test(entry.name)){findings.push(name);continue}
  if(!/\.(?:mjs|js|jsonc?|py|cpp|h|md|sh|ps1|txt|pro)$/.test(entry.name)&&!entry.name.startsWith('.'))continue;
  const text=readFileSync(path,'utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{30,})\b/.test(text))findings.push(name);
}}
walk(ROOT);
if(findings.length){console.error('需人工检查的文件：\n'+[...new Set(findings)].join('\n'));process.exitCode=1}
else console.log('未发现私钥或常见访问凭据。私人配置、模型、缓存和个人数据须继续保持在 .gitignore 中。');
