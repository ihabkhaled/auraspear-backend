import { Module } from '@nestjs/common'
import { CaseCyclesController } from './case-cycles.controller'
import { CaseCyclesService } from './case-cycles.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [CaseCyclesController],
  providers: [CaseCyclesService],
  exports: [CaseCyclesService],
})
export class CaseCyclesModule {}
