import { Module } from '@nestjs/common'
import { IntelController } from './intel.controller'
import { IntelService } from './intel.service'
import { ConnectorsModule } from '../connectors/connectors.module'

@Module({
  imports: [ConnectorsModule],
  controllers: [IntelController],
  providers: [IntelService],
  exports: [IntelService],
})
export class IntelModule {}
