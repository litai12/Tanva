// Offline integration check using the existing compiled lifecycle services.
// Run from backend after build: node scripts/test-run-audited-legacy-free-credit-repair.cjs
// All fixtures and identifiers are synthetic. No Prisma client is instantiated.
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname, '..');
const h=require(root+'/scripts/run-legacy-free-credit-repair.cjs');
const w=require(root+'/scripts/run-audited-legacy-free-credit-repair.cjs');
const source=require(root+'/scripts/repair-legacy-free-credit-sources.cjs');
const {CreditsService}=require(root+'/dist/credits/credits.service');
const {MembershipService}=require(root+'/dist/membership/membership.service');
const {BusinessPolicyService}=require(root+'/dist/business-policy/business-policy.service');
const clone=v=>structuredClone(v);
function matches(row,where={}) { return Object.entries(where).every(([key,value])=>{
 if(key==='AND')return value.every(w=>matches(row,w)); if(key==='OR')return value.some(w=>matches(row,w));
 const actual=row[key];if(value&&typeof value==='object'&&!(value instanceof Date)){
  if(value.path){const x=value.path.reduce((a,k)=>a?.[k],actual);return x===value.equals;}
  return Object.entries(value).every(([op,x])=>op==='in'?x.includes(actual):op==='gt'?actual>x:op==='gte'?actual>=x:op==='lt'?actual<x:op==='lte'?actual<=x:op==='equals'?actual===x:assert.fail('Unhandled query operator '+op));
 }return actual===value;
});}
function fake(snapshot,sequenceStart=0) {
 const store={user:[clone(snapshot.user)],creditAccount:[clone(snapshot.account)],creditLot:clone(snapshot.lots),creditTransaction:clone(snapshot.transactions),paymentOrder:clone(snapshot.orders),apiUsageRecord:clone(snapshot.usages),userMembershipSubscription:clone(snapshot.subscriptions),systemSetting:snapshot.policy?[clone(snapshot.policy)]:[]};
 let sequence=sequenceStart;const tx={};
 for(const [name,rows]of Object.entries(store)){
  const find=args=>rows.filter(row=>matches(row,args?.where));
  const select=(row,args)=>row&&args?.select?Object.fromEntries(Object.keys(args.select).map(k=>[k,row[k]])):clone(row);
  const change=(row,data)=>{for(const [k,v]of Object.entries(data))row[k]=v&&typeof v==='object'&&'increment'in v?row[k]+v.increment:clone(v);if(name==='creditLot'&&'updatedAt'in row)row.updatedAt=new Date();return clone(row);};
  tx[name]={findMany:async args=>find(args).map(row=>select(row,args)),findUnique:async args=>select(find(args)[0],args),findFirst:async args=>select(find(args)[0],args),findUniqueOrThrow:async args=>{const row=find(args)[0];assert(row,'not found '+name);return select(row,args);},count:async args=>find(args).length,aggregate:async args=>({_sum:{remainingAmount:find(args).reduce((n,l)=>n+l.remainingAmount,0)}}),updateMany:async args=>{const found=find(args);found.forEach(row=>change(row,args.data));return{count:found.length};},update:async args=>{const row=find(args)[0];assert(row);return change(row,args.data);},create:async args=>{const row={id:'generated-'+(++sequence),createdAt:new Date('2026-09-30T12:00:00Z'),...clone(args.data)};if(name==='creditTransaction')Object.assign(row,{creditLotId:null,expiredAmount:0,isExpired:false,...clone(args.data)});rows.push(row);return clone(row);}};
 }
 tx.$transaction=async fn=>fn(tx);tx.$queryRaw=async()=>[clone(store.creditAccount[0])];return {tx,store};
}
function fixture(zero=false) {
 const accountId='11111111-1111-1111-1111-111111111111',userId='fixture-user',old=new Date('2026-09-28T12:00:00Z'),now=new Date('2026-09-30T12:00:00Z');
 const transactions=[];let wallet=0;
 const add=(id,amount,type,description,metadata={},creditLotId=null)=>{const row={id,accountId,amount,type,description,metadata,creditLotId,balanceBefore:wallet,balanceAfter:wallet+amount,createdAt:new Date(+old+transactions.length*1000),expiredAmount:0,isExpired:false,apiUsageId:null};wallet+=amount;transactions.push(row);return row;};
 const oldGrant=add('old-daily',100,'daily_reward','old daily',{},'old-lot');
 add('signup',500,'earn','新用户注册赠送积分');
 add('unknown',zero?-500:-450,'spend','old ambiguous spend',{deductions:[{kind:'legacy_balance',amount:zero?500:450}]});
 if(!zero) {add('paid',2000,'earn','充值',{orderId:'fixture-order'});add('check',50,'CHECK_IN','old check');}
 add('known-spend',-50,'spend','known lot spend',{deductions:[{kind:'lot',lotId:'old-lot',amount:50}]});
 const lots=[{id:'old-lot',accountId,sourceType:'gift',validityType:'permanent',scopeType:'global',totalAmount:100,remainingAmount:50,status:'active',grantedAt:oldGrant.createdAt,activeAt:oldGrant.createdAt,createdAt:oldGrant.createdAt,updatedAt:oldGrant.createdAt,expiresAt:null,metadata:{reason:'daily_reward'}}];
 const orders=zero?[]:[{id:'fixture-order',orderNo:'fixture-number',userId,status:'paid',orderType:'recharge',teamId:null,membershipPlanId:null,subscriptionId:null,paidAt:old,amount:20,credits:2000}];
 return {now,snapshot:{user:{id:userId,vipEntitlementWhitelist:false},account:{id:accountId,userId,balance:wallet,totalEarned:zero?600:2650,totalSpent:zero?550:500},transactions,lots,orders,usages:[],subscriptions:[],policy:null}};
}
(async()=>{
 const runtime={CreditsService,MembershipService,BusinessPolicyService};
 for(const zero of [false,true]) {
  const {snapshot,now}=fixture(zero),plan=w.planRepair(snapshot,now),beforeHash=h.hash(snapshot),{tx}=fake(snapshot);
  assert.equal(plan.status,'planned');assert.equal(plan.grants.length,zero?1:2);
  assert.equal(plan.proof,zero?'closed_zero_residual_pool':'independently_proven_late_sources');
  const first=await w.execute(tx,snapshot,plan,now,runtime,beforeHash);
  assert.equal(first.result.balanceAfter,snapshot.account.balance-(zero?0:50));
  assert.equal(first.result.expiry.expiredCredits,zero?0:50);assert.equal(first.result.secondExpiry.expiredCredits,0);
  assert.equal(first.result.decayedCredits,0);
  assert.deepEqual(first.after.lots.find(l=>l.id==='old-lot'),snapshot.lots[0]);
  if(!zero){assert.equal(first.after.lots.find(l=>l.id===w.lotIdFor('paid')).remainingAmount,2000);assert.equal(first.result.unknownPoolProtected,50);}
  assert.equal(first.after.account.totalEarned,snapshot.account.totalEarned);assert.equal(first.after.account.totalSpent,snapshot.account.totalSpent);
  assert.equal(first.after.transactions.find(t=>t.id===w.markerFor(snapshot.account.id)).metadata.outcomeHash,first.result.outcomeHash);
  assert.equal(w.outcomeHash(snapshot,first.after),first.result.outcomeHash);
  const other=await w.execute(fake(snapshot,1000).tx,snapshot,plan,now,runtime,beforeHash);assert.deepEqual(other.result,first.result);
  assert.equal(w.planRepair(first.after,now).status,'already_repaired');
 }
 const zero=fixture(true);zero.snapshot.lots[0].metadata.legacyReferralUnverified=true;
 assert.throws(()=>w.planRepair(zero.snapshot,zero.now),/mixed source/);
 const missing=fixture(true);missing.snapshot.transactions[0].creditLotId=null;
 assert.throws(()=>w.planRepair(missing.snapshot,missing.now),/exact original grant|does not close/);
 const ambiguous=fixture(false);ambiguous.snapshot.transactions.at(-1).metadata={deductions:[{kind:'legacy_balance',amount:50}]};
 assert.throws(()=>w.planRepair(ambiguous.snapshot,ambiguous.now),/lot replay|does not close/);
 const migrated=fixture(false);migrated.snapshot.lots[0].metadata.grantedBy='legacy_referral_migration';migrated.snapshot.lots[0].createdAt=new Date('2026-09-29');
 assert.equal(w.planRepair(migrated.snapshot,migrated.now).status,'no_proven_target_sources');
 // A migration after the paid source blocks that source, while a separately
 // proven later check-in can still be attributed without touching latent paid.
 const partial=fixture(false),paidAt=partial.snapshot.transactions.find(t=>t.id==='paid').createdAt;
 partial.snapshot.lots[0].metadata.grantedBy='legacy_referral_migration';partial.snapshot.lots[0].metadata.allocatedFromLegacyBalance=100;
 partial.snapshot.lots[0].createdAt=new Date(+paidAt+500);
 const partialPlan=w.planRepair(partial.snapshot,partial.now);
 assert.deepEqual(partialPlan.grants.map(g=>g.transactionId),['check']);assert.equal(partialPlan.latentPaidUpperBound,2000);
 const partialResult=await w.execute(fake(partial.snapshot).tx,partial.snapshot,partialPlan,partial.now,runtime,h.hash(partial.snapshot));
 assert.equal(partialResult.result.unknownPoolProtected,2050);assert.equal(partialResult.result.expiry.expiredCredits,50);
 // Historical signup amounts are preserved rather than rewritten to today's 500.
 const historic=fixture(true);historic.snapshot.transactions.find(t=>t.id==='signup').amount=100;
 historic.snapshot.transactions.find(t=>t.id==='signup').balanceAfter-=400;
 historic.snapshot.transactions.find(t=>t.id==='unknown').amount=-100;historic.snapshot.transactions.find(t=>t.id==='unknown').balanceBefore-=400;
 historic.snapshot.transactions.find(t=>t.id==='unknown').metadata.deductions[0].amount=100;
 historic.snapshot.account.totalEarned-=400;historic.snapshot.account.totalSpent-=400;
 const historicalPlan=w.planRepair(historic.snapshot,historic.now);assert.equal(historicalPlan.grants[0].lot.totalAmount,100);assert.equal(historicalPlan.grants[0].lot.remainingAmount,0);
 for(const [originalAmount,remaining] of [[500,5],[1000,470],[500,16]]) {
  const promo=fixture(true),s=promo.snapshot;
  const signup=s.transactions.find(t=>t.id==='signup');signup.amount=originalAmount;signup.balanceAfter=100+originalAmount;
  const spend=s.transactions.find(t=>t.id==='unknown');spend.amount=remaining-originalAmount;spend.balanceBefore=100+originalAmount;spend.balanceAfter=100+remaining;spend.metadata={};
  const known=s.transactions.find(t=>t.id==='known-spend');known.amount=-100;known.balanceBefore=100+remaining;known.balanceAfter=remaining;known.metadata.deductions[0].amount=100;
  s.lots[0].remainingAmount=0;s.lots[0].status='exhausted';s.lots[0].sourceType='subscription';s.lots[0].metadata={reason:'membership'};
  s.transactions[0].type='earn';s.transactions[0].description='membership';
  s.account.balance=remaining;s.account.totalEarned=100+originalAmount;s.account.totalSpent=100+originalAmount-remaining;
  s.orders=[{id:'membership-order',userId:s.account.userId,status:'paid',orderType:'membership',paidAt:new Date('2026-09-28'),amount:69,credits:100}];
  const plan=w.planRepair(s,promo.now);assert.equal(plan.runDecay,true);assert.equal(plan.remainingUnknownPool,0);assert.equal(plan.grants[0].lot.remainingAmount,remaining);
  const outcome=await w.execute(fake(s).tx,s,plan,promo.now,runtime,h.hash(s));
  assert.equal(outcome.result.decayedCredits,Math.min(50,remaining));assert.equal(outcome.result.balanceAfter,Math.max(0,remaining-50));assert.equal(outcome.result.secondDecay.decayedCredits,0);
  assert.deepEqual(outcome.after.lots.find(l=>l.id==='old-lot'),s.lots[0]);
  const comparison=await w.execute(fake(s,1000).tx,s,plan,promo.now,runtime,h.hash(s));assert.deepEqual(comparison.result,outcome.result);
  const unsafe=clone(s);unsafe.orders=[];assert.equal(w.planRepair(unsafe,promo.now).runDecay,false);
 }
 // A missing old opening balance is independent of the later named source.
 const gap=fixture(true),s=gap.snapshot;s.transactions=[];s.lots=[];s.account.balance=52;s.account.totalEarned=50;s.account.totalSpent=0;
 s.transactions.push({id:'gap-check',accountId:s.account.id,type:'CHECK_IN',amount:50,balanceBefore:2,balanceAfter:52,createdAt:new Date('2026-09-28'),creditLotId:null,expiredAmount:0,isExpired:false,metadata:{},apiUsageId:null});
 const gapPlan=w.planRepair(s,gap.now);assert.equal(gapPlan.proof,'independent_suffix_after_earlier_gap');assert.equal(gapPlan.remainingUnknownPool,2);assert.equal(gapPlan.runDecay,false);
 const gapResult=await w.execute(fake(s).tx,s,gapPlan,gap.now,runtime,h.hash(s));assert.equal(gapResult.result.balanceAfter,2);assert.equal(gapResult.result.expiry.expiredCredits,50);assert.equal(gapResult.result.decayedCredits,0);
 const blocked=clone(s);blocked.transactions.push({id:'unknown-later',accountId:s.account.id,type:'spend',amount:-1,balanceBefore:52,balanceAfter:51,createdAt:new Date('2026-09-29'),creditLotId:null,metadata:{}});blocked.account.balance=51;
 assert.throws(()=>w.planRepair(blocked,gap.now),/no independent suffix/);
 console.log('Audited integration passed: exact paid/CHECK_IN and zero pools; promo 5/470/16 -> 0/420/0 with one daily decay; wallet gap 52 -> 2; old lots/unknown paid protected; repeated expiry/decay zero; preview hashes stable; invalid evidence excluded');
})().catch(error=>{console.error(error);process.exitCode=1;});
