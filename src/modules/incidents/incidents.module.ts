import { Module } from '@nestjs/common'
import { IncidentsController } from './incidents.controller'
import { IncidentsRepository } from './incidents.repository'
import { IncidentsService } from './incidents.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [IncidentsController],
  providers: [IncidentsRepository, IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
