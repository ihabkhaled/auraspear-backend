import { Module } from '@nestjs/common'
import { SoarController } from './soar.controller'
import { SoarRepository } from './soar.repository'
import { SoarService } from './soar.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [SoarController],
  providers: [SoarRepository, SoarService],
  exports: [SoarRepository, SoarService],
})
export class SoarModule {}
