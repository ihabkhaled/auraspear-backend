import { Injectable, Logger } from '@nestjs/common'
import { ReportsRepository } from '../../reports/reports.repository'
import type { Job } from '@prisma/client'

@Injectable()
export class ReportGenerationHandler {
  private readonly logger = new Logger(ReportGenerationHandler.name)

  constructor(private readonly reportsRepository: ReportsRepository) {}

  async handle(job: Job): Promise<Record<string, unknown>> {
    const payload = job.payload as Record<string, unknown> | null
    const reportId = payload?.['reportId'] as string | undefined

    if (!reportId) {
      throw new Error('reportId is required in job payload')
    }

    const report = await this.reportsRepository.findReportByIdAndTenant(reportId, job.tenantId)

    if (!report) {
      throw new Error(`Report ${reportId} not found for tenant ${job.tenantId}`)
    }

    this.logger.log(
      `Generating report "${report.name}" (${report.type}/${report.format}) for tenant ${job.tenantId}`
    )

    // Mark report as completed
    await this.reportsRepository.updateReportById(reportId, {
      status: 'completed',
      generatedAt: new Date(),
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
