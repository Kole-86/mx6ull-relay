import {existsSync,readFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {ROOT,loadConfig} from '../lib/config.mjs';
import {randomUUID} from 'node:crypto';

const DEFAULT_FILE=resolve(ROOT,loadConfig(false).scheduleFile||'data/schedules.md');
const zone='Asia/Shanghai';
const parts=now=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
const dayStamp=now=>{const p=parts(now);return `${p.year}-${p.month}-${p.day}`};
const number=value=>{
  if(/^\d+$/.test(value))return Number(value);
  const digit={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  if(value==='十')return 10;
  if(value.includes('十')){const [a,b]=value.split('十');return (a?digit[a]:1)*10+(b?digit[b]:0)}
  return digit[value];
};
export function scheduleIntent(text){
  let s=String(text).trim().replace(/^[，,\s]+|[。！？!?\s]+$/gu,'');
  if(/^(?:你|您)?(?:能不能|是否可以|可以|能)(?:帮我)?(?:添加|创建|建立|新建|新增)(?:一个|个)?日程(?:安排)?(?:吗)?$/u.test(s))return {action:'help'};
  s=s.replace(/^(?:(?:请你|请|麻烦你|麻烦|帮我|为我|给我|我想|我要)[，,\s]*)+/u,'');
  if(/^(?:请|帮我)?(?:查看|查询|看看|读一下|播报)?(?:一下)?(?:我的)?(?:日程|日程安排|有什么日程|有什么安排)$/u.test(s))return {action:'list'};
  if(/^(?:请|帮我)?(?:查看|查询|看看|读一下|播报)?(?:今天|明天)(?:的)?(?:日程|日程安排|有什么日程|有什么安排)$/u.test(s))return {action:'list',day:s.includes('明天')?1:0};
  const match=s.match(/^(?:(?:添加|创建|建立|新建|新增|记录)(?:一下|一个|个)?日程(?:安排)?(?:一下)?|记个日程)[，,:：\s]*(.*)$/u);
  return match?{action:'add',description:match[1]}:null;
}
export function parseSchedule(description,now){
  let s=description.trim();
  const date=s.match(/^(?:(今天|明天|后天)|(?:(\d{4})年)?([\d一二三四五六七八九十两]+)月([\d一二三四五六七八九十两]+)[日号])/u);
  if(!date)return {error:'请说清日期和时间，例如：添加日程，明天下午三点开会。'};
  let target;
  if(date[1])target=dayStamp(now+({'今天':0,'明天':1,'后天':2}[date[1]])*86400000);
  else{
    const p=parts(now),year=date[2]?Number(date[2]):Number(p.year),month=number(date[3]),day=number(date[4]);
    if(month<1||month>12||day<1||day>31)return {error:'日期不正确，请重新说。'};
    target=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if(dayStamp(Date.parse(target+'T12:00:00+08:00'))!==target)return {error:'日期不正确，请重新说。'};
  }
  s=s.slice(date[0].length).replace(/^[的，,\s]+/u,'');
  const time=s.match(/^(凌晨|早上|上午|中午|下午|晚上)?\s*([\d零〇一二两三四五六七八九十]+)(?:(?:点|时)(半|一刻|三刻|[\d零〇一二两三四五六七八九十]+分?)?|[:：](\d{1,2}))/u);
  if(!time)return {error:'请说清几点，例如：明天下午三点开会。'};
  let hour=number(time[2]),minute=time[4]?Number(time[4]):time[3]==='半'?30:time[3]==='一刻'?15:time[3]==='三刻'?45:time[3]?number(time[3].replace(/分$/u,'')):0;
  const period=time[1];
  if(!Number.isInteger(hour)||!Number.isInteger(minute)||minute<0||minute>59||hour<0||hour>23)return {error:'时间不正确，请重新说。'};
  if(period){
    if(hour<1||hour>12)return {error:'时间段和小时不一致，请重新说。'};
    if((period==='凌晨'&&hour>5&&hour!==12)||(period==='早上'&&hour>11)||(period==='上午'&&hour===12)||(period==='下午'&&(hour===12||hour>6))||(period==='晚上'&&hour<6))return {error:'时间段不明确，请用二十四小时制说清时间。'};
    if(['下午','晚上'].includes(period)&&hour!==12)hour+=12;
    if(period==='凌晨'&&hour===12)hour=0;
    if(period==='中午'){if(hour===1)hour=13;else if(hour!==11&&hour!==12)return {error:'中午的时间不明确，请重新说。'}}
  }else if(hour>=1&&hour<=12&&!time[4])return {error:'请说明上午还是下午，或者用二十四小时制。'};
  const title=s.slice(time[0].length).replace(/^[，,:：\s]+|[。\s]+$/gu,'');
  if(!title||title.length>180||/[\r\n]|<!--|-->/u.test(title))return {error:'请说一项简短的日程事项。'};
  if(/(?:并且|然后|再添加|同时|每天|每周|每月)|(?:今天|明天|后天|\d+月\d+[日号]).*(?:点|时|[:：]\d)/u.test(title))return {error:'请一次添加一项日程，并说清具体日期。'};
  const startsAt=target+`T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+08:00`;
  if(Date.parse(startsAt)<=now)return {error:'这个时间已经过去了，请确认日期和时间。'};
  return {startsAt,title};
}
export function createScheduleService({file=DEFAULT_FILE,now=()=>Date.now()}={}){
  function read(){
    if(!existsSync(file))return [];
    const text=readFileSync(file,'utf8'),items=[];
    for(const m of text.matchAll(/^<!-- voice-schedule (.+) -->$/gm)){
      let item;try{item=JSON.parse(m[1])}catch{throw Error('日程记录无法读取')}
      if(!item.id||!Number.isFinite(Date.parse(item.startsAt))||typeof item.title!=='string')throw Error('日程记录不完整');
      items.push(item);
    }
    return items;
  }
  function initialize(){
    if(existsSync(file))return;
    const fd=openSync(file,'wx');
    try{writeSync(fd,'# 我的语音日程\n\n时间均为北京时间。这里保存语音添加的日程，当前不自动提醒。\n\n');fsyncSync(fd)}finally{closeSync(fd)}
  }
  async function reply(intent){
    try{
      if(intent.action==='help')return '可以添加日程。请说：添加日程，明天下午三点开会。保存后网页上也能看到。';
      const instant=now();
      if(intent.action==='list'){
        const date=intent.day===undefined?null:dayStamp(instant+intent.day*86400000);
        const items=read().filter(i=>Date.parse(i.startsAt)>instant&&(!date||i.startsAt.startsWith(date))).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
        if(!items.length)return date?'这一天暂时没有待办日程。':'暂时没有待办日程。';
        return items.slice(0,3).map(i=>i.startsAt.slice(5,10).replace('-','月')+'日'+i.startsAt.slice(11,16)+'，'+i.title+'。').join('')+(items.length>3?'其余日程可以打开电脑上的日程文件查看。':'');
      }
      const parsed=parseSchedule(intent.description,instant);
      if(parsed.error)return parsed.error;
      const items=read();
      if(items.some(i=>i.startsAt===parsed.startsAt&&i.title===parsed.title))return '这项日程已经保存过了。';
      initialize();
      const item={id:randomUUID(),...parsed,createdAt:new Date(instant).toISOString()};
      const label=parsed.startsAt.slice(0,10)+' '+parsed.startsAt.slice(11,16);
      const visibleTitle=parsed.title.replace(/[\[\]<>*`\\]/g,'');
      const block=`- ${label}（北京时间）：${visibleTitle}\n<!-- voice-schedule ${JSON.stringify(item)} -->\n\n`;
      const fd=openSync(file,'a');try{writeSync(fd,block);fsyncSync(fd)}finally{closeSync(fd)}
      return '已保存日程：'+label+'，'+parsed.title+'。';
    }catch{return '日程文件暂时无法读写，本次没有确认保存，请检查电脑。'}
  }
  function snapshot(){
    try{
      const instant=now();
      const items=read().filter(i=>Date.parse(i.startsAt)>instant).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
      return {ok:true,items:items.slice(0,30).map(({id,startsAt,title})=>({id,startsAt,title})),total:items.length};
    }catch{return {ok:false,items:[],total:0,reason:'file_unavailable'}}
  }
  return {reply,initialize,file,snapshot};
}
