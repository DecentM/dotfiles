/**
 * Tests for the validators module.
 * Tests constraint validation functions.
 */

import { describe, expect, test } from 'bun:test'
import type { PermissionPattern } from './types'
import {
  hasShortFlag,
  validateConstraints,
  validateCwdOnly,
  validateMaxDepth,
  validateNoForce,
  validateNoRecursive,
  validateRequireFlag,
} from './validators'

// =============================================================================
// validateCwdOnly
// =============================================================================

describe('validateCwdOnly', () => {
  const workdir = '/project'

  describe('allows paths within cwd', () => {
    test('allows relative path in cwd', () => {
      const result = validateCwdOnly('cat file.txt', workdir)
      expect(result.valid).toBe(true)
    })

    test('allows nested relative path', () => {
      const result = validateCwdOnly('cat src/index.ts', workdir)
      expect(result.valid).toBe(true)
    })

    test('allows . path', () => {
      const result = validateCwdOnly('ls .', workdir)
      expect(result.valid).toBe(true)
    })

    test('allows ./ path', () => {
      const result = validateCwdOnly('ls ./src', workdir)
      expect(result.valid).toBe(true)
    })

    test('allows commands with no path arguments', () => {
      const result = validateCwdOnly('ls', workdir)
      expect(result.valid).toBe(true)
    })
  })

  describe('denies paths outside cwd', () => {
    test('denies absolute path outside cwd', () => {
      const result = validateCwdOnly('cat /etc/passwd', workdir)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('outside working directory')
    })

    test('denies parent directory traversal', () => {
      const result = validateCwdOnly('cat ../secret.txt', workdir)
      expect(result.valid).toBe(false)
    })

    test('denies deep parent traversal', () => {
      const result = validateCwdOnly('cat ../../etc/passwd', workdir)
      expect(result.valid).toBe(false)
    })
  })

  describe('denies home directory', () => {
    test('denies ~ path', () => {
      const result = validateCwdOnly('cd ~', workdir)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Home directory')
    })

    test('denies ~/ path', () => {
      const result = validateCwdOnly('cat ~/.bashrc', workdir)
      expect(result.valid).toBe(false)
    })

    test('denies cd with no args (goes to ~)', () => {
      const result = validateCwdOnly('cd', workdir)
      expect(result.valid).toBe(false)
    })
  })

  describe('denies cd -', () => {
    test('denies cd - (unknown destination)', () => {
      const result = validateCwdOnly('cd -', workdir)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('cd -')
    })
  })

  describe('also_allow option', () => {
    test('allows paths in also_allow list', () => {
      const result = validateCwdOnly('cat /tmp/file.txt', workdir, {
        also_allow: ['/tmp'],
      })
      expect(result.valid).toBe(true)
    })

    test('allows nested paths in also_allow', () => {
      const result = validateCwdOnly('cat /tmp/subdir/file.txt', workdir, {
        also_allow: ['/tmp'],
      })
      expect(result.valid).toBe(true)
    })

    test('allows ~ when in also_allow', () => {
      const result = validateCwdOnly('cd ~', workdir, {
        also_allow: ['~'],
      })
      expect(result.valid).toBe(true)
    })

    test('still denies paths not in also_allow', () => {
      const result = validateCwdOnly('cat /etc/passwd', workdir, {
        also_allow: ['/tmp'],
      })
      expect(result.valid).toBe(false)
    })
  })

  describe('exclude option', () => {
    test('denies paths matching exclude pattern', () => {
      const result = validateCwdOnly('cat node_modules/pkg/index.js', workdir, {
        exclude: ['node_modules'],
      })
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('excluded pattern')
    })

    test('denies nested paths containing excluded segment', () => {
      const result = validateCwdOnly('cat .git/config', workdir, {
        exclude: ['.git'],
      })
      expect(result.valid).toBe(false)
    })

    test('allows paths not matching exclude', () => {
      const result = validateCwdOnly('cat src/index.ts', workdir, {
        exclude: ['node_modules', '.git'],
      })
      expect(result.valid).toBe(true)
    })

    test('supports wildcard patterns in exclude', () => {
      const result = validateCwdOnly('cat .env.local', workdir, {
        exclude: ['.env*'],
      })
      expect(result.valid).toBe(false)
    })
  })

  describe('combined options', () => {
    test('also_allow and exclude work together', () => {
      // Allow /tmp but exclude certain patterns
      const result = validateCwdOnly('cat /tmp/secrets/.env', workdir, {
        also_allow: ['/tmp'],
        exclude: ['.env*'],
      })
      expect(result.valid).toBe(false)
    })
  })
})

