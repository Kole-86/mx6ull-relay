import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { findCodex } from './codex.mjs';

export class CodexServer {
  constructor(config={}){
    this.config=config;this.serial=0;this.requests=new Map();this.turns=new Map();this.sessions=new Map();this.closed=false;this.stderr='';this.started=performance.now();
    const args=['app-server','--listen','stdio://','-c','approval_policy="never"','-c','sandbox_mode="read-only"','-c','web_search="disabled"','-c','model_reasoning_effort="low"',
      '-c','mcp_servers.cua_repl.enabled=false','-c','mcp_servers.node_repl.enabled=false','-c','analytics.enabled=false'];
    for(const feature of ['shell_tool','apps','plugins','multi_agent','browser_use','computer_use','search_tool','standalone_web_search','hooks','memories'])args.push('--disable',feature);
    const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('CODEX_')&&key!=='CODEX_HOME')delete env[key];
    this.process=spawn(findCodex(config),args,{stdio:['pipe','pipe','pipe'],windowsHide:true,cwd:resolve('data/answer-workspace'),env});
    this.process.stderr.on('data',s=>this.stderr=(this.stderr+s.toString()).slice(-3000));this.process.stdin.on('error',()=>{});
    createInterface({input:this.process.stdout}).on('line',line=>this.message(line));
    this.process.on('error',e=>this.abort(e));this.process.on('exit',()=>this.abort(new Error('Codex 常驻进程已停止。')));
    this.ready=(async()=>{
      await this.rpc('initialize',{clientInfo:{name:'maixcam_voice_lab',title:'Private voice lab',version:'1.0.0'},capabilities:{experimentalApi:true}});
      this.notify('initialized',{});this.startupMs=Math.round(performance.now()-this.started);
    })();
  }
  rpc(method,params){
    if(this.closed)return Promise.reject(new Error('Codex server is closed'));
    const id=++this.serial;
    return new Promise((yes,no)=>{const timer=setTimeout(()=>{this.requests.delete(id);no(new Error('Codex RPC timeout: '+method))},30000);this.requests.set(id,{yes,no,timer});this.process.stdin.write(JSON.stringify({id,method,params})+'\n')});
  }
  notify(method,params){if(!this.closed)this.process.stdin.write(JSON.stringify({method,params})+'\n')}
  message(line){
    let msg;try{msg=JSON.parse(line)}catch{return}
    if(msg.id!==undefined&&!msg.method){const request=this.requests.get(msg.id);if(!request)return;this.requests.delete(msg.id);clearTimeout(request.timer);if(msg.error)request.no(new Error(msg.error.message));else request.yes(msg.result);return;}
    // This integration does not execute server-requested tools or grant approvals.
    if(msg.id!==undefined&&msg.method){this.process.stdin.write(JSON.stringify({id:msg.id,error:{code:-32601,message:'Voice answer-only client does not execute tools or grant permissions'}})+'\n');return;}
    const p=msg.params||{},task=this.turns.get(p.threadId);
    if(!task)return;
    if(msg.method==='item/agentMessage/delta'){
      if(p.delta&&!task.firstTokenMs)task.firstTokenMs=performance.now()-task.started;
      task.deltas+=p.delta||'';task.onDelta?.(p.delta||'');
    }
    if(msg.method==='item/completed'&&p.item?.type==='agentMessage')task.final=p.item.text;
    if(msg.method==='thread/tokenUsage/updated')task.usage=p.tokenUsage?.last;
    if(msg.method==='turn/completed'){
      clearTimeout(task.timer);this.turns.delete(p.threadId);
      if(p.turn?.status!=='completed')task.no(new Error(p.turn?.error?.message||'Codex turn failed'));
      else task.yes({text:(task.final||task.deltas).trim(),firstTokenMs:Math.round(task.firstTokenMs||0),turnMs:Math.round(performance.now()-task.started),threadMs:task.threadMs,model:task.model,effort:task.effort,serviceTier:task.serviceTier,effectiveThreadEffort:task.effectiveThreadEffort,usage:task.usage});
    }
  }
  async models(){await this.ready;return (await this.rpc('model/list',{includeHidden:false})).data;}
  async ask(text,history=[],options={}){
    await this.ready;
    const model=options.model||this.config.voiceModel||'gpt-6-luna',effort=options.effort||this.config.voiceEffort||'low';
    const serviceTier=options.serviceTier||'default';
    if(!['default','fast'].includes(serviceTier))throw new Error('Unsupported service tier');
    const began=performance.now();
    const sessionKey=options.sessionKey?JSON.stringify([options.sessionKey,model,serviceTier]):null;
    for(const [key,session] of this.sessions)if(Date.now()-session.at>600000||session.turns>=12){this.sessions.delete(key);await this.rpc('thread/unsubscribe',{threadId:session.thread.thread.id}).catch(()=>{})}
    let session=sessionKey?this.sessions.get(sessionKey):null;
    if(session&&this.turns.has(session.thread.thread.id))throw new Error('Device session is busy');
    const reused=!!session;
    const thread=session?.thread||await this.rpc('thread/start',{
      model,ephemeral:true,cwd:resolve('data/answer-workspace'),approvalPolicy:'never',sandbox:'read-only',serviceTier,
      baseInstructions:'你是用户私人设备上的中文语音问答助手。直接给出自然、简短、适合朗读的回答。不要运行命令、读写文件、调用工具或声称执行了任何操作。日常问题尽量在80个汉字内回答；不能确定的事实如实说明。',
      developerInstructions:'输入 JSON 中 question 是本次问题，history 是近期对话。输出纯文本答案，不使用 Markdown，不输出 JSON，不发送进度说明。对于定时、条件、多步设备指令，先理解要求；时间或目标不明确时简短询问。context 提供当前时间、时区和设备能力；没有设备执行回执或定时任务保存回执，不能声称已经执行或已设定任务。',
      config:{model_reasoning_effort:effort,web_search:'disabled',service_tier:serviceTier}
    });
    if(thread.thread.ephemeral!==true)throw new Error('语音任务必须使用不落盘的临时会话。');
    if(sessionKey&&!session){
      if(this.sessions.size>=30){const [key,old]=this.sessions.entries().next().value;this.sessions.delete(key);await this.rpc('thread/unsubscribe',{threadId:old.thread.thread.id}).catch(()=>{})}
      session={thread,at:Date.now(),turns:0};this.sessions.set(sessionKey,session);
    }
    const threadId=thread.thread.id,threadMs=Math.round(performance.now()-began);
    let completed=false;
    try{
      const response=new Promise((yes,no)=>{
        const timer=setTimeout(()=>{void this.rpc('turn/interrupt',{threadId,turnId:this.turns.get(threadId)?.turnId}).catch(()=>{});this.turns.delete(threadId);no(Object.assign(new Error('Codex 回答超时'),{code:'codex_timeout'}))},this.config.timeoutMs||90000);
        this.turns.set(threadId,{yes,no,timer,started:performance.now(),threadMs,model,effort,serviceTier,effectiveThreadEffort:thread.reasoningEffort,deltas:'',final:'',onDelta:options.onDelta});
      });
      // Attach a rejection handler before awaiting the start response.
      response.catch(()=>{});
      const input=[{type:'text',text:JSON.stringify({history:reused?[]:history,question:text,...(options.context?{context:options.context}:{})})}];
      for(const path of options.images||[])input.push({type:'localImage',path});
      const start=await this.rpc('turn/start',{threadId,model,effort,serviceTierForTurn:serviceTier,approvalPolicy:'never',sandboxPolicy:{type:'readOnly'},input});
      const task=this.turns.get(threadId);if(task)task.turnId=start.turn.id;
      const result=await response;completed=true;if(session){session.at=Date.now();session.turns++}result.totalMs=Math.round(performance.now()-began);result.reusedSession=reused;return result;
    }finally{
      const task=this.turns.get(threadId);if(task){clearTimeout(task.timer);this.turns.delete(threadId)}
      if(!sessionKey||!completed){if(sessionKey)this.sessions.delete(sessionKey);await this.rpc('thread/unsubscribe',{threadId}).catch(()=>{});}
    }
  }
  abort(error){
    if(this.closed)return;this.closed=true;
    for(const r of this.requests.values()){clearTimeout(r.timer);r.no(error)}this.requests.clear();
    for(const t of this.turns.values()){clearTimeout(t.timer);t.no(error)}this.turns.clear();
    this.sessions.clear();
  }
  close(){this.abort(new Error('Codex server closed'));this.process.kill()}
}
