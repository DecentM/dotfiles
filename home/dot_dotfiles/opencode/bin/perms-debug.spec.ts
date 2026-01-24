import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

const PERMS_DEBUG = resolve(import.meta.dir, 'perms-debug.ts')
const SH_PERMISSIONS = resolve(import.meta.dir, '../tools/sh-permissions.yaml')

// Use a fixed workdir for consistent testing
const TEST_WORKDIR = '/var/home/user/project'

/**
 * Run perms-debug CLI and return exit code.
 */
const runPermsDebug = async (
  command: string,
  workdir?: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const args = [SH_PERMISSIONS, command]
  if (workdir) {
    args.unshift('-w', workdir)
  }

  const proc = Bun.spawn(['bun', PERMS_DEBUG, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  const exitCode = await proc.exited

  return { exitCode, stdout, stderr }
}

// =============================================================================
// Constraint validation tests
// =============================================================================

describe('constraint validation', () => {
  describe('cwd_only constraint', () => {
    test('DENY: find / -type f -maxdepth 9 - path outside cwd', async () => {
      const result = await runPermsDebug('find / -type f -maxdepth 9', TEST_WORKDIR)

      expect(result.exitCode).toBe(1) // DENY
      expect(result.stdout).toContain('DENY')
      expect(result.stdout).toContain('outside working directory')
    })

    test('DENY: find /etc -maxdepth 5 - absolute path outside cwd', async () => {
      const result = await runPermsDebug('find /etc -maxdepth 5', TEST_WORKDIR)

      expect(result.exitCode).toBe(1) // DENY
      expect(result.stdout).toContain('DENY')
    })
  })

  describe('max_depth constraint', () => {
    test('DENY: find . -type f -maxdepth 11 - exceeds max_depth of 10', async () => {
      const result = await runPermsDebug('find . -type f -maxdepth 11', TEST_WORKDIR)

      expect(result.exitCode).toBe(1) // DENY
      expect(result.stdout).toContain('DENY')
      expect(result.stdout).toContain('exceeds maximum')
    })

    test('ALLOW: find . -type f -maxdepth 5 - within cwd and valid depth', async () => {
      const result = await runPermsDebug('find . -type f -maxdepth 5', TEST_WORKDIR)

      expect(result.exitCode).toBe(0) // ALLOW
      expect(result.stdout).toContain('ALLOW')
    })

    test('ALLOW: find . -maxdepth 10 - exactly at max allowed depth', async () => {
      const result = await runPermsDebug('find . -maxdepth 10', TEST_WORKDIR)

      expect(result.exitCode).toBe(0) // ALLOW
      expect(result.stdout).toContain('ALLOW')
    })

    test('DENY: find . -name *.ts - missing required maxdepth', async () => {
      const result = await runPermsDebug('find . -name "*.ts"', TEST_WORKDIR)

      expect(result.exitCode).toBe(1) // DENY
      expect(result.stdout).toContain('DENY')
      expect(result.stdout).toContain('Must specify -maxdepth')
    })
  })

  describe('combined constraints', () => {
    test('DENY: find / -maxdepth 5 - path outside cwd (first constraint fails)', async () => {
      const result = await runPermsDebug('find / -maxdepth 5', TEST_WORKDIR)

      expect(result.exitCode).toBe(1) // DENY
      expect(result.stdout).toContain('DENY')
      expect(result.stdout).toContain('outside working directory')
    })

    test('DENY: find node_modules -maxdepth 3 - excluded directory', async () => {
      const result = await runPermsDebug('find node_modules -maxdepth 3', TEST_WORKDIR)

      expect(result.exitCode).toBe(1) // DENY
      expect(result.stdout).toContain('DENY')
      expect(result.stdout).toContain('excluded pattern')
    })
  })

  describe('no constraints (pattern-only)', () => {
    test('ALLOW: echo hello - no constraints on echo', async () => {
      const result = await runPermsDebug('echo hello', TEST_WORKDIR)

      expect(result.exitCode).toBe(0) // ALLOW
      expect(result.stdout).toContain('ALLOW')
    })

    test('DENY: rm -rf / - explicitly denied pattern', async () => {
      const result = await runPermsDebug('rm -rf /', TEST_WORKDIR)

      expect(result.exitCode).toBe(1) // DENY
      expect(result.stdout).toContain('DENY')
    })
  })
})

describe('CLI options', () => {
  test('shows workdir in output when specified', async () => {
    const result = await runPermsDebug('find . -maxdepth 5', '/custom/workdir/path')

    expect(result.stdout).toContain('/custom/workdir/path')
  })

  test('uses process.cwd() when no workdir specified', async () => {
    const result = await runPermsDebug('echo hello')

    // Should still work and show ALLOW
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('ALLOW')
  })
})
