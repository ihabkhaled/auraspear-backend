import { Module } from '@nestjs/common'
import { IntelController } from './intel.controller'
import { IntelRepository } from './intel.repository'
import { IntelService } from './intel.service'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { ConnectorsModule } from '../connectors/connectors.module'

@Module({
  imports: [ConnectorsModule, AppLogsModule],
  controllers: [IntelController],
  providers: [IntelRepository, IntelService],
  exports: [IntelService],
})
export class IntelModule {}
