export function readPcmWav(buffer){
  if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE')throw new Error('不是 WAV 音频。');
  let pcm,format;
  for(let pos=12;pos+8<=buffer.length;){const type=buffer.toString('ascii',pos,pos+4),length=buffer.readUInt32LE(pos+4),start=pos+8;if(start+length>buffer.length)throw new Error('WAV 文件不完整。');if(type==='fmt ')format={codec:buffer.readUInt16LE(start),channels:buffer.readUInt16LE(start+2),rate:buffer.readUInt32LE(start+4),bits:buffer.readUInt16LE(start+14)};if(type==='data')pcm=buffer.subarray(start,start+length);pos=start+length+(length%2);}
  if(!pcm||format?.codec!==1||format.channels!==1||format.rate!==16000||format.bits!==16)throw new Error('测试音频需为 16 kHz 单声道 16 位 PCM WAV。');return pcm;
}
export function makeWav(pcm){
  const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);
}
