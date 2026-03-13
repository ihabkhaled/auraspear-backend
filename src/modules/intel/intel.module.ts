import { Module } from '@nestjs/common'
import { IntelController } from './intel.controller'
import { IntelService } from './intel.service'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { ConnectorsModule } from '../connectors/connectors.module'

@Module({
  imports: [ConnectorsModule, AppLogsModule],
  controllers: [IntelController],
  providers: [IntelService],
  exports: [IntelService],
})
export class IntelModule {}