// =============================================================================
// hasShortFlag
// =============================================================================

describe('hasShortFlag', () => {
  test('detects exact short flag', () => {
    expect(hasShortFlag('-r', '-r')).toBe(true)
    expect(hasShortFlag('-f', '-f')).toBe(true)
  })

  test('detects flag in combined form', () => {
    expect(hasShortFlag('-rf', '-r')).toBe(true)
    expect(hasShortFlag('-rf', '-f')).toBe(true)
  })

  test('detects flag in longer combined form', () => {
    expect(hasShortFlag('-Rvf', '-v')).toBe(true)
    expect(hasShortFlag('-Rvf', '-R')).toBe(true)
  })

  test('returns false for missing flag', () => {
    expect(hasShortFlag('-la', '-r')).toBe(false)
    expect(hasShortFlag('-v', '-f')).toBe(false)
  })

  test('handles flag without leading dash', () => {
    expect(hasShortFlag('-rf', 'r')).toBe(true)
    expect(hasShortFlag('-rf', 'f')).toBe(true)
  })

  test('returns false for long options', () => {
    expect(hasShortFlag('--recursive', '-r')).toBe(false)
  })

  test('returns false for non-flag tokens', () => {
    expect(hasShortFlag('file.txt', '-f')).toBe(false)
  })

  test('returns false for multi-char flag arg', () => {
    expect(hasShortFlag('-rf', '-rf')).toBe(false)
    expect(hasShortFlag('-la', '-la')).toBe(false)
  })
})

// =============================================================================
// validateNoRecursive
// =============================================================================

describe('validateNoRecursive', () => {
  describe('denies recursive flags', () => {
    test('denies -r flag', () => {
      const result = validateNoRecursive('cp -r src/ dest/')
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Recursive flag')
    })

    test('denies -R flag', () => {
      const result = validateNoRecursive('cp -R src/ dest/')
      expect(result.valid).toBe(false)
    })

    test('denies --recursive flag', () => {
      const result = validateNoRecursive('cp --recursive src/ dest/')
      expect(result.valid).toBe(false)
    })

    test('denies combined -rf flag', () => {
      const result = validateNoRecursive('rm -rf dir/')
      expect(result.valid).toBe(false)
    })

    test('denies combined -Rf flag', () => {
      const result = validateNoRecursive('rm -Rf dir/')
      expect(result.valid).toBe(false)
    })
  })

  describe('allows non-recursive commands', () => {
    test('allows cp without recursive', () => {
      const result = validateNoRecursive('cp file.txt dest/')
      expect(result.valid).toBe(true)
    })

    test('allows rm without recursive', () => {
      const result = validateNoRecursive('rm file.txt')
      expect(result.valid).toBe(true)
    })

    test('allows -f without -r', () => {
      const result = validateNoRecursive('rm -f file.txt')
      expect(result.valid).toBe(true)
    })
  })
})

// =============================================================================
// validateNoForce
// =============================================================================

describe('validateNoForce', () => {
  describe('denies force flags', () => {
    test('denies -f flag', () => {
      const result = validateNoForce('rm -f file')
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Force flag')
    })

    test('denies --force flag', () => {
      const result = validateNoForce('rm --force file')
      expect(result.valid).toBe(false)
    })

    test('denies combined -rf flag', () => {
      const result = validateNoForce('rm -rf dir/')
      expect(result.valid).toBe(false)
    })
  })

  describe('allows non-force commands', () => {
    test('allows rm without force', () => {
      const result = validateNoForce('rm file')
      expect(result.valid).toBe(true)
    })

    test('allows -r without -f', () => {
      const result = validateNoForce('cp -r src/ dest/')
      expect(result.valid).toBe(true)
    })

    test('allows -i (interactive) flag', () => {
      const result = validateNoForce('rm -i file')
      expect(result.valid).toBe(true)
    })
  })
})

