// Exact conversational courtesies only. Never fabricate device state or control results.
export function quickReply(text){
  const value=String(text).replace(/[\s，。？！、,.!?]/g,'');
  if(/^(在吗|你在吗|在不在|你在不在){1,3}$/.test(value))return '我在，请说。';
  if(/^(你好|您好|嗨|哈喽){1,3}$/.test(value))return '你好，有什么我能帮你的？';
  if(/^(谢谢|谢谢你|多谢){1,3}$/.test(value))return '不客气。';
  return null;
}
