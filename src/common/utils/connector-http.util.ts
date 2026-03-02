import * as http from 'node:http'
import * as https from 'node:https'

export interface ConnectorHttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  rejectUnauthorized?: boolean
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
 * Does NOT apply SSRF protection — these URLs are admin-configured.
 */
export function connectorFetch(
  url: string,
  options: ConnectorHttpOptions = {}
): Promise<ConnectorHttpResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 15_000,
    rejectUnauthorized = true,
  } = options

  return new Promise((resolve, reject) => {
    const start = Date.now()
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'

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
    }

    const transport = isHttps ? https : http
    const req = transport.request(requestOptions, res => {
      const chunks: Buffer[] = []

      res.on('data', (chunk: Buffer) => {
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

        const responseHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') {
            responseHeaders[key] = value
          }
        }

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
