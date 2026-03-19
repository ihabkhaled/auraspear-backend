import { promises as dns } from 'node:dns'
import * as http from 'node:http'
import * as https from 'node:https'
import { HttpMethod, NodeEnvironment, UrlProtocol } from '../enums'
import { isPrivateHost } from './ssrf.utility'
import type { ConnectorHttpOptions, ConnectorHttpResponse } from './connector-http.types'

export type { ConnectorHttpOptions, ConnectorHttpResponse } from './connector-http.types'

/**
 * HTTP client for connector integrations.
 * Supports self-signed certificates (common in internal security tools).
 * Validates URL protocol and optionally blocks private network targets.
 * In production, performs DNS resolution to prevent DNS rebinding SSRF attacks.
 */
export async function connectorFetch(
  url: string,
  options: ConnectorHttpOptions = {}
): Promise<ConnectorHttpResponse> {
  const isProduction = process.env.NODE_ENV === NodeEnvironment.PRODUCTION
  const {
    method = HttpMethod.GET,
    headers = {},
    body,
    timeoutMs = 15_000,
    rejectUnauthorized: callerRejectUnauthorized = isProduction,
    allowPrivateNetwork = false,
    clientCert,
    clientKey,
    caCert,
  } = options

  const rejectUnauthorized = isProduction ? callerRejectUnauthorized : false
  const parsed = new URL(url)

  if (parsed.protocol !== UrlProtocol.HTTPS && parsed.protocol !== UrlProtocol.HTTP) {
    throw new Error('Only HTTP(S) URLs are allowed')
  }

  if (isProduction && parsed.protocol !== UrlProtocol.HTTPS) {
    throw new Error('Only HTTPS URLs are allowed in production')
  }

  if (isProduction && !allowPrivateNetwork && isPrivateHost(parsed.hostname)) {
    throw new Error('URLs pointing to private/internal networks are not allowed')
  }

  if (isProduction && !allowPrivateNetwork) {
    try {
      const { address } = await dns.lookup(parsed.hostname)
      if (isPrivateHost(address)) {
        throw new Error(
          `Hostname '${parsed.hostname}' resolves to a private IP address (SSRF blocked)`
        )
      }
    } catch (dnsError: unknown) {
      if (dnsError instanceof Error && dnsError.message.includes('SSRF blocked')) {
        throw dnsError
      }

      throw new Error(
        `DNS resolution failed for '${parsed.hostname}': ${dnsError instanceof Error ? dnsError.message : 'unknown error'}`
      )
    }
  }

  const start = Date.now()
  const isHttps = parsed.protocol === UrlProtocol.HTTPS

  if (isHttps && !rejectUnauthorized) {
    console.warn(`[connector-http] TLS verification disabled for ${parsed.hostname}`)
  }

  return new Promise((resolve, reject) => {
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

    const maxResponseBytes = 10 * 1024 * 1024
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
          // Not JSON, keep as string.
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

export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}
