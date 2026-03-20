import { promises as dns } from 'node:dns'
import * as https from 'node:https'
import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { HttpMethod, NodeEnvironment, UrlProtocol } from '../../enums'
import { isPrivateHost } from '../../utils/ssrf.utility'
import type {
  AxiosRequestOptions,
  AxiosRequestOptionsWithBody,
  AxiosRequestOptionsWithoutBody,
  AxiosResponseData,
} from './axios.types'
import type { AxiosRequestConfig } from 'axios'

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000

@Injectable()
export class AxiosService {
  private readonly logger = new Logger(AxiosService.name)

  /* ---------------------------------------------------------------- */
  /* CORE REQUEST METHOD                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Make an HTTP request with full security hardening.
   *
   * - URL protocol validation (HTTP/HTTPS only, HTTPS-only in production)
   * - SSRF protection via DNS resolution in production
   * - Private network blocking unless explicitly allowed
   * - Self-signed certificate support (common in internal security tools)
   * - Client certificate (mTLS) support
   * - Response size limiting (10 MB)
   * - Configurable timeouts
   */
  async fetch(url: string, options: AxiosRequestOptions = {}): Promise<AxiosResponseData> {
    const isProduction = process.env.NODE_ENV === NodeEnvironment.PRODUCTION
    const {
      method = HttpMethod.GET,
      headers = {},
      body,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      rejectUnauthorized: callerRejectUnauthorized = isProduction,
      allowPrivateNetwork = false,
      clientCert,
      clientKey,
      caCert,
    } = options

    const rejectUnauthorized = isProduction ? callerRejectUnauthorized : false
    const parsed = this.validateUrl(url, isProduction, allowPrivateNetwork)

    await this.validateDns(parsed, isProduction, allowPrivateNetwork)

    const isHttps = parsed.protocol === UrlProtocol.HTTPS

    if (isHttps && !rejectUnauthorized) {
      this.logger.warn(`TLS verification disabled for ${parsed.hostname}`)
    }

    const httpsAgent = isHttps
      ? new https.Agent({
          rejectUnauthorized,
          ...(clientCert ? { cert: clientCert } : {}),
          ...(clientKey ? { key: clientKey } : {}),
          ...(caCert ? { ca: caCert } : {}),
        })
      : undefined

    const requestConfig: AxiosRequestConfig = {
      url,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      data: body,
      timeout: timeoutMs,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      // Do not throw on non-2xx — consumers handle status codes themselves
      validateStatus: () => true,
      // Return raw text so we can attempt JSON parse
      responseType: 'text',
      transformResponse: (rawData: string) => rawData,
      ...(httpsAgent ? { httpsAgent } : {}),
    }

    const start = Date.now()

    const response = await axios.request(requestConfig)
    const latencyMs = Date.now() - start

    const rawBody = typeof response.data === 'string' ? response.data : String(response.data ?? '')
    let data: unknown = rawBody

    try {
      data = JSON.parse(rawBody)
    } catch {
      // Not JSON — keep as raw string
    }

    const responseHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(response.headers as Record<string, unknown>)) {
      if (typeof value === 'string') {
        responseHeaders[key] = value
      }
    }

    return { status: response.status, data, headers: responseHeaders, latencyMs }
  }

  /* ---------------------------------------------------------------- */
  /* CONVENIENCE METHODS — NO BODY                                     */
  /* ---------------------------------------------------------------- */

  async get(url: string, options: AxiosRequestOptionsWithoutBody = {}): Promise<AxiosResponseData> {
    return this.fetch(url, { ...options, method: HttpMethod.GET })
  }

  async head(
    url: string,
    options: AxiosRequestOptionsWithoutBody = {}
  ): Promise<AxiosResponseData> {
    return this.fetch(url, { ...options, method: HttpMethod.HEAD })
  }

  async options(
    url: string,
    options: AxiosRequestOptionsWithoutBody = {}
  ): Promise<AxiosResponseData> {
    return this.fetch(url, { ...options, method: HttpMethod.OPTIONS })
  }

  /* ---------------------------------------------------------------- */
  /* CONVENIENCE METHODS — WITH BODY                                   */
  /* ---------------------------------------------------------------- */

  async post(
    url: string,
    body: unknown,
    options: AxiosRequestOptionsWithBody = {}
  ): Promise<AxiosResponseData> {
    return this.fetch(url, { ...options, method: HttpMethod.POST, body })
  }

  async put(
    url: string,
    body: unknown,
    options: AxiosRequestOptionsWithBody = {}
  ): Promise<AxiosResponseData> {
    return this.fetch(url, { ...options, method: HttpMethod.PUT, body })
  }

  async patch(
    url: string,
    body: unknown,
    options: AxiosRequestOptionsWithBody = {}
  ): Promise<AxiosResponseData> {
    return this.fetch(url, { ...options, method: HttpMethod.PATCH, body })
  }

  async remove(
    url: string,
    body?: unknown,
    options: AxiosRequestOptionsWithBody = {}
  ): Promise<AxiosResponseData> {
    return this.fetch(url, { ...options, method: HttpMethod.DELETE, body })
  }

  /* ---------------------------------------------------------------- */
  /* AUTHENTICATION HELPERS                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Generate a Base64-encoded Basic Authentication header value.
   */
  basicAuth(username: string, password: string): string {
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE — VALIDATION                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Validate URL protocol and private network restrictions.
   */
  private validateUrl(url: string, isProduction: boolean, allowPrivateNetwork: boolean): URL {
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

    return parsed
  }

  /**
   * Perform DNS resolution to prevent DNS rebinding SSRF attacks in production.
   */
  private async validateDns(
    parsed: URL,
    isProduction: boolean,
    allowPrivateNetwork: boolean
  ): Promise<void> {
    if (!isProduction || allowPrivateNetwork) return

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
}
