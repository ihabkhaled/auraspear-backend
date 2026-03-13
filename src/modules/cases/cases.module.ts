import { Module } from '@nestjs/common'
import { CasesController } from './cases.controller'
import { CasesService } from './cases.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [CasesController],
  providers: [CasesService],
  exports: [CasesService],
})
export class CasesModule {}
