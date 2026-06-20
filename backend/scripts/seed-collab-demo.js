/**
 * One-off seed for local collaboration (cursor sync) testing.
 * Creates two users in a shared team with one shared project.
 * Idempotent on phone numbers — re-running updates the password.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const PASSWORD = 'Test1234!';
const A = { phone: '13900000001', name: 'Collab A' };
const B = { phone: '13900000002', name: 'Collab B' };

async function upsertUser(u, hash) {
  const existing = await prisma.user.findFirst({ where: { phone: u.phone } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: hash, name: u.name, status: 'active' },
    });
  }
  return prisma.user.create({
    data: { phone: u.phone, passwordHash: hash, name: u.name, status: 'active', role: 'user' },
  });
}

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const userA = await upsertUser(A, hash);
  const userB = await upsertUser(B, hash);

  // Team owned by A (non-personal → team mode in UI).
  let team = await prisma.team.findFirst({ where: { ownerId: userA.id, name: 'Collab Demo Team', isPersonal: false } });
  if (!team) {
    team = await prisma.team.create({
      data: { name: 'Collab Demo Team', ownerId: userA.id, isPersonal: false, maxSeats: 10, status: 'active' },
    });
  }

  await prisma.teamMembership.upsert({
    where: { teamId_userId: { teamId: team.id, userId: userA.id } },
    update: { role: 'owner' },
    create: { teamId: team.id, userId: userA.id, role: 'owner' },
  });
  await prisma.teamMembership.upsert({
    where: { teamId_userId: { teamId: team.id, userId: userB.id } },
    update: { role: 'member' },
    create: { teamId: team.id, userId: userB.id, role: 'member' },
  });

  // Shared project owned by A.
  let project = await prisma.project.findFirst({ where: { userId: userA.id, name: 'Collab Demo Project' } });
  if (!project) {
    project = await prisma.project.create({
      data: {
        userId: userA.id,
        name: 'Collab Demo Project',
        ossPrefix: `projects/collab-demo/`,
        mainKey: `projects/collab-demo/main.json`,
        contentVersion: 1,
        contentJson: null,
      },
    });
  }

  await prisma.teamProjectShare.upsert({
    where: { projectId_teamId: { projectId: project.id, teamId: team.id } },
    update: { access: 'edit' },
    create: { projectId: project.id, teamId: team.id, access: 'edit', sharedByUserId: userA.id },
  });

  const out = {
    password: PASSWORD,
    userA: { id: userA.id, phone: userA.phone },
    userB: { id: userB.id, phone: userB.phone },
    teamId: team.id,
    teamName: team.name,
    projectId: project.id,
  };
  console.log('SEED_RESULT=' + JSON.stringify(out));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
