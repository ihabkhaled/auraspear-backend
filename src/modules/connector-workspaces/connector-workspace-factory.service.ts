import { Injectable } from '@nestjs/common'
import { BedrockWorkspaceStrategy } from './strategies/bedrock-workspace.strategy'
import { GrafanaWorkspaceStrategy } from './strategies/grafana-workspace.strategy'
import { GraylogWorkspaceStrategy } from './strategies/graylog-workspace.strategy'
import { InfluxDBWorkspaceStrategy } from './strategies/influxdb-workspace.strategy'
import { LogstashWorkspaceStrategy } from './strategies/logstash-workspace.strategy'
import { MispWorkspaceStrategy } from './strategies/misp-workspace.strategy'
import { ShuffleWorkspaceStrategy } from './strategies/shuffle-workspace.strategy'
import { VelociraptorWorkspaceStrategy } from './strategies/velociraptor-workspace.strategy'
import { WazuhWorkspaceStrategy } from './strategies/wazuh-workspace.strategy'
import type { ConnectorWorkspaceStrategy } from './types/connector-workspace.types'

@Injectable()
export class ConnectorWorkspaceFactoryService {
  private readonly strategies: Map<string, ConnectorWorkspaceStrategy>

  constructor(
    wazuh: WazuhWorkspaceStrategy,
    graylog: GraylogWorkspaceStrategy,
    logstash: LogstashWorkspaceStrategy,
    velociraptor: VelociraptorWorkspaceStrategy,
    grafana: GrafanaWorkspaceStrategy,
    influxdb: InfluxDBWorkspaceStrategy,
    misp: MispWorkspaceStrategy,
    shuffle: ShuffleWorkspaceStrategy,
    bedrock: BedrockWorkspaceStrategy
  ) {
    this.strategies = new Map<string, ConnectorWorkspaceStrategy>([
      ['wazuh', wazuh],
      ['graylog', graylog],
      ['logstash', logstash],
      ['velociraptor', velociraptor],
      ['grafana', grafana],
      ['influxdb', influxdb],
      ['misp', misp],
      ['shuffle', shuffle],
      ['bedrock', bedrock],
    ])
  }

  getStrategy(connectorType: string): ConnectorWorkspaceStrategy | undefined {
    return this.strategies.get(connectorType)
  }

  hasStrategy(connectorType: string): boolean {
    return this.strategies.has(connectorType)
  }
}
