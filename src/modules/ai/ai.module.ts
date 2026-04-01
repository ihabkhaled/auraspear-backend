import { Module } from '@nestjs/common'
import { AiController } from './ai.controller'
import { AiOpsWorkspaceController } from './ai-ops-workspace.controller'
import { AiOpsWorkspaceService } from './ai-ops-workspace.service'
import { AiRepository } from './ai.repository'
import { AiService } from './ai.service'
import { AiChatModule } from './chat/ai-chat.module'
import { FeatureCatalogModule } from './feature-catalog/feature-catalog.module'
import { OrchestratorModule } from './orchestrator/orchestrator.module'
import { PromptRegistryModule } from './prompt-registry/prompt-registry.module'
import { UsageBudgetModule } from './usage-budget/usage-budget.module'
import { AiWritebackModule } from './writeback/ai-writeback.module'
import { AgentConfigModule } from '../agent-config/agent-config.module'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { ConnectorsModule } from '../connectors/connectors.module'
import { LlmConnectorsModule } from '../connectors/llm-connectors/llm-connectors.module'
import { OsintExecutorModule } from '../osint-executor/osint-executor.module'
import { PrismaModule } from '../../prisma/prisma.module'

@Module({
  imports: [
    PrismaModule,
    AgentConfigModule,
    AppLogsModule,
    ConnectorsModule,
    LlmConnectorsModule,
    OsintExecutorModule,
    OrchestratorModule,
    PromptRegistryModule,
    FeatureCatalogModule,
    UsageBudgetModule,
    AiChatModule,
    AiWritebackModule,
  ],
  controllers: [AiController, AiOpsWorkspaceController],
  providers: [AiRepository, AiService, AiOpsWorkspaceService],
  exports: [
    AiService,
    AiOpsWorkspaceService,
    OrchestratorModule,
    PromptRegistryModule,
    FeatureCatalogModule,
    UsageBudgetModule,
    AiWritebackModule,
  ],
})
export class AiModule {}
