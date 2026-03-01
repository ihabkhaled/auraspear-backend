import { Module } from '@nestjs/common'
import { IntelController } from './intel.controller'
import { IntelService } from './intel.service'

@Module({
  controllers: [IntelController],
  providers: [IntelService],
  exports: [IntelService],
})
export class IntelModule {}
