import { DetectionRulesExecutor } from '../../src/modules/detection-rules/detection-rules.executor'

describe('DetectionRulesExecutor', () => {
  let executor: DetectionRulesExecutor

  beforeEach(() => {
    executor = new DetectionRulesExecutor()
  })

  it('matches events against field conditions', async () => {
    const rule = {
      id: 'rule-1',
      name: 'SSH Brute Force',
      severity: 'high',
      conditions: { fields: { event_type: 'authentication_failure', protocol: 'ssh' } },
    }
    const events = [
      { event_type: 'authentication_failure', protocol: 'ssh', source_ip: '10.0.0.1' },
      { event_type: 'authentication_success', protocol: 'ssh', source_ip: '10.0.0.2' },
      { event_type: 'authentication_failure', protocol: 'rdp', source_ip: '10.0.0.3' },
    ]

    const result = await executor.evaluateRule(rule, events)
    expect(result.status).toBe('matched')
    expect(result.matchCount).toBe(1)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.ruleId).toBe('rule-1')
  })

  it('returns no_match when no events match', async () => {
    const rule = {
      id: 'rule-2',
      name: 'Test Rule',
      severity: 'low',
      conditions: { fields: { event_type: 'nonexistent' } },
    }
    const result = await executor.evaluateRule(rule, [{ event_type: 'auth' }])
    expect(result.status).toBe('no_match')
    expect(result.matchCount).toBe(0)
    expect(result.matches).toHaveLength(0)
  })

  it('performs case-insensitive string matching', async () => {
    const rule = {
      id: 'rule-3',
      name: 'Case Test',
      severity: 'medium',
      conditions: { fields: { action: 'LOGIN' } },
    }
    const events = [{ action: 'login_attempt' }]

    const result = await executor.evaluateRule(rule, events)
    expect(result.status).toBe('matched')
    expect(result.matchCount).toBe(1)
  })

  it('uses conditions directly when no fields key exists', async () => {
    const rule = {
      id: 'rule-4',
      name: 'Direct Conditions',
      severity: 'low',
      conditions: { event_type: 'dns_query', domain: 'evil' },
    }
    const events = [{ event_type: 'dns_query', domain: 'evil.com' }]

    const result = await executor.evaluateRule(rule, events)
    expect(result.status).toBe('matched')
  })

  it('returns error status on evaluation failure', async () => {
    const rule = {
      id: 'rule-5',
      name: 'Error Rule',
      severity: 'high',
      conditions: { fields: { event_type: 'test' } },
    }

    // Pass null to force an error in iteration
    const result = await executor.evaluateRule(rule, null as unknown as Record<string, unknown>[])
    expect(result.status).toBe('error')
    expect(result.error).toBeDefined()
  })

  it('includes timing information in results', async () => {
    const rule = {
      id: 'rule-6',
      name: 'Timing Test',
      severity: 'info',
      conditions: { fields: { event_type: 'test' } },
    }

    const result = await executor.evaluateRule(rule, [{ event_type: 'test' }])
    expect(result.executedAt).toBeDefined()
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})
