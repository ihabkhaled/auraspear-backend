import { Module } from '@nestjs/common'
import { AiController } from './ai.controller'
import { AiRepository } from './ai.repository'
import { AiService } from './ai.service'
import { FeatureCatalogModule } from './feature-catalog/feature-catalog.module'
import { PromptRegistryModule } from './prompt-registry/prompt-registry.module'
import { UsageBudgetModule } from './usage-budget/usage-budget.module'
import { AppLogsModule } from '../app-logs/app-logs.module'
import { ConnectorsModule } from '../connectors/connectors.module'
import { LlmConnectorsModule } from '../connectors/llm-connectors/llm-connectors.module'

@Module({
  imports: [
    AppLogsModule,
    ConnectorsModule,
    LlmConnectorsModule,
    PromptRegistryModule,
    FeatureCatalogModule,
    UsageBudgetModule,
  ],
  controllers: [AiController],
  providers: [AiRepository, AiService],
  exports: [AiService, PromptRegistryModule, FeatureCatalogModule, UsageBudgetModule],
})
export class AiModule {}
