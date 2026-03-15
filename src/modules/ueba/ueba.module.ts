import { Module } from '@nestjs/common'
import { UebaController } from './ueba.controller'
import { UebaRepository } from './ueba.repository'
import { UebaService } from './ueba.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Module({
  imports: [AppLogsModule],
  controllers: [UebaController],
  providers: [UebaRepository, UebaService],
  exports: [UebaService],
})
export class UebaModule {}
