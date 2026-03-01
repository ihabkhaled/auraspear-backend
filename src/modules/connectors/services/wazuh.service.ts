import { Injectable, Logger } from '@nestjs/common'
import type { TestResult } from '../connectors.types'

@Injectable()
export class WazuhService {
  private readonly logger = new Logger(WazuhService.name)

  async testConnection(config: Record<string, unknown>): Promise<TestResult> {
    this.logger.debug('Testing Wazuh connection')

    // Mock: simulate API call to Wazuh Manager /security/user/authenticate
    await this.simulateLatency()

    const baseUrl = config.baseUrl as string | undefined
    if (!baseUrl) {
      return { ok: false, details: 'Wazuh base URL not configured' }
    }

    return {
      ok: true,
      details: `Wazuh Manager v4.9.0 reachable at ${baseUrl}. Cluster: active, Agents: 247 connected.`,
    }
  }

  async getAlerts(
    _config: Record<string, unknown>,
    _tenantIndex: string,
    _query: string
  ): Promise<unknown[]> {
    // In production, query Wazuh API /alerts
    return []
  }

  private simulateLatency(): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, 150 + Math.random() * 200)
    })
  }
}
