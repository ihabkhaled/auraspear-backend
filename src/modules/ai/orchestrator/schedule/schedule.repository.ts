import { Injectable } from '@nestjs/common'
import { CronExpressionParser } from 'cron-parser'
import { PrismaService } from '../../../../prisma/prisma.service'
import type {
  FindAllForTenantOptions,
  FindDueSchedulesOptions,
  ScheduleRecord,
} from './schedule.types'
import type { Prisma } from '@prisma/client'

@Injectable()
export class ScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds all schedules that are due for execution.
   * A schedule is due when: isEnabled = true, isPaused = false, nextRunAt <= NOW()
   */
  async findDueSchedules(options?: FindDueSchedulesOptions): Promise<ScheduleRecord[]> {
    const limit = options?.limit ?? 50

    return this.prisma.aiAgentSchedule.findMany({
      where: {
        isEnabled: true,
        isPaused: false,
        nextRunAt: { lte: new Date() },
      },
      orderBy: [{ nextRunAt: 'asc' }],
      take: limit,
    })
  }

  /**
   * Lists schedules belonging to a tenant.
   */
  async findAllForTenant(
    tenantId: string,
    options?: FindAllForTenantOptions
  ): Promise<ScheduleRecord[]> {
    const where: Prisma.AiAgentScheduleWhereInput = {
      tenantId,
    }

    if (options?.module) {
      where.module = options.module
    }

    if (options?.isEnabled !== undefined) {
      where.isEnabled = options.isEnabled
    }

    return this.prisma.aiAgentSchedule.findMany({
      where,
      orderBy: [{ module: 'asc' }, { agentId: 'asc' }],
    })
  }

  /**
   * Gets a single schedule by ID.
   */
  async findById(id: string): Promise<ScheduleRecord | null> {
    return this.prisma.aiAgentSchedule.findUnique({ where: { id } })
  }

  /**
   * Updates schedule fields.
   */
  async updateSchedule(
    id: string,
    data: Prisma.AiAgentScheduleUpdateInput
  ): Promise<ScheduleRecord> {
    return this.prisma.aiAgentSchedule.update({ where: { id }, data })
  }

  /**
   * Marks a schedule as having started a run:
   * - Sets lastRunAt = now
   * - Computes and sets nextRunAt from cron expression
   */
  async markRunStarted(id: string, nextRunAt: Date): Promise<ScheduleRecord> {
    return this.prisma.aiAgentSchedule.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        nextRunAt,
        lastStatus: 'running',
      },
    })
  }

  /**
   * Marks a schedule run as completed and updates streaks.
   */
  async markRunCompleted(
    id: string,
    status: string,
    durationMs: number
  ): Promise<ScheduleRecord | null> {
    const schedule = await this.findById(id)
    if (!schedule) {
      return null
    }

    const isSuccess = status === 'completed'

    return this.prisma.aiAgentSchedule.update({
      where: { id },
      data: {
        lastStatus: status,
        lastDurationMs: durationMs,
        failureStreak: isSuccess ? 0 : schedule.failureStreak + 1,
        successStreak: isSuccess ? schedule.successStreak + 1 : 0,
      },
    })
  }

  /**
   * Finds the seed defaults for a schedule by its seedKey.
   * Since seedKey is unique, this can be used to look up the original values.
   */
  async findBySeedKey(seedKey: string): Promise<ScheduleRecord | null> {
    return this.prisma.aiAgentSchedule.findUnique({ where: { seedKey } })
  }

  /**
   * Resets a schedule to its system default values.
   * Only resets configurable fields — preserves ID, seedKey, tenantId, etc.
   */
  async resetToDefault(
    id: string,
    defaults: Prisma.AiAgentScheduleUpdateInput
  ): Promise<ScheduleRecord> {
    return this.prisma.aiAgentSchedule.update({
      where: { id },
      data: defaults,
    })
  }

  /**
   * Computes the next run time from a cron expression and timezone.
   */
  async bulkToggle(tenantId: string, enabled: boolean): Promise<{ count: number }> {
    return this.prisma.aiAgentSchedule.updateMany({
      where: { tenantId },
      data: { isEnabled: enabled },
    })
  }

  computeNextRun(cronExpression: string, timezone: string): Date {
    const expression = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
      tz: timezone,
    })
    return expression.next().toDate()
  }
}
