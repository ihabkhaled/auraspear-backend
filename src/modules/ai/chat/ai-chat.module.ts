import { Module } from '@nestjs/common'
import { AiChatController } from './ai-chat.controller'
import { AiChatService } from './ai-chat.service'
import { PrismaModule } from '../../../prisma/prisma.module'
import { ConnectorsModule } from '../../connectors/connectors.module'
import { LlmConnectorsModule } from '../../connectors/llm-connectors/llm-connectors.module'

@Module({
  imports: [PrismaModule, ConnectorsModule, LlmConnectorsModule],
  controllers: [AiChatController],
  providers: [AiChatService],
  exports: [AiChatService],
})
export class AiChatModule {}
