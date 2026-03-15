import { Module } from '@nestjs/common'
import { NormalizationController } from './normalization.controller'
import { NormalizationRepository } from './normalization.repository'
import { NormalizationService } from './normalization.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [NormalizationController],
  providers: [NormalizationRepository, NormalizationService],
  exports: [NormalizationService],
})
export class NormalizationModule {}
