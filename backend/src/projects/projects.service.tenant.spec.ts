import { ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

/**
 * H5: TeamProjectShare 写入点的跨租户外键断言。
 * 同租户引用照常通过；异租户/team 不存在即 ForbiddenException。
 */
describe('ProjectsService 跨租户外键断言 (assertSameTenant)', () => {
  const CURRENT = 'default';

  function build(opts: {
    teamTenantId?: string | null; // null => team 不存在
    membershipRole?: string | null; // null => 无 membership
  }) {
    const team =
      opts.teamTenantId === null ? null : { tenantId: opts.teamTenantId };
    const membership =
      opts.membershipRole === null
        ? null
        : { role: opts.membershipRole, teamId: 'team_1', userId: 'u1' };

    const prisma = {
      project: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'p1', userId: 'u1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1' }),
      },
      teamMembership: {
        findUnique: jest.fn().mockResolvedValue(membership),
      },
      team: {
        findUnique: jest.fn().mockResolvedValue(team),
      },
      teamProjectShare: {
        upsert: jest.fn().mockResolvedValue({ id: 'share1' }),
      },
    };
    const tenantContext = { getTenantId: jest.fn().mockReturnValue(CURRENT) };
    const service = new ProjectsService(
      prisma as any,
      {} as any,
      tenantContext as any,
    );
    return { service, prisma };
  }

  describe('shareWithTeam', () => {
    it('同租户通过', async () => {
      const { service, prisma } = build({
        teamTenantId: CURRENT,
        membershipRole: 'owner',
      });
      await expect(
        service.shareWithTeam('p1', 'team_1', 'u1'),
      ).resolves.toBeDefined();
      expect(prisma.teamProjectShare.upsert).toHaveBeenCalledTimes(1);
    });

    it('异租户的 team 被拒绝', async () => {
      const { service, prisma } = build({
        teamTenantId: 't_other',
        membershipRole: 'owner',
      });
      await expect(
        service.shareWithTeam('p1', 'team_1', 'u1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.teamProjectShare.upsert).not.toHaveBeenCalled();
    });

    it('team 不存在被拒绝', async () => {
      const { service, prisma } = build({
        teamTenantId: null,
        membershipRole: 'admin',
      });
      await expect(
        service.shareWithTeam('p1', 'team_1', 'u1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.teamProjectShare.upsert).not.toHaveBeenCalled();
    });
  });

  describe('cloneToTeam', () => {
    function buildClone(teamTenantId: string | null) {
      const team = teamTenantId === null ? null : { tenantId: teamTenantId };
      const prisma = {
        project: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'p1', userId: 'u1', name: 'X' }),
        },
        teamMembership: {
          findUnique: jest.fn().mockResolvedValue({ role: 'owner' }),
        },
        team: { findUnique: jest.fn().mockResolvedValue(team) },
        teamProjectShare: { upsert: jest.fn() },
      };
      const tenantContext = {
        getTenantId: jest.fn().mockReturnValue(CURRENT),
      };
      const service = new ProjectsService(
        prisma as any,
        {} as any,
        tenantContext as any,
      );
      return { service, prisma };
    }

    it('异租户的 team 在落 share 前即被拒绝', async () => {
      const { service, prisma } = buildClone('t_other');
      await expect(
        service.cloneToTeam('p1', 'team_1', 'u1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.teamProjectShare.upsert).not.toHaveBeenCalled();
    });
  });
});
