// Offline integration check using the existing compiled lifecycle services.
// Run from backend after build: node scripts/test-run-legacy-free-credit-repair.cjs
// All fixtures and identifiers are synthetic. No Prisma client is instantiated.
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname, '..');
const w=require(root+'/scripts/run-legacy-free-credit-repair.cjs');
const source=require(root+'/scripts/repair-legacy-free-credit-sources.cjs');
const {CreditsService}=require(root+'/dist/credits/credits.service');
const {MembershipService}=require(root+'/dist/membership/membership.service');
const {BusinessPolicyService}=require(root+'/dist/business-policy/business-policy.service');
const {isFreeCreditDecayLot}=require(root+'/dist/credits/free-credit-decay-policy');
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
  tx[name]={findMany:async args=>find(args).map(row=>select(row,args)),findUnique:async args=>select(find(args)[0],args),findFirst:async args=>select(find(args)[0],args),findUniqueOrThrow:async args=>{const row=find(args)[0];assert(row,'not found '+name);return select(row,args);},count:async args=>find(args).length,aggregate:async args=>({_sum:{remainingAmount:find(args).reduce((n,l)=>n+l.remainingAmount,0)}}),updateMany:async args=>{const found=find(args);found.forEach(row=>change(row,args.data));return{count:found.length};},update:async args=>{const row=find(args)[0];assert(row);return change(row,args.data);},create:async args=>{const row={id:'generated-'+(++sequence),createdAt:new Date(),...clone(args.data)};if(name==='creditTransaction')Object.assign(row,{creditLotId:null,expiredAmount:0,isExpired:false,...clone(args.data)});rows.push(row);return clone(row);}};
 }
 tx.$transaction=async fn=>fn(tx);tx.$queryRaw=async()=>[clone(store.creditAccount[0])];return {tx,store};
}
function fixture(second=false){
 const userId=second?'fixture-user-2':'fixture-user-1', accountId=second?'22222222-2222-2222-2222-222222222222':'11111111-1111-1111-1111-111111111111';
 const now=new Date('2026-09-30T12:00:00.000Z'),old=new Date('2026-09-28T12:00:00.000Z');
 const amounts=second?[500,500,2000]:[500,48000,100];let balance=0;
 const transactions=amounts.map((amount,i)=>{const row={id:'tx'+i,accountId,type:i===2&&!second?'CHECK_IN':'earn',amount,balanceBefore:balance,balanceAfter:balance+amount,description:i===0?'新用户注册赠送积分':i===(second?2:1)?'充值':'被邀请注册额外赠送积分',createdAt:new Date(old.getTime()+i*1000),creditLotId:null,expiredAmount:0,isExpired:false,metadata:i===(second?2:1)?{orderId:'order'}:second&&i===1?{inviterUserId:'inviter'}:{}};balance+=amount;return row;});
 const lots=second?[]:[{id:'existing-recharge',accountId,sourceType:'recharge',validityType:'permanent',scopeType:'global',totalAmount:48000,remainingAmount:48000,status:'active',grantedAt:transactions[1].createdAt,activeAt:transactions[1].createdAt,expiresAt:null,orderId:'order',metadata:{reason:'recharge'},createdAt:old,updatedAt:old}];
 if(!second)transactions[1].creditLotId='existing-recharge';
 return {now,snapshot:{user:{id:userId,vipEntitlementWhitelist:false},account:{id:accountId,userId,balance,totalEarned:balance,totalSpent:0},transactions,lots,orders:[{id:'order',orderNo:'number',userId,status:'paid',orderType:'recharge',teamId:null,membershipPlanId:null,subscriptionId:null,paidAt:old,amount:amounts[second?2:1]/100,credits:amounts[second?2:1]}],usages:[],subscriptions:[],policy:null}};
}
(async()=>{
 for(const second of[false,true]){
  const {snapshot,now}=fixture(second), {tx}=fake(snapshot),plan=source.planRepair(snapshot,now),before={evidence:snapshot};
  const runtime={source,CreditsService,MembershipService,BusinessPolicyService,isFreeCreditDecayLot};
  const result=await w.executeServices(tx,before,plan,now,runtime,w.hash(before));
  assert.equal(result.balanceAfter,second?2950:48450);
  assert.equal(result.balances.recharge,second?2000:48000);
  assert.equal(result.balances.free,second?950:450);
  assert.equal(result.balances.checkIn,0);
  assert.equal(result.expiry.expiredCredits,second?0:100);
  assert.equal(result.decay.decayedCredits,50);
  assert.equal(result.repeatExpiry.expiredCredits,0);assert.equal(result.repeatDecay.decayedCredits,0);
  // Preview and apply independently generate different financial transaction
  // IDs/times. Their reviewed semantic outcomes must still match exactly.
  const another=fake(snapshot,1000);
  const comparison=await w.executeServices(another.tx,before,plan,now,runtime,w.hash(before));
  const {after:ignoredAfter,...reviewable}=result;
  const {after:ignoredComparison,...comparable}=comparison;
  assert.deepEqual(comparable,reviewable);
  const current=await source.loadSnapshot(tx,snapshot.user.id);
  const sourceAgain=await source.applyOne(tx,snapshot,{previewHash:w.hash(before),now});assert.equal(sourceAgain.status,'already_repaired');
  assert.deepEqual(await source.loadSnapshot(tx,snapshot.user.id),current);
  console.log(second?'Second account: 3000 -> 2950, recharge 2000 unchanged, repeat 0':'Target: 48600 -> 48450, recharge 48000 unchanged, CHECK_IN type preserved, repeat 0');
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
