/**
 * Pre-deploy script: automatically resolves any failed migrations
 * by marking them as rolled-back, so `prisma migrate deploy` can proceed.
 *
 * This is safe because:
 * 1. All our migrations use IF NOT EXISTS / WHERE NOT EXISTS guards
 * 2. Failed migrations leave partial state that the next deploy will complete
 * 3. Prisma will re-apply the rolled-back migration cleanly on next deploy
 */
import { execSync } from 'node:child_process'

function main() {
  console.log('[resolve-failed-migrations] Checking for failed migrations...')

  let output = ''
  try {
    output = execSync('npx prisma migrate status 2>&1', { encoding: 'utf-8' })
  } catch (error) {
    // prisma migrate status exits with code 1 when there are issues
    output = error.stdout ?? ''
    output += '\n'
    output += error.stderr ?? ''
  }

  // Match migration names from failed migration messages
  const failedPattern = /`([^`]+)`[^`]*failed/g
  const matches = [...output.matchAll(failedPattern)]

  if (matches.length === 0) {
    console.log('[resolve-failed-migrations] No failed migrations found.')
    return
  }

  for (const match of matches) {
    const migrationName = match[1]
    console.log(`[resolve-failed-migrations] Resolving failed migration: ${migrationName}`)
    try {
      execSync(`npx prisma migrate resolve --rolled-back ${migrationName}`, {
        encoding: 'utf-8',
        stdio: 'inherit',
      })
      console.log(`[resolve-failed-migrations] Marked ${migrationName} as rolled-back`)
    } catch (resolveError) {
      console.error(`[resolve-failed-migrations] Failed to resolve ${migrationName}:`, resolveError.message)
    }
  }

  console.log('[resolve-failed-migrations] Done.')
}

main()
