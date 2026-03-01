export interface ServiceHealthResult {
  service: string
  status: 'healthy' | 'degraded' | 'down' | 'maintenance'
  latencyMs: number
  version: string
  uptime: number
  lastCheck: string
  details?: Record<string, unknown>
}

export interface OverallHealth {
  status: 'healthy' | 'degraded' | 'down'
  timestamp: string
  version: string
  services: {
    total: number
    healthy: number
    degraded: number
    down: number
  }
}
