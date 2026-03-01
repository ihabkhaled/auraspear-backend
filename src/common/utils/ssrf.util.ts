import { BadRequestException } from '@nestjs/common'

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
    throw new BadRequestException('Invalid URL format')
  }

  // Only allow HTTPS in production
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException('Only HTTP(S) URLs are allowed')
  }

  // Block private/internal IPs
  const { hostname } = parsed
  for (const pattern of PRIVATE_RANGES) {
    if (pattern.test(hostname)) {
      throw new BadRequestException('URLs pointing to private/internal networks are not allowed')
    }
  }

  // If allowlist provided, enforce it
  if (allowedHosts && allowedHosts.length > 0) {
    const isAllowed = allowedHosts.some(
      allowed => hostname === allowed || hostname.endsWith(`.${allowed}`)
    )
    if (!isAllowed) {
      throw new BadRequestException(`Host '${hostname}' is not in the allowed list`)
    }
  }

  return parsed
}

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_RANGES.some(pattern => pattern.test(hostname))
}
