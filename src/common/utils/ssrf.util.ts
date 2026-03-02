import { BusinessException } from '../exceptions/business.exception'

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
  /^::1$/,
  /^localhost$/i,
]

export function validateUrl(urlString: string, allowedHosts?: string[]): URL {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    throw new BusinessException(400, 'Invalid URL format', 'errors.ssrf.invalidUrl')
  }

  // Only allow HTTPS in production
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BusinessException(
      400,
      'Only HTTP(S) URLs are allowed',
      'errors.ssrf.unsupportedProtocol'
    )
  }

  // Block private/internal IPs
  const { hostname } = parsed
  for (const pattern of PRIVATE_RANGES) {
    if (pattern.test(hostname)) {
      throw new BusinessException(
        400,
        'URLs pointing to private/internal networks are not allowed',
        'errors.ssrf.privateNetwork'
      )
    }
  }

  // If allowlist provided, enforce it
  if (allowedHosts && allowedHosts.length > 0) {
    const isAllowed = allowedHosts.some(
      allowed => hostname === allowed || hostname.endsWith(`.${allowed}`)
    )
    if (!isAllowed) {
      throw new BusinessException(
        400,
        `Host '${hostname}' is not in the allowed list`,
        'errors.ssrf.hostNotAllowed'
      )
    }
  }

  return parsed
}

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_RANGES.some(pattern => pattern.test(hostname))
}
