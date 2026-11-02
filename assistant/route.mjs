import { deviceIntent,deviceReply } from './device_intents.mjs';
import { quickReply } from '../core/quick_reply.mjs';
import {createWeatherService,weatherIntent} from './weather.mjs';
import {createScheduleService,scheduleIntent} from './schedule.mjs';

const weather=createWeatherService();
const schedule=createScheduleService();
const scheduleListeners=new Set();
export const getScheduleSnapshot=()=>schedule.snapshot();
export function subscribeSchedule(listener){scheduleListeners.add(listener);return ()=>scheduleListeners.delete(listener)}

export function startQuickServices(){
  try{schedule.initialize()}catch{console.error('日程文件暂时无法初始化，其他语音功能继续运行。')}
  void weather.warm();
  const timer=setInterval(()=>{void weather.warm()},240000);timer.unref?.();
  return ()=>clearInterval(timer);
}

// Hardware intents return before any model call. The caller only invokes the model for kind "model".
export async function routeUtterance(text,transport,services={weather,schedule}){
  const intent=deviceIntent(text);
  if(intent)return {text:await deviceReply(intent,transport),kind:'device'};
  const calendar=scheduleIntent(text);
  if(calendar){
    const reply=await services.schedule.reply(calendar);
    if(calendar.action==='add'&&services.schedule===schedule)for(const listener of scheduleListeners){try{listener()}catch{}}
    return {text:reply,kind:'schedule'};
  }
  const forecast=weatherIntent(text);
  if(forecast)return {text:await services.weather.reply(forecast),kind:'weather'};
  const quick=quickReply(text);
  if(quick)return {text:quick,kind:'quick'};
  return {kind:'model'};
}

export function voiceModelContext(panel,date=new Date()){
  return {
    currentTime:date.toISOString(),
    timeZone:'Asia/Shanghai',
    boardConnected:panel?.boardConnected?.()===true,
    calendarAvailable:true,
    calendarActions:['add','list'],
    calendarRequiresReceipt:true,
    schedulerAvailable:false
  };
}
