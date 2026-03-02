import { Module } from '@nestjs/common'
import { ConnectorsController } from './connectors.controller'
import { ConnectorsService } from './connectors.service'
import { BedrockService } from './services/bedrock.service'
import { GrafanaService } from './services/grafana.service'
import { GraylogService } from './services/graylog.service'
import { InfluxDBService } from './services/influxdb.service'
import { MispService } from './services/misp.service'
import { OpenSearchService } from './services/opensearch.service'
import { ShuffleService } from './services/shuffle.service'
import { VelociraptorService } from './services/velociraptor.service'
import { WazuhService } from './services/wazuh.service'

@Module({
  controllers: [ConnectorsController],
  providers: [
    ConnectorsService,
    WazuhService,
    OpenSearchService,
    GraylogService,
    VelociraptorService,
    GrafanaService,
    InfluxDBService,
    MispService,
    ShuffleService,
    BedrockService,
  ],
  exports: [
    ConnectorsService,
    WazuhService,
    GraylogService,
    VelociraptorService,
    GrafanaService,
    InfluxDBService,
    MispService,
    ShuffleService,
    BedrockService,
  ],
})
export class ConnectorsModule {}
