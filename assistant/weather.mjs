const DEFAULT_CITY={name:'北京',latitude:39.9042,longitude:116.4074};
const CITIES=new Map([
  ['北京',DEFAULT_CITY],['上海',{name:'上海',latitude:31.23,longitude:121.47}],
  ['广州',{name:'广州',latitude:23.13,longitude:113.26}],['深圳',{name:'深圳',latitude:22.54,longitude:114.06}],
  ['天津',{name:'天津',latitude:39.13,longitude:117.2}]
]);
const condition=code=>({0:'晴',1:'大部晴朗',2:'多云',3:'阴',45:'有雾',48:'有雾',51:'小毛毛雨',53:'毛毛雨',55:'较强毛毛雨',56:'冻毛毛雨',57:'冻毛毛雨',61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'冻雨',71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'阵雨',81:'阵雨',82:'强阵雨',85:'阵雪',86:'强阵雪',95:'雷雨',96:'雷雨伴冰雹',99:'雷雨伴冰雹'})[code]||null;
export function weatherIntent(text){
  let s=String(text).trim().replace(/[\s，。！？,.!?、]/gu,'').replace(/^(?:(?:请问|请|帮我|给我|告诉我|查询|查一下|查看|问一下))+/u,'');
  if(s.length>45||/为什么|如果|假如|不要|别查|怎么(?:做|实现|开发)|添加|安排/u.test(s))return null;
  let day=0,explicitDay=false;
  const days=[...s.matchAll(/后天|明天|今天|现在|当前/g)];
  if(days.some(m=>m[0]==='明天'))day=1;
  if(days.some(m=>m[0]==='后天'))day=2;
  if(new Set(days.map(m=>/今天|现在|当前/.test(m[0])?0:m[0]==='明天'?1:2)).size>1)return null;
  explicitDay=days.some(m=>m[0]==='今天'||m[0]==='明天'||m[0]==='后天');
  s=s.replace(/后天|明天|今天|现在|当前/gu,'');
  const match=s.match(/^(.*?)(?:的)?(?:天气(?:预报)?|气温)(?:是)?(?:怎么样|如何|怎样|多少度|是多少度|多少|是什么|情况|好不好)?(?:呀|啊|呢|吗)?$/u);
  if(!match)return null;
  let city=match[1].replace(/的$/u,'').replace(/市$/u,'');
  if(city==='这里'||city==='本地')city='';
  if(city&&!/^[\p{Script=Han}A-Za-z·]{2,20}$/u.test(city))return null;
  if(/昨天|上周|下周|周末|小时|未来|哪里|什么|怎么|为啥|世界|全国|趋势|比较/u.test(city))return null;
  return {city:city||'北京',day,forecast:explicitDay||/预报/u.test(text)};
}
function beijingDay(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))}
export function createWeatherService({fetcher=fetch,now=()=>Date.now(),cacheMs=300000,timeoutMs=3500}={}){
  const cache=new Map(),pending=new Map(),cities=new Map(CITIES);
  async function json(url){
    const response=await fetcher(url,{signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok)throw Error('weather_http');
    return response.json();
  }
  async function locate(name){
    if(cities.has(name))return cities.get(name);
    const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search=new URLSearchParams({name,count:'8',language:'zh',format:'json'}).toString();
    const data=await json(url);
    const matches=(data.results||[]).filter(r=>r.name?.replace(/市$/u,'')===name&&Number.isFinite(r.latitude)&&Number.isFinite(r.longitude));
    const domestic=matches.filter(r=>r.country_code==='CN');
    const choices=domestic.length?domestic:matches;
    if(choices.length!==1)throw Error('weather_city');
    const city={name,latitude:choices[0].latitude,longitude:choices[0].longitude};
    if(cities.size>=64)cities.delete(cities.keys().next().value);
    cities.set(name,city);return city;
  }
  async function load(name){
    const stored=cache.get(name),instant=now();
    if(stored&&instant-stored.at<cacheMs&&stored.date===beijingDay(instant))return stored.data;
    if(pending.has(name))return pending.get(name);
    const work=(async()=>{
      const city=await locate(name);
      const url=new URL('https://api.open-meteo.com/v1/forecast');
      url.search=new URLSearchParams({latitude:String(city.latitude),longitude:String(city.longitude),current:'temperature_2m,weather_code',daily:'temperature_2m_max,temperature_2m_min,weather_code',forecast_days:'3',timezone:'Asia/Shanghai'}).toString();
      const data=await json(url),stamp=Date.parse(String(data.current?.time)+'+08:00');
      if(!Number.isFinite(data.current?.temperature_2m)||data.current.temperature_2m< -90||data.current.temperature_2m>65||!condition(data.current.weather_code)||!Number.isFinite(stamp)||Math.abs(now()-stamp)>2*3600000)throw Error('weather_invalid');
      if(cache.size>=64)cache.delete(cache.keys().next().value);
      cache.set(name,{at:now(),date:beijingDay(now()),data});return data;
    })();
    pending.set(name,work);
    try{return await work}finally{pending.delete(name)}
  }
  async function reply(intent){
    try{
      const data=await load(intent.city),current=data.current;
      if(!intent.forecast)return intent.city+'现在'+condition(current.weather_code)+'，气温'+current.temperature_2m.toFixed(1)+'摄氏度。';
      const target=beijingDay(now()+intent.day*86400000),index=data.daily?.time?.indexOf(target);
      const low=data.daily?.temperature_2m_min?.[index],high=data.daily?.temperature_2m_max?.[index],desc=condition(data.daily?.weather_code?.[index]);
      if(index<0||!Number.isFinite(low)||!Number.isFinite(high)||low>high||!desc)throw Error('weather_forecast');
      const day=['今天','明天','后天'][intent.day];
      return intent.city+day+'预计'+desc+'，'+low.toFixed(0)+'到'+high.toFixed(0)+'摄氏度。'+(intent.day===0?'现在'+current.temperature_2m.toFixed(1)+'摄氏度。':'');
    }catch(error){return error.message==='weather_city'?'没有确定这个城市，请说完整城市名。':'暂时没查到最新天气，请稍后再问。'}
  }
  return {reply,warm:()=>load('北京').catch(()=>null)};
}
