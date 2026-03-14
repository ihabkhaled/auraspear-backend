import * as http from 'node:http'
import * as https from 'node:https'
import { isPrivateHost } from './ssrf.util'

export interface ConnectorHttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  rejectUnauthorized?: boolean
  /** Allow private/internal network targets. Defaults to false — only set to true for known internal connector services. */
  allowPrivateNetwork?: boolean
  /** PEM-encoded client certificate for mTLS authentication. */
  clientCert?: string
  /** PEM-encoded client private key for mTLS authentication. */
  clientKey?: string
  /** PEM-encoded CA certificate to trust for the connection. */
  caCert?: string
}

export interface ConnectorHttpResponse {
  status: number
  data: unknown
  headers: Record<string, string>
  latencyMs: number
}

/**
 * HTTP client for connector integrations.
 * Supports self-signed certificates (common in internal security tools).
 * Validates URL protocol and optionally blocks private network targets.
 */
export function connectorFetch(
  url: string,
  options: ConnectorHttpOptions = {}
): Promise<ConnectorHttpResponse> {
  const isProduction = process.env.NODE_ENV === 'production'
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 15_000,
    rejectUnauthorized: callerRejectUnauthorized = isProduction,
    allowPrivateNetwork = false,
    clientCert,
    clientKey,
    caCert,
  } = options

  // In non-production, always accept self-signed certificates for local testing
  const rejectUnauthorized = isProduction ? callerRejectUnauthorized : false

  return new Promise((resolve, reject) => {
    const start = Date.now()
    const parsed = new URL(url)

    // Only allow HTTP(S) protocols
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      reject(new Error('Only HTTP(S) URLs are allowed'))
      return
    }

    // Enforce HTTPS in production to prevent credential leakage over plain HTTP
    if (isProduction && parsed.protocol !== 'https:') {
      reject(new Error('Only HTTPS URLs are allowed in production'))
      return
    }

    // Block private network targets when not explicitly allowed (skip in non-production)
    if (isProduction && !allowPrivateNetwork && isPrivateHost(parsed.hostname)) {
      reject(new Error('URLs pointing to private/internal networks are not allowed'))
      return
    }
    const isHttps = parsed.protocol === 'https:'

    // L14: Warn when TLS verification is disabled
    if (isHttps && !rejectUnauthorized) {
      console.warn(`[connector-http] TLS verification disabled for ${parsed.hostname}`)
    }

    const requestOptions: https.RequestOptions = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      timeout: timeoutMs,
      rejectUnauthorized: isHttps ? rejectUnauthorized : undefined,
      ...(clientCert ? { cert: clientCert } : {}),
      ...(clientKey ? { key: clientKey } : {}),
      ...(caCert ? { ca: caCert } : {}),
    }

    const maxResponseBytes = 10 * 1024 * 1024 // 10 MB limit
    const transport = isHttps ? https : http
    const req = transport.request(requestOptions, res => {
      const chunks: Buffer[] = []
      let totalBytes = 0

      res.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > maxResponseBytes) {
          req.destroy()
          reject(new Error('Response body exceeded 10 MB limit'))
          return
        }
        chunks.push(chunk)
      })

      res.on('end', () => {
        const latencyMs = Date.now() - start
        const rawBody = Buffer.concat(chunks).toString('utf-8')
        let data: unknown = rawBody

        try {
          data = JSON.parse(rawBody)
        } catch {
          // Not JSON, keep as string
        }

        const responseHeaders: Record<string, string> = Object.fromEntries(
          Object.entries(res.headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )

        resolve({
          status: res.statusCode ?? 0,
          data,
          headers: responseHeaders,
          latencyMs,
        })
      })
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Connection timed out after ${timeoutMs}ms`))
    })

    req.on('error', (error: Error) => {
      reject(error)
    })

    if (body !== undefined) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body))
    }

    req.end()
  })
}

/** Build Basic auth header value. */
export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}
