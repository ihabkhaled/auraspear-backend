import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  BASE_BACKOFF_MS,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  MAX_RETRIES,
  OSINT_CONCURRENCY_LIMIT,
  OSINT_TEST_IOC_VALUES,
  RATE_LIMIT_WINDOW_MS,
} from './osint-executor.constants'
import {
  appendQueryParameters,
  buildExecutionConfig,
  buildFailedQueryResult,
  buildOsintRequest,
  extractResponseData,
  resolveErrorMessageKey,
  resolveHttpErrorMessageKey,
  resolveTestIocType,
  truncateResponseData,
} from './osint-executor.utilities'
import { AppLogFeature, AppLogOutcome, AppLogSourceType, HttpMethod } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { AxiosService } from '../../common/modules/axios/axios.service'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { decrypt } from '../../common/utils/encryption.utility'
import { AgentConfigRepository } from '../agent-config/agent-config.repository'
import type { OsintEnrichmentResult, OsintQueryResult } from './osint-executor.types'
import type { OsintTestResult } from '../agent-config/agent-config.types'

@Injectable()
export class OsintExecutorService {
  private readonly logger = new Logger(OsintExecutorService.name)
  private readonly rateLimitMap = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly axiosService: AxiosService,
    private readonly agentConfigRepository: AgentConfigRepository,
    private readonly configService: ConfigService,
    private readonly appLogger: AppLoggerService
  ) {}

  /**
   * Query a single OSINT source with an IoC value.
   * Loads the source config, decrypts API key, builds the request, executes it,
   * and updates the source's health status.
   */
  async querySource(
    tenantId: string,
    sourceId: string,
    iocType: string,
    iocValue: string
  ): Promise<OsintQueryResult> {
    const startTime = Date.now()

    const source = await this.agentConfigRepository.findOsintSource(sourceId, tenantId)
    if (!source?.isEnabled) {
      return buildFailedQueryResult(
        sourceId,
        source?.name ?? 'Unknown',
        source?.sourceType ?? 'unknown',
        'Source not found or disabled',
        Date.now() - startTime
      )
    }

    if (!this.checkRateLimit(sourceId)) {
      return buildFailedQueryResult(
        sourceId,
        source.name,
        source.sourceType,
        'Rate limit exceeded',
        Date.now() - startTime
      )
    }

    const decryptedApiKey = this.decryptSourceApiKey(source.encryptedApiKey)
    const executionConfig = buildExecutionConfig(source, decryptedApiKey)
    const requestConfig = buildOsintRequest(executionConfig, iocType, iocValue)
    const finalUrl = appendQueryParameters(requestConfig.url, requestConfig.queryParameters)

    // Log full request details (redact API key from headers)
    const safeHeaders = { ...requestConfig.headers }
    for (const key of Object.keys(safeHeaders)) {
      if (
        key.toLowerCase().includes('key') ||
        key.toLowerCase().includes('auth') ||
        key.toLowerCase() === 'authorization'
      ) {
        Reflect.set(safeHeaders, key, '***REDACTED***')
      }
    }
    this.logger.log(
      `OSINT request: ${requestConfig.method} ${finalUrl} | source=${source.name} (${source.sourceType}) | ioc=${iocType}:${iocValue} | authType=${source.authType} | headers=${JSON.stringify(safeHeaders)} | hasBody=${String(requestConfig.body !== null)} | timeout=${String(executionConfig.timeout)}ms`
    )

    try {
      const response = await this.executeWithRetry(() =>
        this.executeSourceRequest(
          finalUrl,
          requestConfig.method,
          requestConfig.headers,
          requestConfig.body,
          executionConfig.timeout
        )
      )

      let finalData = response.data
      let didPollAnalysis = false

      // VT URL/file submissions return an analysis stub (data.type === "analysis")
      // with a links.self URL that must be polled to get actual scan results.
      // Direct results (data.type === "file"/"domain"/"ip_address") already have attributes.
      if (source.sourceType === 'virustotal') {
        const analysisUrl = this.extractVtAnalysisUrl(response.data)
        if (analysisUrl) {
          this.logger.log(`VT analysis stub detected — polling: ${analysisUrl}`)
          finalData = await this.pollVtAnalysis(
            analysisUrl,
            requestConfig.headers,
            executionConfig.timeout
          )
          didPollAnalysis = true
        }
      }

      // If we polled an analysis, the result structure is different —
      // don't apply the original responsePath (e.g. "data.attributes") since
      // the polled response is already the extracted analysis result.
      const data = didPollAnalysis
        ? finalData
        : extractResponseData(finalData, executionConfig.responsePath)

      const responseTimeMs = Date.now() - startTime

      this.logger.log(
        `OSINT response: ${String(response.status)} | source=${source.name} | ${String(responseTimeMs)}ms | polled=${String(didPollAnalysis)} | dataExtracted=${String(data !== null && data !== undefined)}`
      )

      await this.agentConfigRepository.updateOsintSourceHealth(sourceId, tenantId, true, null)

      this.logQuerySuccess(tenantId, sourceId, source.name, iocType, responseTimeMs)

      return {
        sourceId,
        sourceName: source.name,
        sourceType: source.sourceType,
        success: true,
        data: truncateResponseData(data),
        rawResponse: truncateResponseData(finalData),
        error: null,
        statusCode: response.status,
        messageKey: null,
        responseTimeMs,
        queriedAt: new Date().toISOString(),
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const statusCode = (error as { statusCode?: number }).statusCode ?? null
      const messageKey =
        (error as { messageKey?: string }).messageKey ?? resolveErrorMessageKey(errorMessage)
      const responseTimeMs = Date.now() - startTime

      this.logger.warn(
        `OSINT error: source=${source.name} (${source.sourceType}) | url=${finalUrl} | status=${String(statusCode)} | ${String(responseTimeMs)}ms | error=${errorMessage} | messageKey=${messageKey}`
      )

      await this.agentConfigRepository.updateOsintSourceHealth(
        sourceId,
        tenantId,
        false,
        errorMessage
      )

      this.logQueryFailure(tenantId, sourceId, source.name, iocType, errorMessage)

      return {
        sourceId,
        sourceName: source.name,
        sourceType: source.sourceType,
        success: false,
        data: null,
        rawResponse: null,
        error: errorMessage,
        statusCode,
        messageKey,
        responseTimeMs,
        queriedAt: new Date().toISOString(),
      }
    }
  }

  /**
   * Enrich an IoC by querying multiple OSINT sources in parallel.
   * Uses batched concurrency to avoid overwhelming upstream sources.
   */
  async enrichIoc(
    tenantId: string,
    iocType: string,
    iocValue: string,
    sourceIds: string[]
  ): Promise<OsintEnrichmentResult> {
    const results = await this.executeBatchedQueries(tenantId, iocType, iocValue, sourceIds)

    const successCount = results.filter(r => r.success).length

    this.logEnrichmentComplete(tenantId, iocType, iocValue, sourceIds.length, successCount)

    return {
      iocType,
      iocValue,
      results,
      totalSources: sourceIds.length,
      successCount,
      failureCount: results.length - successCount,
      enrichedAt: new Date().toISOString(),
    }
  }

  /**
   * Execute OSINT queries in batches of OSINT_CONCURRENCY_LIMIT to avoid
   * overwhelming sources with too many parallel requests.
   * Uses recursive batching to avoid await-in-loop lint warning.
   */
  private async executeBatchedQueries(
    tenantId: string,
    iocType: string,
    iocValue: string,
    sourceIds: string[]
  ): Promise<OsintQueryResult[]> {
    if (sourceIds.length === 0) return []

    const batch = sourceIds.slice(0, OSINT_CONCURRENCY_LIMIT)
    const remaining = sourceIds.slice(OSINT_CONCURRENCY_LIMIT)

    const batchResults = await Promise.allSettled(
      batch.map(id => this.querySource(tenantId, id, iocType, iocValue))
    )

    const results: OsintQueryResult[] = []
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value)
      } else {
        results.push(
          buildFailedQueryResult('unknown', 'Unknown', 'unknown', 'Query promise rejected', 0)
        )
      }
    }

    if (remaining.length === 0) return results

    const remainingResults = await this.executeBatchedQueries(
      tenantId,
      iocType,
      iocValue,
      remaining
    )
    return [...results, ...remainingResults]
  }

  /**
   * Test an OSINT source by executing a real query with a safe test IoC.
   * Returns the test result including status code, response time, and error info.
   */
  async testSource(sourceId: string, tenantId: string, actor: string): Promise<OsintTestResult> {
    const source = await this.agentConfigRepository.findOsintSource(sourceId, tenantId)
    if (!source) {
      throw new BusinessException(
        404,
        'OSINT source not found',
        'errors.agentConfig.osintSourceNotFound'
      )
    }

    const testIocType = resolveTestIocType(source.sourceType)
    const testIocValue = Reflect.get(OSINT_TEST_IOC_VALUES, testIocType) as string

    const startTime = Date.now()
    const queryResult = await this.querySource(tenantId, sourceId, testIocType, testIocValue)
    const responseTime = Date.now() - startTime

    this.appLogger.info(`OSINT source tested: ${source.name}`, {
      feature: AppLogFeature.AI_CONFIG,
      action: 'testOsintSource',
      outcome: queryResult.success ? AppLogOutcome.SUCCESS : AppLogOutcome.FAILURE,
      tenantId,
      actorEmail: actor,
      sourceType: AppLogSourceType.SERVICE,
      className: 'OsintExecutorService',
      functionName: 'testSource',
      metadata: { sourceId, sourceName: source.name, success: queryResult.success },
    })

    return {
      success: queryResult.success,
      statusCode: queryResult.statusCode ?? null,
      responseTime,
      error: queryResult.error,
      messageKey: queryResult.messageKey ?? null,
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────

  /**
   * Check and enforce per-source rate limiting.
   * Returns true if the request is allowed, false if rate-limited.
   */
  private checkRateLimit(sourceId: string): boolean {
    const now = Date.now()
    const entry = this.rateLimitMap.get(sourceId)
    if (!entry || now > entry.resetAt) {
      this.rateLimitMap.set(sourceId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
      return true
    }
    if (entry.count >= DEFAULT_RATE_LIMIT_PER_MINUTE) {
      return false
    }
    entry.count++
    return true
  }

  /**
   * Execute a request function with exponential backoff retry for transient errors.
   * Retries on HTTP 429 (rate limited) and 5xx (server errors).
   * Uses recursion instead of a loop to avoid await-in-loop lint warning.
   */
  private async executeWithRetry(
    requestFunction: () => Promise<{ status: number; data: unknown }>,
    attempt = 0
  ): Promise<{ status: number; data: unknown }> {
    try {
      return await requestFunction()
    } catch (error: unknown) {
      const statusMatch = error instanceof Error ? error.message.match(/HTTP (\d+)/) : null
      const status = statusMatch ? Number.parseInt(statusMatch.at(1) ?? '0', 10) : 0
      if (attempt < MAX_RETRIES && (status === 429 || status >= 500)) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt)
        await new Promise<void>(resolve => {
          setTimeout(resolve, delay)
        })
        return this.executeWithRetry(requestFunction, attempt + 1)
      }
      throw error
    }
  }

  private decryptSourceApiKey(encryptedApiKey: string | null): string | null {
    if (!encryptedApiKey) {
      return null
    }

    const encryptionKey = this.configService.get<string>('CONFIG_ENCRYPTION_KEY')
    if (!encryptionKey) {
      this.logger.warn('CONFIG_ENCRYPTION_KEY not configured, cannot decrypt OSINT API key')
      return null
    }

    try {
      return decrypt(encryptedApiKey, encryptionKey)
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to decrypt API key: ${error instanceof Error ? error.message : 'unknown error'}`
      )
      return null
    }
  }

  private async executeSourceRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: Record<string, unknown> | string | null,
    timeoutMs: number
  ): Promise<{ status: number; data: unknown }> {
    const response = await this.axiosService.fetch(url, {
      method: method === HttpMethod.POST ? HttpMethod.POST : HttpMethod.GET,
      headers,
      body: body ?? undefined,
      timeoutMs,
    })

    if (response.status >= 400) {
      const responseBody =
        typeof response.data === 'string'
          ? response.data.slice(0, 500)
          : JSON.stringify(response.data).slice(0, 500)
      this.logger.warn(
        `OSINT HTTP error: ${method} ${url} → ${String(response.status)} | body=${responseBody}`
      )
      const messageKey = resolveHttpErrorMessageKey(response.status)
      const error = new Error(`HTTP ${String(response.status)} response from OSINT source`)
      Object.assign(error, { statusCode: response.status, messageKey })
      throw error
    }

    return { status: response.status, data: response.data }
  }

  private logQuerySuccess(
    tenantId: string,
    sourceId: string,
    sourceName: string,
    iocType: string,
    responseTimeMs: number
  ): void {
    this.appLogger.info(`OSINT query succeeded: ${sourceName}`, {
      feature: AppLogFeature.AI_CONFIG,
      action: 'osintQuery',
      outcome: AppLogOutcome.SUCCESS,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'OsintExecutorService',
      functionName: 'querySource',
      metadata: { sourceId, sourceName, iocType, responseTimeMs },
    })
  }

  private logQueryFailure(
    tenantId: string,
    sourceId: string,
    sourceName: string,
    iocType: string,
    errorMessage: string
  ): void {
    this.appLogger.info(`OSINT query failed: ${sourceName}`, {
      feature: AppLogFeature.AI_CONFIG,
      action: 'osintQuery',
      outcome: AppLogOutcome.FAILURE,
      tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'OsintExecutorService',
      functionName: 'querySource',
      metadata: { sourceId, sourceName, iocType, error: errorMessage },
    })
  }

  private logEnrichmentComplete(
    tenantId: string,
    iocType: string,
    iocValue: string,
    totalSources: number,
    successCount: number
  ): void {
    this.appLogger.info(
      `OSINT enrichment complete: ${String(successCount)}/${String(totalSources)} sources`,
      {
        feature: AppLogFeature.AI_CONFIG,
        action: 'osintEnrich',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'OsintExecutorService',
        functionName: 'enrichIoc',
        metadata: { iocType, iocValue, totalSources, successCount },
      }
    )
  }

  /**
   * Fetch VT analysis results from a given analysis URL.
   * The frontend calls this when the initial response was an analysis stub.
   * Validates the URL is a legitimate VT analysis URL to prevent SSRF.
   */
  async fetchAnalysisResults(tenantId: string, analysisUrl: string): Promise<unknown> {
    if (!analysisUrl || typeof analysisUrl !== 'string') {
      throw new BusinessException(
        400,
        'analysisUrl is required',
        'errors.osint.analysisUrlRequired'
      )
    }
    if (!analysisUrl.startsWith('https://www.virustotal.com/api/v3/analyses/')) {
      throw new BusinessException(400, 'Invalid analysis URL', 'errors.osint.badRequest')
    }

    // Find a VT source for this tenant to get the API key
    const sources = await this.agentConfigRepository.findAllOsintSources(tenantId)
    const vtSource = sources.find(s => s.sourceType === 'virustotal' && s.isEnabled)

    if (!vtSource) {
      throw new BusinessException(
        404,
        'No enabled VirusTotal source',
        'errors.osint.sourceNotFound'
      )
    }

    const apiKey = this.decryptSourceApiKey(vtSource.encryptedApiKey)
    if (!apiKey) {
      throw new BusinessException(500, 'Failed to decrypt API key', 'errors.osint.authFailed')
    }

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (vtSource.headerName) {
      headers[vtSource.headerName] = apiKey
    }

    const response = await this.axiosService.fetch(analysisUrl, {
      method: HttpMethod.GET,
      headers,
      timeoutMs: vtSource.timeout,
    })

    if (response.status >= 400) {
      throw new BusinessException(
        response.status,
        `VT analysis fetch failed: ${String(response.status)}`,
        resolveHttpErrorMessageKey(response.status)
      )
    }

    return response.data
  }

  /**
   * Extracts the VT analysis URL from a VT URL/file submission response.
   * Only matches analysis stubs where data.type === "analysis".
   * Direct results (data.type === "file" / "domain" / "ip_address") have
   * data.attributes.last_analysis_results and should NOT be followed up.
   */
  private extractVtAnalysisUrl(responseData: unknown): string | null {
    if (typeof responseData !== 'object' || responseData === null) {
      return null
    }

    const data = Reflect.get(responseData as Record<string, unknown>, 'data')
    if (typeof data !== 'object' || data === null) {
      return null
    }

    const links = Reflect.get(data as Record<string, unknown>, 'links')
    if (typeof links !== 'object' || links === null) {
      return null
    }

    const selfUrl = Reflect.get(links as Record<string, unknown>, 'self')
    if (typeof selfUrl !== 'string') {
      return null
    }

    // Only /analyses/ URLs need polling — they are stubs from URL/file submissions.
    // Direct results (/files/, /domains/, /ip_addresses/) already have full data.
    return selfUrl.startsWith('https://www.virustotal.com/api/v3/analyses/') ? selfUrl : null
  }

  /**
   * Polls the VT analysis endpoint until the analysis is complete or timeout.
   * VT analysis takes a few seconds to complete — we poll up to 5 times with 3s delay.
   * Uses recursion instead of a loop to avoid await-in-loop lint warning.
   */
  private async pollVtAnalysis(
    analysisUrl: string,
    headers: Record<string, string>,
    timeoutMs: number,
    attempt = 0
  ): Promise<unknown> {
    const maxPolls = 5
    const pollDelayMs = 3_000

    if (attempt >= maxPolls) {
      this.logger.warn('VT analysis polling timed out — returning last known state')
      return {
        status: 'queued',
        message: 'Analysis still in progress. Check VT dashboard for results.',
      }
    }

    const getHeaders = { ...headers }
    delete getHeaders['Content-Type']

    await new Promise<void>(resolve => {
      setTimeout(resolve, pollDelayMs)
    })

    try {
      const response = await this.axiosService.fetch(analysisUrl, {
        method: HttpMethod.GET,
        headers: getHeaders,
        timeoutMs,
      })

      if (response.status >= 400) {
        this.logger.warn(`VT analysis poll failed: ${String(response.status)}`)
        return this.pollVtAnalysis(analysisUrl, headers, timeoutMs, attempt + 1)
      }

      const data = Reflect.get((response.data as Record<string, unknown>) ?? {}, 'data') as
        | Record<string, unknown>
        | undefined

      const attributes = data
        ? (Reflect.get(data, 'attributes') as Record<string, unknown> | undefined)
        : undefined

      const status = attributes
        ? (Reflect.get(attributes, 'status') as string | undefined)
        : undefined

      if (status === 'completed') {
        return response.data
      }

      this.logger.log(
        `VT analysis poll ${String(attempt + 1)}/${String(maxPolls)}: status=${status ?? 'unknown'}`
      )
      return this.pollVtAnalysis(analysisUrl, headers, timeoutMs, attempt + 1)
    } catch (error: unknown) {
      this.logger.warn(
        `VT analysis poll error: ${error instanceof Error ? error.message : 'unknown'}`
      )
      return this.pollVtAnalysis(analysisUrl, headers, timeoutMs, attempt + 1)
    }
  }

  /**
   * Upload a file to a VirusTotal-compatible OSINT source for scanning.
   * Sends the file as multipart/form-data to the source's /files endpoint.
   */
  async uploadFileForScan(
    tenantId: string,
    sourceId: string,
    file: Express.Multer.File
  ): Promise<OsintQueryResult> {
    if (!file) {
      throw new BusinessException(400, 'File is required', 'errors.osint.fileRequired')
    }
    if (!sourceId) {
      throw new BusinessException(400, 'sourceId is required', 'errors.osint.sourceIdRequired')
    }

    const startTime = Date.now()
    const source = await this.agentConfigRepository.findOsintSource(sourceId, tenantId)

    if (!source) {
      throw new BusinessException(404, 'OSINT source not found', 'errors.osint.sourceNotFound')
    }

    if (!source.isEnabled) {
      throw new BusinessException(403, 'OSINT source is disabled', 'errors.osint.sourceDisabled')
    }

    const apiKey = this.decryptSourceApiKey(source.encryptedApiKey)
    const baseUrl = (source.baseUrl ?? '').replace(/\/+$/, '')

    const FormData = (await import('form-data')).default
    const form = new FormData()
    form.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype })

    const headers: Record<string, string> = {
      ...form.getHeaders(),
    }

    if (source.headerName && apiKey) {
      headers[source.headerName] = apiKey
    }

    try {
      const response = await this.axiosService.fetch(`${baseUrl}/files`, {
        method: HttpMethod.POST,
        headers,
        body: form,
        timeoutMs: source.timeout,
      })

      const responseTimeMs = Date.now() - startTime

      if (response.status >= 400) {
        return buildFailedQueryResult(
          sourceId,
          source.name,
          source.sourceType,
          `HTTP ${String(response.status)} from file upload`,
          responseTimeMs
        )
      }

      // VT file uploads return an analysis stub (data.type === "analysis")
      // Poll the analysis URL to get the actual scan results
      let finalData = response.data
      let didPollAnalysis = false
      const analysisUrl = this.extractVtAnalysisUrl(response.data)
      if (analysisUrl) {
        this.logger.log(`VT file analysis stub detected — polling: ${analysisUrl}`)
        const authHeaders: Record<string, string> = {}
        if (source.headerName && apiKey) {
          authHeaders[source.headerName] = apiKey
        }
        finalData = await this.pollVtAnalysis(analysisUrl, authHeaders, source.timeout)
        didPollAnalysis = true
      }

      // Skip responsePath extraction for polled results — different structure
      const data = didPollAnalysis ? finalData : extractResponseData(finalData, source.responsePath)

      this.appLogger.info(`OSINT file upload succeeded: ${source.name}`, {
        feature: AppLogFeature.AI_CONFIG,
        action: 'osintFileUpload',
        outcome: AppLogOutcome.SUCCESS,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'OsintExecutorService',
        functionName: 'uploadFileForScan',
        metadata: {
          sourceId,
          sourceName: source.name,
          fileName: file.originalname,
          responseTimeMs,
        },
      })

      return {
        sourceId,
        sourceName: source.name,
        sourceType: source.sourceType,
        success: true,
        data: truncateResponseData(data),
        rawResponse: truncateResponseData(finalData),
        error: null,
        statusCode: response.status,
        messageKey: null,
        responseTimeMs,
        queriedAt: new Date().toISOString(),
      }
    } catch (error: unknown) {
      const responseTimeMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'File upload failed'

      this.appLogger.info(`OSINT file upload failed: ${source.name}`, {
        feature: AppLogFeature.AI_CONFIG,
        action: 'osintFileUpload',
        outcome: AppLogOutcome.FAILURE,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'OsintExecutorService',
        functionName: 'uploadFileForScan',
        metadata: {
          sourceId,
          sourceName: source.name,
          fileName: file.originalname,
          error: errorMessage,
        },
      })

      return buildFailedQueryResult(
        sourceId,
        source.name,
        source.sourceType,
        errorMessage,
        responseTimeMs
      )
    }
  }
}
