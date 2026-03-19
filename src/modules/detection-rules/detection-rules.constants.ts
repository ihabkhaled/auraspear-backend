export enum DetectionExecutionEngine {
  UNKNOWN = 'unknown',
  FIELD_MATCH = 'field_match',
  SIGMA = 'sigma',
  YARAL = 'yaral',
}

export enum SigmaFieldModifier {
  EQUALS = 'equals',
  CONTAINS = 'contains',
  STARTS_WITH = 'startswith',
  ENDS_WITH = 'endswith',
  REGEX = 're',
  EXISTS = 'exists',
}

export enum SigmaConditionOperator {
  SELECTOR = 'selector',
  AND = 'and',
  OR = 'or',
  NOT = 'not',
}

export enum YaraLLogicalOperator {
  ALL = 'all',
  ANY = 'any',
  NOT = 'not',
}

export enum YaraLComparator {
  EQUALS = 'equals',
  CONTAINS = 'contains',
  STARTS_WITH = 'startsWith',
  ENDS_WITH = 'endsWith',
  MATCHES = 'matches',
  IN = 'in',
  GREATER_THAN = 'greaterThan',
  LESS_THAN = 'lessThan',
  EXISTS = 'exists',
}

export const SIGMA_OBJECT_KEYS = ['sigma', 'sigmaRule'] as const
export const YARAL_OBJECT_KEYS = ['yaral', 'yaralRule'] as const
export const SIGMA_DETECTION_KEY = 'detection'
export const SIGMA_CONDITION_KEY = 'condition'
export const YARAL_MATCH_KEY = 'match'
