import { Global, Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { TokenBlacklistService } from './token-blacklist.service'
import { AppLogsModule } from '../app-logs/app-logs.module'

@Global()
@Module({
  imports: [AppLogsModule],
  controllers: [AuthController],
  providers: [AuthService, TokenBlacklistService],
  exports: [AuthService],
})
export class AuthModule {}
