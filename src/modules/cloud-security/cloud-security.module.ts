import { Module } from '@nestjs/common'
import { CloudSecurityController } from './cloud-security.controller'
import { CloudSecurityRepository } from './cloud-security.repository'
import { CloudSecurityService } from './cloud-security.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [CloudSecurityController],
  providers: [CloudSecurityRepository, CloudSecurityService],
  exports: [CloudSecurityService],
})
export class CloudSecurityModule {}
