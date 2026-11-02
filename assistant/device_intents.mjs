// Exact, bounded instructions only. Complex questions still go to the model.
export function deviceIntent(text){
  if(typeof text!=='string')return null;
  let s=text.trim().toLowerCase().replace(/[\s，。！？,.!?、]/gu,'');
  s=s.replace(/^(?:请|麻烦你?|帮我|给我|请你|请帮我)+/u,'').replace(/(?:一下|吧|谢谢|吗|呢|呀|啊)$/u,'');
  s=s.replace(/(?:imx6ull|imx板子|imx板|开发板|板子|板)上的?/gu,'');
  if(/^(?:开灯|打开(?:灯|led灯?|指示灯)|把(?:灯|led灯?|指示灯)打开|(?:灯|led灯?|指示灯)打开)$/u.test(s))return {action:'set_led',value:true};
  if(/^(?:关灯|关闭(?:灯|led灯?|指示灯)|关掉(?:灯|led灯?|指示灯)|把(?:灯|led灯?|指示灯)(?:关闭|关掉)|(?:灯|led灯?|指示灯)关闭)$/u.test(s))return {action:'set_led',value:false};
  if(/^(?:(?:现在|当前)(?:的)?)?(?:查(?:一下|询)?|读取|读一下|查看|告诉我)?(?:现在|当前)?(?:的)?温度(?:是多少度?|多少度?|几度|是多少|多少)?$/u.test(s))return {action:'read_temperature'};
  if(/^(?:(?:现在|当前)(?:的)?)?(?:查(?:一下|询)?|读取|读一下|查看|告诉我)?(?:现在|当前)?(?:的)?(?:光照|光照强度|照度)(?:是多少度?|多少度?|是多少|多少)?$/u.test(s))return {action:'read_light'};
  return null;
}

// Success text is spoken only from a fresh board receipt.
export async function deviceReply(intent,transport){
  if(!transport)return 'IMX6ULL 还未接入新站，暂时无法执行或读取。';
  let reply;
  try{reply=await transport(intent)}catch{return '没有收到板子的确认，请检查连接。'}
  if(intent.action==='read_light'){
    if(!reply||reply.ok!==true||typeof reply.illuminance_lux!=='number'||!Number.isFinite(reply.illuminance_lux)||reply.illuminance_lux<0||reply.illuminance_lux>30000)return '没有确认到当前光照，请检查板子连接或光照传感器。';
    return '当前光照'+reply.illuminance_lux.toFixed(1)+'勒克斯。';
  }
  if(intent.action==='read_temperature'){
    if(!reply||reply.ok!==true||typeof reply.temperature_c!=='number'||!Number.isFinite(reply.temperature_c))return '没有确认到当前芯片温度。';
    return '当前芯片温度'+reply.temperature_c.toFixed(1)+'摄氏度。';
  }
  if(!reply||reply.ok!==true)return '板子未确认本次操作，请检查设备。';
  if(intent.action==='set_led')return reply.led===intent.value?(intent.value?'灯已打开。':'灯已关闭。'):'板子返回的灯状态与指令不一致。';
  return '板子没有返回有效的传感器读数。';
}
