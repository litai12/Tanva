const { createRequire } = require('node:module');
const requireBackend = createRequire('/www/wwwroot/tanvas.cn/backend/package.json');
requireBackend('reflect-metadata');
requireBackend('dotenv').config({path:'/www/wwwroot/tanvas.cn/backend/.env',quiet:true});
const {ConfigService}=requireBackend('@nestjs/config');
const {XiaotAgentService}=requireBackend('./dist/agent/xiaot-agent.service.js');
const assert=require('node:assert/strict');
let charges=0, submits=0, contextResults=0, final='';
const patches=[];
const started=Date.now(), sessionId='handoff-patch-smoke-'+started;
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,init)=>{
 if(String(url).endsWith('/v1/chat/completions')) {
  submits++;
  const body=JSON.parse(init.body);
  if(JSON.stringify(body.messages).includes('host_tool_results')) contextResults++;
  console.log(JSON.stringify({event:'submit',submits,contextResults,elapsedMs:Date.now()-started}));
 }
 return originalFetch(url,init);
};
const service=new XiaotAgentService(new ConfigService({...process.env,XIAOT_AGENT_TIMEOUT_MS:'240000'}),{deductExact:async()=>{charges++;}},{});
const secret='CANARY-'+require('node:crypto').randomBytes(6).toString('hex');
console.log(JSON.stringify({event:'start',sessionId}));
service.run({sessionId,mode:'canvasAgent',prompt:'读取节点 smoke-note 的正文，把它原样复制成一个新的文本节点 copy-note。只创建这一个副本，不运行生成任务。',
 capabilityManifest:{protocol_version:'1',host:'tanva',patchOps:['addNode','focusNode'],nodeSpecs:[{type:'textPrompt',label:'文本',params:{text:{type:'string'}},inputs:[],outputs:[]}],hostTools:[{name:'query_canvas',description:'查询当前画布局部节点的真实数据',parameters:{scope:{type:'string',enum:['summary','selected','ids','neighbors','search']},nodeIds:{type:'array',items:{type:'string'}},query:{type:'string'}}}],ui:['request_user_input']},
 canvasContext:{nodes:[{id:'smoke-note',type:'textPrompt',data:{text:secret}}],edges:[]}
},'diagnostic-host-handoff',(type,payload)=>{
 if(type==='final') final=payload.message||'';
 if(type==='flow_patch') patches.push(payload.data.patch);
 console.log(JSON.stringify({event:type,title:payload.title,elapsedMs:Date.now()-started,...(type==='final'?{text:final}:{}),...(type==='flow_patch'?{patch:payload.data}:{})}));
}).then(()=>{
 assert.ok(submits>=2,'must return real query results in a second request');
 assert.ok(contextResults>=1,'must send host query results');
 assert.ok(patches.some(p=>p.op==='addNode' && p.node?.id==='copy-note' && p.node.data?.text===secret),'must emit a real addNode command containing the queried hidden fixture value');
 assert.equal(charges,1,'exactly one completed chat settlement');
 console.log(JSON.stringify({result:'PASS',sessionId,submits,contextResults,charges,patchCount:patches.length,elapsedMs:Date.now()-started}));
}).catch(error=>{console.error(JSON.stringify({result:'FAIL',sessionId,error:error.message,elapsedMs:Date.now()-started}));process.exitCode=1;});
