import { Injectable } from '@nestjs/common'

interface CacheEntry {
  permissions: Set<string>
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

@Injectable()
export class PermissionCacheService {
  private readonly cache = new Map<string, CacheEntry>()

  private buildKey(tenantId: string, role: string): string {
    return `${tenantId}:${role}`
  }

  get(tenantId: string, role: string): Set<string> | null {
    const key = this.buildKey(tenantId, role)
    const entry = this.cache.get(key)

    if (!entry) return null

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return entry.permissions
  }

  set(tenantId: string, role: string, permissions: Set<string>): void {
    const key = this.buildKey(tenantId, role)
    this.cache.set(key, {
      permissions,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })
  }

  invalidate(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.cache.delete(key)
      }
    }
  }

  invalidateAll(): void {
    this.cache.clear()
  }
}
