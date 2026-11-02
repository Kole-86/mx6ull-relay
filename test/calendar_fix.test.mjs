import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scheduleIntent,createScheduleService} from '../assistant/schedule.mjs';
import {routeUtterance,voiceModelContext} from '../assistant/route.mjs';
test('creating a schedule reaches the actual file writer instead of ordinary Q&A',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'calendar-add-fix-'));
  const file=join(dir,'日程.md');
  const service=createScheduleService({file,now:()=>Date.parse('2026-11-02T08:00:00+08:00')});
  const services={schedule:service,weather:{reply(){throw Error('not weather')}}};
  try{
    for(const text of ['创建一个日程，明天下午三点开会','帮我添加日程，明天下午三点开会','请帮我建立一个日程，明天下午三点开会']){
      const result=await routeUtterance(text,()=>{throw Error('not hardware')},services);
      assert.equal(result.kind,'schedule');assert.match(result.text,/已保存日程|已经保存过/);
    }
    assert.equal(service.snapshot().total,1);
    assert.equal(service.snapshot().items[0].title,'开会');
    assert.match(readFileSync(file,'utf8'),/2026-11-03 15:00（北京时间）：开会/);
    const result=await routeUtterance('你可以帮我创建日程吗',null,services);
    assert.equal(result.kind,'schedule');assert.match(result.text,/可以添加/);
    assert.equal(service.snapshot().total,1);
    assert.match((await routeUtterance('创建日程',null,services)).text,/日期和时间/);
    for(const text of ['不要创建日程','如果我创建日程会怎么样','为什么无法创建日程','先讨论创建日程'])assert.equal(scheduleIntent(text),null);
    const context=voiceModelContext();assert.equal(context.calendarAvailable,true);assert.equal(context.calendarRequiresReceipt,true);assert.equal(context.schedulerAvailable,false);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
