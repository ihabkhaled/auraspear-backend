import { Module } from '@nestjs/common';
import { HuntsController } from './hunts.controller';
import { HuntsService } from './hunts.service';

@Module({
  controllers: [HuntsController],
  providers: [HuntsService],
  exports: [HuntsService],
})
export class HuntsModule {}
