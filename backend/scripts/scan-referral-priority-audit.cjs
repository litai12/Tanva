// Read-only per-account replay. Evidence stays in a private operator directory.
const fs=require('node:fs');
const path=require('node:path');
const {planAudit}=require('./referral-priority-audit.cjs');
const {load}=require('./apply-referral-priority-audit.cjs');
async function main(){
  require('dotenv').config({quiet:true});const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
  const dir=path.resolve(process.argv[2]||'');if(!process.argv[2])throw new Error('Provide a private output directory');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});const rows=[];
  try{
    const ids=await p.creditTransaction.findMany({where:{type:'REFERRAL_REWARD',amount:{gt:0}},distinct:['accountId'],select:{accountId:true},orderBy:{accountId:'asc'}});
    for(const {accountId} of ids){
      const at=new Date().toISOString();
      const input=await p.$transaction(tx=>load(tx,accountId,at),{isolationLevel:'RepeatableRead',timeout:30000});
      try{
        const plan=planAudit(input);rows.push({at,status:plan.changes.length?'repair':plan.rewards.some(r=>r.create)?'link':'unchanged',plan});
      }catch(e){
        const evidence=path.join(dir,`review-${accountId}.json`);
        fs.writeFileSync(evidence,JSON.stringify(input),{mode:0o600,flag:'wx'});
        rows.push({at,status:'review',accountId,reason:e.message,evidence});
      }
      if(rows.length%50===0)console.log(JSON.stringify({scanned:rows.length,total:ids.length}));
    }
    const file=path.join(dir,'report.json');fs.writeFileSync(file,JSON.stringify(rows),{mode:0o600,flag:'wx'});
    const counts={},reasons={};for(const r of rows){counts[r.status]=(counts[r.status]||0)+1;if(r.reason){const reason=r.reason.split('\n')[0];reasons[reason]=(reasons[reason]||0)+1;}}
    console.log(JSON.stringify({file,counts,reasons,provenRefund:rows.reduce((s,r)=>s+(r.plan?.refund||0),0)},null,2));
  }finally{await p.$disconnect();}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