// =============================================================================
// validateMaxDepth
// =============================================================================

describe('validateMaxDepth', () => {
  const maxAllowed = 10

  describe('requires maxdepth flag', () => {
    test('denies command without maxdepth', () => {
      const result = validateMaxDepth('find . -name "*.ts"', maxAllowed)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Must specify -maxdepth')
    })
  })

  describe('validates maxdepth value', () => {
    test('allows maxdepth within limit', () => {
      const result = validateMaxDepth('find . -maxdepth 5 -name "*.ts"', maxAllowed)
      expect(result.valid).toBe(true)
    })

    test('allows maxdepth at limit', () => {
      const result = validateMaxDepth('find . -maxdepth 10 -name "*.ts"', 10)
      expect(result.valid).toBe(true)
    })

    test('denies maxdepth exceeding limit', () => {
      const result = validateMaxDepth('find . -maxdepth 20 -name "*.ts"', 10)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('exceeds maximum')
    })

    test('supports --max-depth variant', () => {
      const result = validateMaxDepth('find . --max-depth 5 -name "*.ts"', maxAllowed)
      expect(result.valid).toBe(true)
    })
  })

  describe('error handling', () => {
    test('errors on missing depth value', () => {
      const result = validateMaxDepth('find . -maxdepth', maxAllowed)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Missing value')
    })

    test('errors on non-numeric depth', () => {
      const result = validateMaxDepth('find . -maxdepth abc', maxAllowed)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Invalid depth')
    })
  })
})

// =============================================================================
// validateRequireFlag
// =============================================================================

describe('validateRequireFlag', () => {
  describe('validates required flag presence', () => {
    test('allows command with required flag', () => {
      const result = validateRequireFlag('rsync --dry-run src/ dest/', '--dry-run')
      expect(result.valid).toBe(true)
    })

    test('denies command without required flag', () => {
      const result = validateRequireFlag('rsync src/ dest/', '--dry-run')
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Required flag')
    })
  })

  describe('handles short flags', () => {
    test('finds exact short flag', () => {
      const result = validateRequireFlag('ls -n file', '-n')
      expect(result.valid).toBe(true)
    })

    test('finds short flag in combined form', () => {
      const result = validateRequireFlag('rm -rf dir/', '-r')
      expect(result.valid).toBe(true)
    })
  })

  describe('handles long flags', () => {
    test('finds exact long flag', () => {
      const result = validateRequireFlag('git commit --amend', '--amend')
      expect(result.valid).toBe(true)
    })

    test('denies when long flag missing', () => {
      const result = validateRequireFlag("git commit -m 'msg'", '--amend')
      expect(result.valid).toBe(false)
    })
  })
})

// =============================================================================
// validateConstraints
// =============================================================================

