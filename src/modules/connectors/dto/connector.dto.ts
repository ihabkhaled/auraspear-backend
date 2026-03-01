import { z } from 'zod'

export const CreateConnectorSchema = z.object({
  type: z.enum([
    'wazuh',
    'graylog',
    'velociraptor',
    'grafana',
    'influxdb',
    'misp',
    'shuffle',
    'bedrock',
  ]),
  name: z.string().min(1).max(255),
  enabled: z.boolean().default(false),
  authType: z.enum(['basic', 'api_key', 'token', 'iam']).default('basic'),
  config: z.record(z.unknown()),
})

export type CreateConnectorDto = z.infer<typeof CreateConnectorSchema>

export const UpdateConnectorSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  enabled: z.boolean().optional(),
  authType: z.enum(['basic', 'api_key', 'token', 'iam']).optional(),
  config: z.record(z.unknown()).optional(),
})

export type UpdateConnectorDto = z.infer<typeof UpdateConnectorSchema>

export const TestConnectorSchema = z.object({
  type: z.enum([
    'wazuh',
    'graylog',
    'velociraptor',
    'grafana',
    'influxdb',
    'misp',
    'shuffle',
    'bedrock',
  ]),
})

export type TestConnectorDto = z.infer<typeof TestConnectorSchema>
