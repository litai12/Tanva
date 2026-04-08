import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = readFileSync(resolve(process.cwd(), 'backend/prisma/schema.prisma'), 'utf8');

assert.match(schema, /model MembershipPlan \{/);
assert.match(schema, /model UserMembershipSubscription \{/);
assert.match(schema, /model MembershipEntitlementSnapshot \{/);
assert.match(schema, /orderType\s+String\s+@default\("recharge"\)/);
assert.match(schema, /membershipPlanId\s+String\?/);
assert.match(schema, /subscriptionId\s+String\?/);

console.log('membership p0 type schema tests passed');