describe('validateConstraints', () => {
  const workdir = '/project'

  describe('with no constraints', () => {
    test('allows command when rule has no constraints', () => {
      const rule: PermissionPattern = {
        pattern: 'echo*',
        decision: 'allow',
      }
      const result = validateConstraints('echo hello', workdir, rule)
      expect(result.valid).toBe(true)
    })
  })

  describe('with single constraint (string shorthand)', () => {
    test('validates cwd_only constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'cat*',
        decision: 'allow',
        constraints: ['cwd_only'],
      }

      const allowed = validateConstraints('cat file.txt', workdir, rule)
      expect(allowed.valid).toBe(true)

      const denied = validateConstraints('cat /etc/passwd', workdir, rule)
      expect(denied.valid).toBe(false)
    })

    test('validates no_recursive constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'cp*',
        decision: 'allow',
        constraints: ['no_recursive'],
      }

      const allowed = validateConstraints('cp file.txt dest/', workdir, rule)
      expect(allowed.valid).toBe(true)

      const denied = validateConstraints('cp -r src/ dest/', workdir, rule)
      expect(denied.valid).toBe(false)
    })

    test('validates no_force constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'rm*',
        decision: 'allow',
        constraints: ['no_force'],
      }

      const allowed = validateConstraints('rm file.txt', workdir, rule)
      expect(allowed.valid).toBe(true)

      const denied = validateConstraints('rm -f file.txt', workdir, rule)
      expect(denied.valid).toBe(false)
    })
  })

  describe('with single constraint (object form)', () => {
    test('validates cwd_only with options', () => {
      const rule: PermissionPattern = {
        pattern: 'cat*',
        decision: 'allow',
        constraints: [
          {
            type: 'cwd_only',
            also_allow: ['/tmp'],
            exclude: ['.git'],
          },
        ],
      }

      const allowedCwd = validateConstraints('cat file.txt', workdir, rule)
      expect(allowedCwd.valid).toBe(true)

      const allowedTmp = validateConstraints('cat /tmp/log.txt', workdir, rule)
      expect(allowedTmp.valid).toBe(true)

      const deniedGit = validateConstraints('cat .git/config', workdir, rule)
      expect(deniedGit.valid).toBe(false)
    })

    test('validates max_depth constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'find*',
        decision: 'allow',
        constraints: [
          {
            type: 'max_depth',
            value: 5,
          },
        ],
      }

      const allowed = validateConstraints('find . -maxdepth 3 -name "*.ts"', workdir, rule)
      expect(allowed.valid).toBe(true)

      const denied = validateConstraints('find . -maxdepth 10 -name "*.ts"', workdir, rule)
      expect(denied.valid).toBe(false)
    })

    test('validates require_flag constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'rsync*',
        decision: 'allow',
        constraints: [
          {
            type: 'require_flag',
            flag: '--dry-run',
          },
        ],
      }

      const allowed = validateConstraints('rsync --dry-run src/ dest/', workdir, rule)
      expect(allowed.valid).toBe(true)

      const denied = validateConstraints('rsync src/ dest/', workdir, rule)
      expect(denied.valid).toBe(false)
    })
  })

  describe('with multiple constraints', () => {
    test('all constraints must pass', () => {
      const rule: PermissionPattern = {
        pattern: 'cp*',
        decision: 'allow',
        constraints: ['cwd_only', 'no_recursive'],
      }

      // Both pass
      const allowed = validateConstraints('cp file.txt dest/', workdir, rule)
      expect(allowed.valid).toBe(true)

      // cwd_only fails
      const deniedPath = validateConstraints('cp /etc/passwd dest/', workdir, rule)
      expect(deniedPath.valid).toBe(false)

      // no_recursive fails
      const deniedRecursive = validateConstraints('cp -r src/ dest/', workdir, rule)
      expect(deniedRecursive.valid).toBe(false)
    })

    test('mixed constraint formats work together', () => {
      const rule: PermissionPattern = {
        pattern: 'find*',
        decision: 'allow',
        constraints: [
          {
            type: 'cwd_only',
            exclude: ['node_modules', '.git'],
          },
          {
            type: 'max_depth',
            value: 10,
          },
        ],
      }

      // Both pass
      const allowed = validateConstraints('find . -maxdepth 5 -name "*.ts"', workdir, rule)
      expect(allowed.valid).toBe(true)

      // max_depth fails
      const deniedDepth = validateConstraints('find . -maxdepth 20 -name "*.ts"', workdir, rule)
      expect(deniedDepth.valid).toBe(false)

      // cwd_only exclude fails
      const deniedExclude = validateConstraints(
        'find node_modules -maxdepth 5 -name "*.js"',
        workdir,
        rule
      )
      expect(deniedExclude.valid).toBe(false)
    })
  })

  describe('error handling', () => {
    test('errors on unknown constraint type', () => {
      const rule: PermissionPattern = {
        pattern: 'test*',
        decision: 'allow',
        constraints: ['unknown_constraint' as any],
      }
      const result = validateConstraints('test cmd', workdir, rule)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Unknown constraint type')
    })

    test('errors on max_depth without value', () => {
      const rule: PermissionPattern = {
        pattern: 'find*',
        decision: 'allow',
        constraints: ['max_depth'], // String shorthand doesn't work for max_depth
      }
      const result = validateConstraints('find . -maxdepth 5 -name "*.ts"', workdir, rule)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain("requires a 'value' parameter")
    })

    test('errors on require_flag without flag', () => {
      const rule: PermissionPattern = {
        pattern: 'rsync*',
        decision: 'allow',
        constraints: ['require_flag'], // String shorthand doesn't work
      }
      const result = validateConstraints('rsync src/ dest/', workdir, rule)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain("requires a 'flag' parameter")
    })
  })
})
