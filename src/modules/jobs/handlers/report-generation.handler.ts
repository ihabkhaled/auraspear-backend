import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import type { Job } from '@prisma/client'

@Injectable()
export class ReportGenerationHandler {
  private readonly logger = new Logger(ReportGenerationHandler.name)

  constructor(private readonly prisma: PrismaService) {}

  async handle(job: Job): Promise<Record<string, unknown>> {
    const payload = job.payload as Record<string, unknown> | null
    const reportId = payload?.['reportId'] as string | undefined

    if (!reportId) {
      throw new Error('reportId is required in job payload')
    }

    const report = await this.prisma.report.findFirst({
      where: { id: reportId, tenantId: job.tenantId },
    })

    if (!report) {
      throw new Error(`Report ${reportId} not found for tenant ${job.tenantId}`)
    }

    this.logger.log(
      `Generating report "${report.name}" (${report.type}/${report.format}) for tenant ${job.tenantId}`
    )

    // Mark report as completed
    await this.prisma.report.update({
      where: { id: reportId },
      data: { status: 'completed', generatedAt: new Date() },
    })

    return {
      reportId,
      reportName: report.name,
      reportType: report.type,
      format: report.format,
      generatedAt: new Date().toISOString(),
    }
  }
}
