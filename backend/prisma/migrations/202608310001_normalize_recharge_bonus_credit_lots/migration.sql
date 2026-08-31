-- 充值本金与充值赠送都属于 recharge；gift 只保留免费、可衰减积分。
UPDATE "CreditLot"
SET
  "sourceType" = 'recharge',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "sourceType" = 'gift'
  AND "metadata"->>'grantType' = 'recharge_bonus';
