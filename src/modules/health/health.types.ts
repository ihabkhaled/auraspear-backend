export interface ServiceHealthResult {
  name: string
  type: string
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
}

export interface OverallHealth {
  status: 'healthy' | 'degraded' | 'down'
  timestamp: string
  version: string
  checks: {
    database: ComponentCheck
    redis: ComponentCheck
  }
}

export interface ComponentCheck {
  status: 'healthy' | 'down'
  latencyMs: number
}
