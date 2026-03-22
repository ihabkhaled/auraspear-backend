import { Injectable } from '@nestjs/common'
import { CACHE_TTL_MS } from './role-settings.constants'
import type { PermissionCacheEntry } from './role-settings.types'

@Injectable()
export class PermissionCacheService {
  private readonly cache = new Map<string, PermissionCacheEntry>()

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
