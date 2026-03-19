import { mapAlertToOcsfFinding } from '../../../common/ocsf'
import type { OcsfSecurityFinding } from '../../../common/ocsf'

/**
 * Determines severity from Bedrock event type and error status.
 * Bedrock audit events don't have a native severity — derive from context.
 */
function getBedrockSeverity(event: Record<string, unknown>): string {
  const errorCode = event['errorCode'] as string | undefined
  if (errorCode) {
    if (errorCode === 'AccessDeniedException') {
      return 'high'
    }
    return 'medium'
  }

  const eventName = ((event['eventName'] as string) ?? '').toLowerCase()
  if (eventName.includes('delete') || eventName.includes('deregister')) {
    return 'high'
  }
  if (eventName.includes('create') || eventName.includes('update')) {
    return 'medium'
  }
  if (eventName.includes('invoke')) {
    return 'low'
  }

  return 'info'
}

/**
 * Maps an AWS Bedrock AI agent audit event to OCSF SecurityFinding format.
 *
 * Bedrock events come from CloudTrail and include fields like:
 * eventName, eventTime, eventSource, requestParameters, responseElements,
 * userIdentity (arn, accountId, type), sourceIPAddress, userAgent,
 * errorCode, errorMessage, requestID, resources.
 */
export function mapBedrockToOcsf(
  event: Record<string, unknown>,
  tenantId?: string
): OcsfSecurityFinding {
  const eventName = (event['eventName'] as string) ?? ''
  const userIdentity = (event['userIdentity'] as Record<string, unknown>) ?? {}
  const userArn = (userIdentity['arn'] as string) ?? undefined

  const title = eventName ? `Bedrock: ${eventName}` : 'AWS Bedrock Audit Event'

  const errorMessage = event['errorMessage'] as string | undefined
  const errorCode = event['errorCode'] as string | undefined
  const description = errorMessage ? `${errorCode ?? 'Error'}: ${errorMessage}` : undefined

  const resources = (event['resources'] as Array<Record<string, unknown>>) ?? []
  const firstResourceArn =
    resources.length > 0 ? ((resources[0]?.['ARN'] as string) ?? undefined) : undefined

  return mapAlertToOcsfFinding({
    title,
    description,
    severity: getBedrockSeverity(event),
    timestamp: (event['eventTime'] as string) ?? new Date().toISOString(),
    source: { product: 'Amazon Bedrock', vendor: 'Amazon Web Services' },
    tenantId,
    eventId: (event['requestID'] as string) ?? (event['eventID'] as string) ?? undefined,
    rawData: JSON.stringify(event),
    affectedAsset: userArn ?? firstResourceArn ?? undefined,
  })
}
