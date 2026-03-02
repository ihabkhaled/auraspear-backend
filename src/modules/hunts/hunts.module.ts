import { Module } from '@nestjs/common'
import { HuntsController } from './hunts.controller'
import { HuntsService } from './hunts.service'
import { ConnectorsModule } from '../connectors/connectors.module'

@Module({
  imports: [ConnectorsModule],
  controllers: [HuntsController],
  providers: [HuntsService],
  exports: [HuntsService],
})
export class HuntsModule {}
