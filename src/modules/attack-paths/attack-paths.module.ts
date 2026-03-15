import { Module } from '@nestjs/common'
import { AttackPathsController } from './attack-paths.controller'
import { AttackPathsRepository } from './attack-paths.repository'
import { AttackPathsService } from './attack-paths.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [AttackPathsController],
  providers: [AttackPathsRepository, AttackPathsService],
  exports: [AttackPathsService],
})
export class AttackPathsModule {}
