import { Module } from '@nestjs/common'
import { VulnerabilitiesController } from './vulnerabilities.controller'
import { VulnerabilitiesRepository } from './vulnerabilities.repository'
import { VulnerabilitiesService } from './vulnerabilities.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [VulnerabilitiesController],
  providers: [VulnerabilitiesRepository, VulnerabilitiesService],
  exports: [VulnerabilitiesService],
})
export class VulnerabilitiesModule {}
