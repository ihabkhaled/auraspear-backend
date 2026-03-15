import { Module } from '@nestjs/common'
import { DetectionRulesController } from './detection-rules.controller'
import { DetectionRulesRepository } from './detection-rules.repository'
import { DetectionRulesService } from './detection-rules.service'
import { RulesEngineController } from './rules-engine.controller'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [DetectionRulesController, RulesEngineController],
  providers: [DetectionRulesRepository, DetectionRulesService],
  exports: [DetectionRulesService],
})
export class DetectionRulesModule {}
