import { Module } from '@nestjs/common'
import { AiController } from './ai.controller'
import { AiRepository } from './ai.repository'
import { AiService } from './ai.service'
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

@Module({
  imports: [
    AgentConfigModule,
    AppLogsModule,
    ConnectorsModule,
    LlmConnectorsModule,
    OsintExecutorModule,
    OrchestratorModule,
    PromptRegistryModule,
    FeatureCatalogModule,
    UsageBudgetModule,
    AiWritebackModule,
  ],
  controllers: [AiController],
  providers: [AiRepository, AiService],
  exports: [
    AiService,
    OrchestratorModule,
    PromptRegistryModule,
    FeatureCatalogModule,
    UsageBudgetModule,
    AiWritebackModule,
  ],
})
export class AiModule {}
