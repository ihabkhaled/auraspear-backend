import { NormalizationPipelineStatus } from '../enums'
import { BusinessException } from '../exceptions/business.exception'

/**
 * Valid normalization pipeline status transitions:
 *   inactive → active  (deploy)
 *   active   → inactive (pause)
 *   active   → error    (auto on failure)
 *   error    → inactive (reset)
 */
const NORMALIZATION_TRANSITIONS = new Map<
  NormalizationPipelineStatus,
  Set<NormalizationPipelineStatus>
>()

NORMALIZATION_TRANSITIONS.set(
  NormalizationPipelineStatus.INACTIVE,
  new Set([NormalizationPipelineStatus.ACTIVE])
)
NORMALIZATION_TRANSITIONS.set(
  NormalizationPipelineStatus.ACTIVE,
  new Set([NormalizationPipelineStatus.INACTIVE, NormalizationPipelineStatus.ERROR])
)
NORMALIZATION_TRANSITIONS.set(
  NormalizationPipelineStatus.ERROR,
  new Set([NormalizationPipelineStatus.INACTIVE])
)

export function validateNormalizationStatusTransition(
  currentStatus: NormalizationPipelineStatus,
  targetStatus: NormalizationPipelineStatus
): void {
  if (currentStatus === targetStatus) {
    return
  }

  const allowedTargets = NORMALIZATION_TRANSITIONS.get(currentStatus)

  if (!allowedTargets?.has(targetStatus)) {
    throw new BusinessException(
      400,
      `Invalid status transition from "${currentStatus}" to "${targetStatus}"`,
      'errors.normalization.invalidStatusTransition'
    )
  }
}
