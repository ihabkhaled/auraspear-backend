import { PatchStatus, VulnerabilitySeverity } from '../../common/enums'

export const VALID_SEVERITIES = new Set<string>(Object.values(VulnerabilitySeverity))

export const VALID_PATCH_STATUSES = new Set<string>(Object.values(PatchStatus))
