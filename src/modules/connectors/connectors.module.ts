import { Module } from '@nestjs/common'
import { ConnectorsController } from './connectors.controller'
import { ConnectorsService } from './connectors.service'
import { BedrockService } from './services/bedrock.service'
import { MispService } from './services/misp.service'
import { OpenSearchService } from './services/opensearch.service'
import { ShuffleService } from './services/shuffle.service'
import { WazuhService } from './services/wazuh.service'

@Module({
  controllers: [ConnectorsController],
  providers: [
    ConnectorsService,
    WazuhService,
    OpenSearchService,
    MispService,
    ShuffleService,
    BedrockService,
  ],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
