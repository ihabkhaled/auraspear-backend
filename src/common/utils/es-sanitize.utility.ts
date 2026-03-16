/**
 * Elasticsearch / OpenSearch query sanitization utilities.
 *
 * Strips dangerous patterns from user-supplied query strings before
 * they are embedded in ES query DSL.  Every module that builds ES
 * queries MUST call `sanitizeEsQueryString()` on user input.
 */

/* ---------------------------------------------------------------- */
/* DANGEROUS PATTERNS                                                */
/* ---------------------------------------------------------------- */

/**
 * ES internal endpoints that must never appear in user query text.
 * Covers: admin APIs, bulk write, reindex, delete-by-query, etc.
 */
const DANGEROUS_ENDPOINTS =
  /_search|_mapping|_cluster|_cat|_nodes|_mget|_bulk|_msearch|_delete_by_query|_update_by_query|_reindex|_aliases|_template|_settings|_tasks|_ingest|_snapshot|_recovery|_flush|_forcemerge|_cache|_segments|_shard_stores|_field_caps/gi

/**
 * Script injection patterns — Elasticsearch scripting can execute
 * arbitrary code on the cluster.
 */
const SCRIPT_PATTERN = /\bscript\b/gi

/**
 * Aggregation keywords that could trigger server-side computation.
 */
const AGGREGATION_PATTERN = /\baggregations?\b|\baggs?\b/gi

/**
 * Wildcard-all pattern — `*:*` matches everything and can be used
 * for data exfiltration.  Also catches backslash-escaped variants.
 */
const MATCH_ALL_PATTERN = /\\?\*\s*:\s*\\?\*/g

/** Maximum allowed length for any user-supplied ES query string. */
const MAX_QUERY_LENGTH = 1000

/* ---------------------------------------------------------------- */
/* PUBLIC API                                                        */
/* ---------------------------------------------------------------- */

/**
 * Sanitize a user-supplied string before embedding it in an
 * Elasticsearch `query_string` or `simple_query_string` query.
 *
 * 1. Truncates to 1000 characters
 * 2. Strips dangerous ES endpoint names
 * 3. Strips `script` keyword (prevents Painless injection)
 * 4. Strips aggregation keywords
 * 5. Strips `*:*` match-all (including backslash-escaped variants)
 * 6. Trims whitespace
 *
 * Returns the sanitized string (may be empty — caller must check).
 */
export function sanitizeEsQueryString(query: string): string {
  return query
    .slice(0, MAX_QUERY_LENGTH)
    .replaceAll(SCRIPT_PATTERN, '')
    .replaceAll(DANGEROUS_ENDPOINTS, '')
    .replaceAll(MATCH_ALL_PATTERN, '')
    .replaceAll(AGGREGATION_PATTERN, '')
    .trim()
}

/**
 * Build a safe `query_string` clause for Elasticsearch.
 *
 * Always sets `allow_leading_wildcard: false` to prevent `*foo`
 * patterns that can cause catastrophic regex evaluation on the
 * ES cluster.
 */
export function buildSafeQueryStringClause(
  sanitizedQuery: string,
  defaultOperator: 'AND' | 'OR' = 'AND'
): Record<string, unknown> {
  return {
    query_string: {
      query: sanitizedQuery,
      default_operator: defaultOperator,
      allow_leading_wildcard: false,
      lenient: true,
    },
  }
}
