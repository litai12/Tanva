const fs=require('node:fs');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {MARK,planAudit}=require('./referral-priority-audit.cjs');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function load(tx,accountId,at){
  const account=await tx.creditAccount.findUniqueOrThrow({where:{id:accountId}});
  const transactions=await tx.creditTransaction.findMany({where:{accountId},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  const lots=await tx.creditLot.findMany({where:{accountId},orderBy:{id:'asc'}});
  const usage=await tx.apiUsageRecord.findMany({where:{id:{in:transactions.map(t=>t.apiUsageId).filter(Boolean)}},select:{id:true,responseStatus:true,creditsUsed:true}});
  return {account,transactions,lots,usage,at};
}
async function applyOne(tx,input,plan,backupHash){
  const marker=`${MARK}:${input.account.id}`;
  const byLot=new Map(input.lots.map(l=>[l.id,l]));
  const byTx=new Map(input.transactions.map(t=>[t.id,t]));
  for(const r of plan.rewards){
    const original=byTx.get(r.id);
    const audit={referralPriorityAudit:MARK,legacyReferralUnverified:false,auditedAt:input.at,consumedWithEvidence:r.consumed,lawfulDecay:r.lawfulDecay,unknownPreviouslyConsumed:r.unknownPreviouslyConsumed,backupHash};
    if(r.create){
      await tx.creditLot.create({data:{id:r.lotId,accountId:input.account.id,sourceType:'gift',validityType:'permanent',scopeType:'global',totalAmount:r.amount,remainingAmount:r.remainingAfter,status:r.remainingAfter?'active':'exhausted',grantedAt:original.createdAt,activeAt:original.createdAt,metadata:{grantedBy:'referral_reward',originalTransactionId:r.id,...audit}}});
      await tx.creditTransaction.update({where:{id:r.id},data:{creditLotId:r.lotId,metadata:{...original.metadata,...audit}}});
    }else{
      const lot=byLot.get(r.lotId);
      await tx.creditLot.update({where:{id:r.lotId},data:{remainingAmount:r.remainingAfter,status:r.remainingAfter?'active':'exhausted',metadata:{...lot.metadata,...audit}}});
    }
  }
  for(const [id,amount] of Object.entries(plan.restoredLots)){
    await tx.creditLot.update({where:{id},data:{remainingAmount:{increment:amount},status:'active'}});
  }
  for(const c of plan.changes){
    const original=byTx.get(c.id);
    // Preserve original expire amount/balance transitions; return excess through
    // a separate positive reconciliation entry, never rewrite financial history.
    const metadata={...original.metadata,referralPriorityAudit:{version:MARK,backupHash,originalDeductions:c.originalDeductions,correctedDeductions:c.deductions}};
    if(c.type==='spend')metadata.deductions=c.deductions;
    await tx.creditTransaction.update({where:{id:c.id},data:{metadata}});
  }
  if(plan.refund)await tx.creditAccount.update({where:{id:input.account.id},data:{balance:{increment:plan.refund}}});
  await tx.creditTransaction.create({data:{id:marker,accountId:input.account.id,type:'admin_adjust',businessType:'credit_reconciliation',amount:plan.refund,balanceBefore:plan.before,balanceAfter:plan.after,description:plan.refund?'邀请奖励逐笔对账：返还重复衰减积分':'邀请奖励逐笔对账：修正消费归属',metadata:{reconciliation:MARK,backupHash,rewardIds:plan.rewards.map(r=>r.id),restoredLots:plan.restoredLots,decayRefunds:plan.decayRefunds,reassignedSpendIds:plan.changes.filter(c=>c.type==='spend').map(c=>c.id),preserveEarnedAndSpentCounters:true}}});
  const after=await tx.creditAccount.findUniqueOrThrow({where:{id:input.account.id}});
  assert.equal(after.balance,plan.after);assert.equal(after.totalEarned,input.account.totalEarned);assert.equal(after.totalSpent,input.account.totalSpent);
  const active=await tx.creditLot.aggregate({where:{accountId:after.id,status:'active'},_sum:{remainingAmount:true}});
  assert((active._sum.remainingAmount||0)<=after.balance,'Post-write source balance exceeds account balance');
  return {accountId:after.id,status:'repaired',before:plan.before,after:plan.after,refund:plan.refund,restoredPaid:Object.values(plan.restoredLots).reduce((s,n)=>s+n,0)};
}
async function main(){
  require('dotenv').config({quiet:true});const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
  const report=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const apply=process.argv.includes('--apply');
  const dir=process.env.CREDIT_REPAIR_BACKUP_DIR;assert(dir,'Set private CREDIT_REPAIR_BACKUP_DIR');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const results=[];
  try{for(const row of report){
    if(!['repair','link','unchanged'].includes(row.status)||!row.plan.rewards.length)continue;
    try{const result=await p.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "CreditAccount" WHERE id=${row.plan.accountId} FOR UPDATE`;
      if(await tx.creditTransaction.findUnique({where:{id:`${MARK}:${row.plan.accountId}`}}))return{accountId:row.plan.accountId,status:'already'};
      const input=await load(tx,row.plan.accountId,row.at);const plan=planAudit(input);
      assert.equal(digest(plan),digest(row.plan),'Account changed since audit; rescan required');
      // Unknown source depletion may not be asserted as proven consumption.
      assert(plan.rewards.every(r=>!r.unknownPreviouslyConsumed),'Unverified historical depletion needs review');
      if(!apply)return{accountId:plan.accountId,status:'validated',refund:plan.refund};
      const hash=digest(input);const file=`${dir}/${MARK}-${input.account.id}-${Date.now()}.json`;fs.writeFileSync(file,JSON.stringify({hash,input,plan}),{mode:0o600,flag:'wx'});
      return{...await applyOne(tx,input,plan,hash),backup:file};
    },{isolationLevel:'Serializable',timeout:30000});results.push(result);
    }catch(e){results.push({accountId:row.plan.accountId,status:'review',reason:e.message});}
    if(results.length%25===0)console.log(JSON.stringify({processed:results.length}));
  }
  const file=`${dir}/${MARK}-${apply?'receipt':'validation'}-${Date.now()}.json`;fs.writeFileSync(file,JSON.stringify(results),{mode:0o600,flag:'wx'});
  const counts={};for(const r of results)counts[r.status]=(counts[r.status]||0)+1;console.log(JSON.stringify({file,counts,refund:results.filter(r=>r.status==='repaired').reduce((s,r)=>s+r.refund,0),review:results.filter(r=>r.status==='review')},null,2));
  }finally{await p.$disconnect();}
}
module.exports={applyOne,load};if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
