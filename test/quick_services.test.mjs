import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {weatherIntent,createWeatherService} from '../assistant/weather.mjs';
import {scheduleIntent,parseSchedule,createScheduleService} from '../assistant/schedule.mjs';
import {routeUtterance} from '../assistant/route.mjs';
const NOW=Date.parse('2026-11-02T08:00:00+08:00');
const fixture=()=>({current:{time:'2026-11-02T08:00',temperature_2m:6.4,weather_code:0},daily:{time:['2026-11-02','2026-11-03','2026-11-04'],temperature_2m_min:[3,4,5],temperature_2m_max:[15,16,17],weather_code:[1,2,45]}});

test('weather uses Beijing by default, respects explicit cities and dates, and leaves explanations alone',()=>{
  assert.deepEqual(weatherIntent('现在天气怎么样'),{city:'北京',day:0,forecast:false});
  assert.deepEqual(weatherIntent('请问今天天气怎么样？'),{city:'北京',day:0,forecast:true});
  assert.deepEqual(weatherIntent('明天上海天气怎么样'),{city:'上海',day:1,forecast:true});
  assert.deepEqual(weatherIntent('广州的天气如何'),{city:'广州',day:0,forecast:false});
  assert.equal(weatherIntent('北京天气预报').forecast,true);
  for(const text of ['为什么天气会变冷','如果天气冷就开灯','不要查询天气','下周天气怎么样','天气预报怎么做','今天和明天天气怎么样'])assert.equal(weatherIntent(text),null);
});

test('weather warm cache coalesces calls, expires and never fabricates on network or data errors',async()=>{
  let clock=NOW,calls=0;
  const service=createWeatherService({now:()=>clock,fetcher:async url=>{
    calls++;assert.equal(new URL(url).hostname,'api.open-meteo.com');
    return {ok:true,json:async()=>fixture()};
  }});
  await Promise.all([service.warm(),service.warm()]);assert.equal(calls,1);
  assert.equal(await service.reply(weatherIntent('天气怎么样')),'北京现在晴，气温6.4摄氏度。');
  assert.match(await service.reply(weatherIntent('明天天气怎么样')),/北京明天预计多云，4到16/);
  assert.equal(calls,1);
  clock+=300001;await service.reply(weatherIntent('天气怎么样'));assert.equal(calls,2);
  clock=NOW+3*3600000;
  assert.match(await service.reply(weatherIntent('天气怎么样')),/暂时没查到/);
  const failed=createWeatherService({now:()=>NOW,fetcher:async()=>{throw Error('offline')}});
  assert.match(await failed.reply(weatherIntent('上海天气怎么样')),/暂时没查到/);
  const unknown=createWeatherService({now:()=>NOW,fetcher:async()=>({ok:true,json:async()=>({results:[]})})});
  assert.match(await unknown.reply(weatherIntent('测试城市天气怎么样')),/完整城市名/);
});

test('schedule parser requires a clear future date, time and one event',()=>{
  assert.deepEqual(parseSchedule('明天下午三点开会',NOW),{startsAt:'2026-11-03T15:00:00+08:00',title:'开会'});
  assert.deepEqual(parseSchedule('11月3号上午十点半检查开发板',NOW),{startsAt:'2026-11-03T10:30:00+08:00',title:'检查开发板'});
  assert.deepEqual(parseSchedule('后天18:05买菜',NOW),{startsAt:'2026-11-04T18:05:00+08:00',title:'买菜'});
  assert.deepEqual(parseSchedule('明天凌晨十二点休息',NOW),{startsAt:'2026-11-03T00:00:00+08:00',title:'休息'});
  assert.ok(parseSchedule('明天下午三点开会，后天下午四点吃饭',NOW).error);
  for(const text of ['明天三点开会','明天开会','11月31号下午三点开会','今天上午七点开会','明天下午三点','明天下午十五点开会','明天下午三点开会然后再添加吃饭','每天下午三点开会'])assert.ok(parseSchedule(text,NOW).error,text);
  assert.deepEqual(scheduleIntent('添加日程，明天下午三点开会。'),{action:'add',description:'明天下午三点开会'});
  assert.deepEqual(scheduleIntent('明天有什么安排'),{action:'list',day:1});
  assert.equal(scheduleIntent('解释一下如何安排日程'),null);
});

test('voice routing saves readable schedules, survives restart, deduplicates and reports write failure',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'voice-schedule-'));
  const file=join(dir,'日程.md');let hardwareCalls=0,weatherCalls=0;
  try{
    const service=createScheduleService({file,now:()=>NOW});service.initialize();
    const dependencies={schedule:service,weather:{reply:async()=>{weatherCalls++;return '天气测试'}}};
    const hardware=async()=>{hardwareCalls++;return {ok:true,led:true}};
    const added=await routeUtterance('添加日程，明天下午三点开会',hardware,dependencies);
    assert.equal(added.kind,'schedule');assert.match(added.text,/已保存日程/);
    assert.match(readFileSync(file,'utf8'),/2026-11-03 15:00（北京时间）：开会/);
    assert.match(await service.reply(scheduleIntent('添加日程，明天下午三点开会')),/保存过/);
    assert.equal((readFileSync(file,'utf8').match(/<!-- voice-schedule/g)||[]).length,1);
    const restarted=createScheduleService({file,now:()=>NOW});
    assert.match(await restarted.reply({action:'list',day:1}),/15:00，开会/);
    assert.match(await restarted.reply({action:'list',day:0}),/没有待办/);
    assert.equal((await routeUtterance('开灯',hardware,dependencies)).kind,'device');
    assert.equal((await routeUtterance('天气怎么样',hardware,dependencies)).kind,'weather');
    assert.equal((await routeUtterance('解释PWM',hardware,dependencies)).kind,'model');
    assert.equal(hardwareCalls,1);assert.equal(weatherCalls,1);
    const missing=createScheduleService({file:join(dir,'missing','日程.md'),now:()=>NOW});
    assert.match(await missing.reply(scheduleIntent('添加日程，明天下午三点开会')),/没有确认保存/);
    appendFileSync(file,'<!-- voice-schedule BROKEN -->\n');
    assert.match(await restarted.reply(scheduleIntent('添加日程，后天下午三点开会')),/没有确认保存/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
