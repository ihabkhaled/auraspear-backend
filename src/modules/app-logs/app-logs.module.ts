import { Module } from '@nestjs/common'
import { AppLogsController } from './app-logs.controller'
import { AppLogsService } from './app-logs.service'
import { AppLoggerService } from '../../common/services/app-logger.service'

@Module({
  controllers: [AppLogsController],
  providers: [AppLogsService, AppLoggerService],
  exports: [AppLogsService, AppLoggerService],
})
export class AppLogsModule {}
