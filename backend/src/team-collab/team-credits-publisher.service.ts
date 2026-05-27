import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CollabEventBus,
  channelForTeam,
} from './collab-event-bus.service';
import {
  CollabEnvelope,
  TeamCreditsChangedPayload,
  TeamCreditsChangeReason,
} from './types';

interface PublishOptions {
  teamId: string;
  reason: TeamCreditsChangeReason;
  delta: number;
  actorUserId?: string | null;
  taskId?: string | null;
}

/**
 * Reads the current TeamCreditAccount row and broadcasts a
 * `team_credits_changed` envelope so every connected member sees the new
 * balance in real time.
 *
 * Designed to be called AFTER the balance mutation transaction commits.
 * Failures are logged and swallowed — credits sync is best-effort and must
 * never break the underlying ledger flow.
 */
@Injectable()
export class TeamCreditsPublisher {
  private readonly logger = new Logger(TeamCreditsPublisher.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly bus?: CollabEventBus,
  ) {}

  async publish(opts: PublishOptions): Promise<void> {
    if (!this.bus) return;
    try {
      const acc = await this.prisma.teamCreditAccount.findUnique({
        where: { teamId: opts.teamId },
        select: { balance: true, frozenBalance: true },
      });
      if (!acc) return;
      const payload: TeamCreditsChangedPayload = {
        teamId: opts.teamId,
        delta: opts.delta,
        balance: acc.balance,
        frozenBalance: acc.frozenBalance,
        availableCredits: acc.balance - acc.frozenBalance,
        reason: opts.reason,
        actorUserId: opts.actorUserId ?? null,
        taskId: opts.taskId ?? null,
      };
      const envelope: CollabEnvelope<TeamCreditsChangedPayload> = {
        type: 'team_credits_changed',
        payload,
        ts: Date.now(),
        senderUserId: opts.actorUserId ?? undefined,
      };
      await this.bus.publishTo(channelForTeam(opts.teamId), envelope);
    } catch (err) {
      this.logger.warn(
        `publish team_credits_changed failed (team=${opts.teamId}, reason=${opts.reason}): ${(err as Error).message}`,
      );
    }
  }
}
