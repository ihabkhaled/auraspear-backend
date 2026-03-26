import { Module } from '@nestjs/common'
import { AiScheduleTemplatesController } from './ai-schedule-templates.controller'
import { AiWritebackController } from './ai-writeback.controller'
import { AiWritebackRepository } from './ai-writeback.repository'
import { AiWritebackService } from './ai-writeback.service'
import { PrismaModule } from '../../../prisma/prisma.module'
import { AppLogsModule } from '../../app-logs/app-logs.module'

@Module({
  imports: [PrismaModule, AppLogsModule],
  controllers: [AiWritebackController, AiScheduleTemplatesController],
  providers: [AiWritebackService, AiWritebackRepository],
  exports: [AiWritebackService, AiWritebackRepository],
})
export class AiWritebackModule {}
