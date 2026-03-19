import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import type { Job } from '@prisma/client'

@Injectable()
export class DetectionExecutionHandler {
  private readonly logger = new Logger(DetectionExecutionHandler.name)

  constructor(private readonly prisma: PrismaService) {}

  async handle(job: Job): Promise<Record<string, unknown>> {
    const payload = job.payload as Record<string, unknown> | null
    const ruleId = payload?.['ruleId'] as string | undefined

    if (!ruleId) {
      throw new Error('ruleId is required in job payload')
    }

    const rule = await this.prisma.detectionRule.findFirst({
      where: { id: ruleId, tenantId: job.tenantId },
    })

    if (!rule) {
      throw new Error(`Detection rule ${ruleId} not found for tenant ${job.tenantId}`)
    }

    this.logger.log(
      `Executing detection rule "${rule.name}" (${rule.ruleType}) for tenant ${job.tenantId}`
    )

    // Detection execution would invoke the detection-rules executor
    // with actual log data from the data pipeline.
    // This is the hook point for real Sigma/YARA-L execution.

    return {
      ruleId,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      executedAt: new Date().toISOString(),
      matchCount: 0,
    }
  }
}
