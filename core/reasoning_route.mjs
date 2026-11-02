// Timed, conditional, and chained instructions get a reasoning turn.
export function reasoningEffort(text,defaultEffort='none'){
  const s=String(text);
  return /(?:定时|设定|设置|预约|提醒|今晚|今夜|明天|后天|每天|每晚|每周|凌晨|下午|晚上|早上|到时候|[0-9零〇一二两三四五六七八九十]{1,3}(?:点|时|分钟后|小时后)|如果|当.+(?:时|就)|低于|高于|超过|先.+再|然后|分析|推导|设计|比较|怎么实现|详细解释|为什么)/u.test(s)?'low':defaultEffort;
}
