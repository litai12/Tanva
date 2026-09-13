const assert = require('node:assert/strict');
const { unambiguousSpendIds } = require('./settled-consumption-evidence.cjs');
const MARK = 'referral-priority-audit-v3';
const time = x => +new Date(x);
const sum = xs => xs.reduce((s, x) => s + x, 0);
const ds = t => Array.isArray(t.metadata?.deductions) ? t.metadata.deductions : [];
const sameParts=(a,b)=>JSON.stringify(a.map(d=>[d.kind,d.lotId||null,d.transactionId||null,d.amount]))===JSON.stringify(b.map(d=>[d.kind,d.lotId||null,d.transactionId||null,d.amount]));

// Conservative correction of documented recharge -> referral priority violations.
// Existing higher-priority deductions are preserved. Missing source evidence is
// never invented; uncertain accounts are reported instead of silently repaired.
function planAudit({ account, transactions, lots, usage, at }) {
  const now = time(at), byLot = new Map(lots.map(l => [l.id, l]));
  const txs = [...transactions].sort((a,b)=>time(a.createdAt)-time(b.createdAt)||a.id.localeCompare(b.id));
  const rewards = txs.filter(t=>t.type==='REFERRAL_REWARD'&&t.amount>0);
  const fixed = rewards.filter(r=>byLot.get(r.creditLotId)?.metadata?.consumedBeforeDecay || byLot.get(r.creditLotId)?.metadata?.referralPriorityAudit===MARK);
  const targets = rewards.filter(r=>!fixed.includes(r));
  const byReward = new Map(targets.map(r=>[r.id,r]));
  const lotReward = new Map(targets.filter(r=>r.creditLotId).map(r=>[r.creditLotId,r]));
  const ref = d => d.kind==='legacy_referral' ? byReward.get(d.transactionId) : d.kind==='lot' ? lotReward.get(d.lotId) : null;
  const paid = l => l?.sourceType==='recharge' && ['active','exhausted'].includes(l.status) && (!l.expiresAt||time(l.expiresAt)>now) && (!l.scopeType||l.scopeType==='global');
  const success = new Set(usage.filter(u=>u.responseStatus==='success').map(u=>u.id));
  const refunded = new Set(txs.filter(t=>t.amount>0&&t.apiUsageId).map(t=>t.apiUsageId));
  const unambiguous = unambiguousSpendIds(txs);
  const settled = t => t.type==='spend' && unambiguous.has(t.id) && success.has(t.apiUsageId) && !refunded.has(t.apiUsageId);
  const actualUse = new Map(targets.map(r=>[r.id,0]));
  for(const t of txs) for(const d of ds(t)) {const r=ref(d);if(r&&['spend','refund','expire'].includes(t.type))actualUse.set(r.id,actualUse.get(r.id)+(t.amount<0?d.amount:-d.amount));}
  let untracked = Math.max(0, account.balance-sum(lots.filter(l=>l.status==='active').map(l=>l.remainingAmount)));
  const states = targets.map(r=>{
    const l=byLot.get(r.creditLotId);
    if(l) assert.equal(l.sourceType,'gift','Unexpected referral lot source');
    const remaining=l?l.remainingAmount:Math.min(untracked,Math.max(0,r.amount-actualUse.get(r.id)));
    if(!l)untracked-=remaining;
    const documented=remaining+actualUse.get(r.id);
    assert(documented>=0&&documented<=r.amount,`Referral lot history mismatch: ${r.id}`);
    // Start with the original grant. A small migrated allocation is not proof
    // that the missing part was spent. Replay documented legacy consumption too.
    return {r,l,budget:r.amount,remaining:0,originalRemaining:remaining,consumed:0,decayed:0,unknownPreviouslyConsumed:0};
  });
  const stateById=new Map(states.map(s=>[s.r.id,s]));
  const bank=new Map(), changes=[], decayRefunds=[];
  const referralPart=(s,amount)=>({kind:'lot',lotId:s.l?.id||`${MARK}:${s.r.id}`,amount});
  function takeRewards(amount,t,preferred) {
    const parts=[]; const ordered=preferred?[preferred,...states.filter(s=>s!==preferred)]:states;
    for(const s of ordered){
      if(time(s.r.createdAt)>time(t.createdAt)||s.remaining<=0)continue;
      const n=Math.min(amount,s.remaining);s.remaining-=n;amount-=n;parts.push(referralPart(s,n));
      if(t.type==='expire')s.decayed+=n;else s.consumed+=n;
      if(!amount)break;
    }return {parts,left:amount};
  }
  for(const t of txs){
    const grant=stateById.get(t.id);if(grant)grant.remaining+=grant.budget;
    const original=ds(t); if(!original.length)continue;
    if(!original.some(d=>ref(d))&&!settled(t))continue;
    if(!['spend','refund','expire'].includes(t.type))continue;
    assert.equal(sum(original.map(d=>d.amount)),Math.abs(t.amount),'Deduction total mismatch');
    const next=[];let changed=false;
    for(const d of original){
      const r=ref(d), s=r&&stateById.get(r.id);
      if(s&&t.type==='refund'){
        s.remaining+=d.amount;s.consumed-=d.amount;assert(s.remaining<=s.budget,'Refund exceeds referral grant');next.push(d);continue;
      }
      if(s&&t.amount<0){
        const allocation=takeRewards(d.amount,t,s);next.push(...allocation.parts);
        if(allocation.left&&t.type==='expire'){
          decayRefunds.push({transactionId:t.id,rewardId:r.id,amount:allocation.left});
        }else if(allocation.left){
          assert(settled(t),'Unsettled referral consumption would require reassignment');
          for(const [id,available] of bank){
            const l=byLot.get(id);if(!paid(l)||time(l.grantedAt)>time(t.createdAt))continue;
            const n=Math.min(available,allocation.left);if(!n)continue;
            bank.set(id,available-n);allocation.left-=n;next.push({kind:'lot',lotId:id,amount:n});if(!allocation.left)break;
          }
          assert.equal(allocation.left,0,'Later referral consumption lacks restored paid backing');
        }
        if(!sameParts(allocation.parts,[d])||allocation.left)changed=true;
      }else if(settled(t)&&((d.kind==='lot'&&paid(byLot.get(d.lotId)))||d.kind==='legacy_balance')){
        const allocation=takeRewards(d.amount,t);const moved=d.amount-allocation.left;
        next.push(...allocation.parts);
        if(moved){if(d.kind==='lot')bank.set(d.lotId,(bank.get(d.lotId)||0)+moved);changed=true;}
        // Earlier wrong priority left a legacy balance behind. Later spending
        // of that balance must consume the restored recharge rather than create
        // extra paid lots while refunding the earlier charge attribution.
        if(d.kind==='legacy_balance'&&allocation.left){
          for(const [id,available] of bank){
            const l=byLot.get(id);if(!paid(l)||time(l.grantedAt)>time(t.createdAt))continue;
            const n=Math.min(available,allocation.left);if(!n)continue;
            bank.set(id,available-n);allocation.left-=n;next.push({kind:'lot',lotId:id,amount:n});changed=true;
            if(!allocation.left)break;
          }
        }
        if(allocation.left)next.push({...d,amount:allocation.left});
      }else next.push(d);
    }
    if(changed)changes.push({id:t.id,type:t.type,originalDeductions:original,deductions:next});
  }
  const refund=sum(decayRefunds.map(d=>d.amount));
  const restoredLots=Object.fromEntries([...bank].filter(([,n])=>n>0));
  for(const [id,n] of Object.entries(restoredLots))assert(byLot.get(id).remainingAmount+n<=byLot.get(id).totalAmount,'Recharge restoration exceeds original grant');
  for(const s of states)assert(s.remaining>=0&&s.remaining<=s.budget,'Invalid referral remainder');
  const currentActive=sum(lots.filter(l=>l.status==='active').map(l=>l.remainingAmount));
  const originalTargetActive=sum(states.filter(s=>s.l?.status==='active').map(s=>s.l.remainingAmount));
  const afterActive=currentActive-originalTargetActive+sum(states.map(s=>s.remaining))+sum(Object.values(restoredLots));
  assert(afterActive<=account.balance+refund,'Corrected lots exceed account balance');
  const delta=sum(states.map(s=>s.remaining-s.originalRemaining))+sum(Object.values(restoredLots));
  assert.equal(delta,refund,'Source changes do not conserve balance');
  return {accountId:account.id,before:account.balance,after:account.balance+refund,refund,restoredLots,changes,decayRefunds,
    rewards:states.map(s=>({id:s.r.id,lotId:s.l?.id||`${MARK}:${s.r.id}`,create:!s.l,amount:s.r.amount,remainingBefore:s.originalRemaining,remainingAfter:s.remaining,consumed:s.consumed,lawfulDecay:s.decayed,unknownPreviouslyConsumed:s.unknownPreviouslyConsumed})),fixedRewards:fixed.length,
    missingSourceSpends:txs.filter(t=>t.type==='spend'&&!ds(t).length).length};
}
module.exports={MARK,planAudit};
