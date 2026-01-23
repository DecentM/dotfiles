/**
 * Tests for the docker validators module.
 * Tests constraint validation functions.
 */

import { describe, test, expect } from 'bun:test'
import {
  patternToRegex,
  matchesAnyPattern,
  validateNoPrivileged,
  validateNoHostNetwork,
  validateAllowedMounts,
  validateImagePattern,
  validateContainerPattern,
  validateResourceLimits,
  validateConstraints,
  validateConstraint,
  validateYamlRule,
  validateYamlConfig,
} from './validators'
import type { ContainerConfig, PermissionPattern } from './types'

// =============================================================================
// patternToRegex
// =============================================================================

describe('patternToRegex', () => {
  describe('exact matching', () => {
    test('matches exact strings', () => {
      const regex = patternToRegex('container:list')
      expect(regex.test('container:list')).toBe(true)
      expect(regex.test('container:inspect')).toBe(false)
    })

    test('requires full match (not partial)', () => {
      const regex = patternToRegex('node:20')
      expect(regex.test('node:20')).toBe(true)
      expect(regex.test('node:20-alpine')).toBe(false)
      expect(regex.test('mynode:20')).toBe(false)
    })

    test('handles empty string pattern', () => {
      const regex = patternToRegex('')
      expect(regex.test('')).toBe(true)
      expect(regex.test('anything')).toBe(false)
    })
  })

  describe('wildcard matching', () => {
    test('matches wildcard at end', () => {
      const regex = patternToRegex('container:*')
      expect(regex.test('container:list')).toBe(true)
      expect(regex.test('container:inspect')).toBe(true)
      expect(regex.test('container:create:node')).toBe(true)
      expect(regex.test('image:list')).toBe(false)
    })

    test('matches wildcard at start', () => {
      const regex = patternToRegex('*:latest')
      expect(regex.test('node:latest')).toBe(true)
      expect(regex.test('python:latest')).toBe(true)
      expect(regex.test('node:20')).toBe(false)
    })

    test('matches wildcard in middle', () => {
      const regex = patternToRegex('container:*:node')
      expect(regex.test('container:create:node')).toBe(true)
      expect(regex.test('container:start:node')).toBe(true)
      expect(regex.test('container:create:python')).toBe(false)
    })

    test('matches patterns with multiple wildcards', () => {
      const regex = patternToRegex('*:*')
      expect(regex.test('container:list')).toBe(true)
      expect(regex.test('image:pull')).toBe(true)
    })

    test('wildcard matches empty string', () => {
      const regex = patternToRegex('node:*')
      expect(regex.test('node:')).toBe(true)
    })
  })

  describe('special character escaping', () => {
    test('escapes dots', () => {
      const regex = patternToRegex('node:20.0')
      expect(regex.test('node:20.0')).toBe(true)
      expect(regex.test('node:2000')).toBe(false)
    })

    test('escapes plus signs', () => {
      const regex = patternToRegex('gcc:12+')
      expect(regex.test('gcc:12+')).toBe(true)
      expect(regex.test('gcc:122')).toBe(false)
    })

    test('escapes brackets', () => {
      const regex = patternToRegex('test[1]')
      expect(regex.test('test[1]')).toBe(true)
      expect(regex.test('test1')).toBe(false)
    })

    test('escapes parentheses', () => {
      const regex = patternToRegex('func(x)')
      expect(regex.test('func(x)')).toBe(true)
    })

    test('escapes caret and dollar', () => {
      const regex = patternToRegex('$var^')
      expect(regex.test('$var^')).toBe(true)
    })

    test('escapes curly braces', () => {
      const regex = patternToRegex('obj{key}')
      expect(regex.test('obj{key}')).toBe(true)
    })

    test('escapes pipe', () => {
      const regex = patternToRegex('a|b')
      expect(regex.test('a|b')).toBe(true)
      expect(regex.test('a')).toBe(false)
      expect(regex.test('b')).toBe(false)
    })

    test('escapes backslash', () => {
      const regex = patternToRegex('path\\file')
      expect(regex.test('path\\file')).toBe(true)
    })
  })

  describe('case insensitivity', () => {
    test('is case-insensitive', () => {
      const regex = patternToRegex('alpine:*')
      expect(regex.test('ALPINE:latest')).toBe(true)
      expect(regex.test('Alpine:3.18')).toBe(true)
      expect(regex.test('alpine:latest')).toBe(true)
    })

    test('case-insensitive for exact patterns', () => {
      const regex = patternToRegex('Node:20')
      expect(regex.test('NODE:20')).toBe(true)
      expect(regex.test('node:20')).toBe(true)
    })
  })
})

// =============================================================================
// matchesAnyPattern
// =============================================================================

describe('matchesAnyPattern', () => {
  describe('basic matching', () => {
    test('matches when any pattern matches', () => {
      const patterns = ['node:*', 'python:*', 'alpine:*']
      expect(matchesAnyPattern('node:20', patterns)).toBe(true)
      expect(matchesAnyPattern('python:3.11', patterns)).toBe(true)
      expect(matchesAnyPattern('alpine:latest', patterns)).toBe(true)
    })

    test('returns false when no patterns match', () => {
      const patterns = ['node:*', 'python:*']
      expect(matchesAnyPattern('ubuntu:22.04', patterns)).toBe(false)
      expect(matchesAnyPattern('redis:7', patterns)).toBe(false)
    })

    test('matches first pattern and short-circuits', () => {
      const patterns = ['node:*', 'node:20'] // Overlapping patterns
      expect(matchesAnyPattern('node:20', patterns)).toBe(true)
    })
  })

  describe('edge cases', () => {
    test('handles empty patterns array', () => {
      expect(matchesAnyPattern('anything', [])).toBe(false)
    })

    test('handles empty value', () => {
      const patterns = ['*']
      expect(matchesAnyPattern('', patterns)).toBe(true)
    })

    test('handles single pattern', () => {
      expect(matchesAnyPattern('node:20', ['node:*'])).toBe(true)
      expect(matchesAnyPattern('python:3', ['node:*'])).toBe(false)
    })

    test('handles exact match pattern', () => {
      expect(matchesAnyPattern('node:20', ['node:20'])).toBe(true)
      expect(matchesAnyPattern('node:20-alpine', ['node:20'])).toBe(false)
    })

    test('handles patterns with special characters', () => {
      const patterns = ['gcc:12+*', 'node:20.0.*']
      expect(matchesAnyPattern('gcc:12+deb', patterns)).toBe(true)
      expect(matchesAnyPattern('node:20.0.1', patterns)).toBe(true)
    })
  })
})

// =============================================================================
// validateNoPrivileged
// =============================================================================

describe('validateNoPrivileged', () => {
  describe('allows non-privileged containers', () => {
    test('allows explicit Privileged: false', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Privileged: false,
        },
      }
      const result = validateNoPrivileged(config)
      expect(result.valid).toBe(true)
      expect(result.violation).toBeUndefined()
    })

    test('allows containers without HostConfig', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
      }
      const result = validateNoPrivileged(config)
      expect(result.valid).toBe(true)
    })

    test('allows containers with empty HostConfig', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {},
      }
      const result = validateNoPrivileged(config)
      expect(result.valid).toBe(true)
    })

    test('allows containers with other HostConfig options', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 512 * 1024 * 1024,
          NetworkMode: 'bridge',
        },
      }
      const result = validateNoPrivileged(config)
      expect(result.valid).toBe(true)
    })
  })

  describe('denies privileged containers', () => {
    test('denies Privileged: true', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Privileged: true,
        },
      }
      const result = validateNoPrivileged(config)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Privileged containers')
      expect(result.violation).toContain('not allowed')
    })

    test('denies privileged even with other safe options', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Privileged: true,
          NetworkMode: 'bridge',
          Memory: 256 * 1024 * 1024,
        },
      }
      const result = validateNoPrivileged(config)
      expect(result.valid).toBe(false)
    })
  })
})

// =============================================================================
// validateNoHostNetwork
// =============================================================================

describe('validateNoHostNetwork', () => {
  describe('allows non-host network modes', () => {
    test('allows bridge network mode', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NetworkMode: 'bridge',
        },
      }
      const result = validateNoHostNetwork(config)
      expect(result.valid).toBe(true)
      expect(result.violation).toBeUndefined()
    })

    test('allows none network mode', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NetworkMode: 'none',
        },
      }
      const result = validateNoHostNetwork(config)
      expect(result.valid).toBe(true)
    })

    test('allows custom network', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NetworkMode: 'my-custom-network',
        },
      }
      const result = validateNoHostNetwork(config)
      expect(result.valid).toBe(true)
    })

    test('allows container network mode', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NetworkMode: 'container:abc123',
        },
      }
      const result = validateNoHostNetwork(config)
      expect(result.valid).toBe(true)
    })

    test('allows containers without NetworkMode', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
      }
      const result = validateNoHostNetwork(config)
      expect(result.valid).toBe(true)
    })

    test('allows containers with empty HostConfig', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {},
      }
      const result = validateNoHostNetwork(config)
      expect(result.valid).toBe(true)
    })
  })

  describe('denies host network mode', () => {
    test("denies exact 'host' network mode", () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NetworkMode: 'host',
        },
      }
      const result = validateNoHostNetwork(config)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Host network mode')
      expect(result.violation).toContain('not allowed')
    })

    test('denies host network even with other safe options', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NetworkMode: 'host',
          Privileged: false,
          Memory: 256 * 1024 * 1024,
        },
      }
      const result = validateNoHostNetwork(config)
      expect(result.valid).toBe(false)
    })
  })
})

// =============================================================================
// validateAllowedMounts
// =============================================================================

describe('validateAllowedMounts', () => {
  describe('allows valid mounts', () => {
    const allowedPatterns = ['/tmp/*', '/home/*/code/*', '/var/run/docker.sock']

    test('allows mounts within allowed paths', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/tmp/data:/data'],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(true)
    })

    test('allows nested paths within allowed patterns', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/tmp/deep/nested/path:/data'],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(true)
    })

    test('allows user-specific code paths', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/home/user/code/project:/app'],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(true)
    })

    test('allows exact path match', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(true)
    })

    test('allows containers without mounts', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(true)
    })

    test('allows containers with empty Binds array', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: [],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(true)
    })

    test('allows multiple valid mounts', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/tmp/a:/a', '/tmp/b:/b', '/home/user/code/app:/app'],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(true)
    })
  })

  describe('denies invalid mounts', () => {
    const allowedPatterns = ['/tmp/*', '/home/*/code/*']

    test('denies mounts outside allowed paths', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/etc/passwd:/etc/passwd:ro'],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('not in allowed paths')
      expect(result.violation).toContain('/etc/passwd')
    })

    test('denies root mount', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/:/host:ro'],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(false)
    })

    test('denies sensitive system directories', () => {
      const sensitiveBinds = ['/etc:/etc', '/var:/var', '/root:/root', '/boot:/boot']

      for (const bind of sensitiveBinds) {
        const config: ContainerConfig = {
          Image: 'alpine:latest',
          HostConfig: {
            Binds: [bind],
          },
        }
        const result = validateAllowedMounts(config, allowedPatterns)
        expect(result.valid).toBe(false)
      }
    })

    test('denies if any mount is invalid', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/tmp/valid:/valid', '/etc/invalid:/invalid'],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('/etc/invalid')
    })
  })

  describe('bind mount parsing', () => {
    const allowedPatterns = ['/tmp/*']

    test('handles bind with read-only option', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/tmp/data:/data:ro'],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(true)
    })

    test('handles bind with multiple options', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/tmp/data:/data:rw,Z'],
        },
      }
      const result = validateAllowedMounts(config, allowedPatterns)
      expect(result.valid).toBe(true)
    })

    test('correctly parses source from complex bind string', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/etc/passwd:/container/path:ro'],
        },
      }
      const result = validateAllowedMounts(config, ['/tmp/*'])
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('/etc/passwd')
    })
  })

  describe('edge cases', () => {
    test('handles empty allowed patterns array', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/tmp/data:/data'],
        },
      }
      const result = validateAllowedMounts(config, [])
      expect(result.valid).toBe(false)
    })

    test('wildcard pattern covers all paths', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Binds: ['/etc/passwd:/etc/passwd', '/root/.ssh:/ssh'],
        },
      }
      const result = validateAllowedMounts(config, ['*'])
      expect(result.valid).toBe(true)
    })
  })
})

// =============================================================================
// validateImagePattern
// =============================================================================

describe('validateImagePattern', () => {
  describe('allows matching images', () => {
    const allowedPatterns = ['node:*', 'python:*', 'opencode/*', 'alpine:3.*']

    test('allows images matching wildcard patterns', () => {
      expect(validateImagePattern('node:20', allowedPatterns).valid).toBe(true)
      expect(validateImagePattern('node:latest', allowedPatterns).valid).toBe(true)
      expect(validateImagePattern('node:20-alpine', allowedPatterns).valid).toBe(true)
    })

    test('allows images from allowed namespace', () => {
      expect(validateImagePattern('opencode/sandbox', allowedPatterns).valid).toBe(true)
      expect(validateImagePattern('opencode/python', allowedPatterns).valid).toBe(true)
    })

    test('allows images matching version patterns', () => {
      expect(validateImagePattern('alpine:3.18', allowedPatterns).valid).toBe(true)
      expect(validateImagePattern('alpine:3.19.1', allowedPatterns).valid).toBe(true)
    })

    test('allows any python version', () => {
      expect(validateImagePattern('python:3.11', allowedPatterns).valid).toBe(true)
      expect(validateImagePattern('python:3.12-slim', allowedPatterns).valid).toBe(true)
      expect(validateImagePattern('python:2.7', allowedPatterns).valid).toBe(true)
    })
  })

  describe('denies non-matching images', () => {
    const allowedPatterns = ['node:*', 'python:*', 'opencode/*']

    test('denies images not matching any pattern', () => {
      const result = validateImagePattern('ubuntu:22.04', allowedPatterns)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('not in allowed patterns')
      expect(result.violation).toContain('ubuntu:22.04')
    })

    test('denies images from different namespace', () => {
      const result = validateImagePattern('evilcorp/malware', allowedPatterns)
      expect(result.valid).toBe(false)
    })

    test('denies partial matches', () => {
      // "mynode:20" should not match "node:*"
      const result = validateImagePattern('mynode:20', allowedPatterns)
      expect(result.valid).toBe(false)
    })

    test('violation message includes allowed patterns', () => {
      const result = validateImagePattern('redis:7', allowedPatterns)
      expect(result.violation).toContain('node:*')
      expect(result.violation).toContain('python:*')
    })
  })

  describe('edge cases', () => {
    test('handles empty patterns array', () => {
      const result = validateImagePattern('node:20', [])
      expect(result.valid).toBe(false)
    })

    test('handles image with no tag', () => {
      const result = validateImagePattern('node', ['node:*'])
      // "node" doesn't have a colon, so it won't match "node:*"
      expect(result.valid).toBe(false)
    })

    test('handles image with digest', () => {
      const result = validateImagePattern('node@sha256:abc123', ['node@*'])
      expect(result.valid).toBe(true)
    })

    test('wildcard pattern matches all images', () => {
      expect(validateImagePattern('anything:latest', ['*']).valid).toBe(true)
      expect(validateImagePattern('evil/image:bad', ['*']).valid).toBe(true)
    })
  })
})

// =============================================================================
// validateContainerPattern
// =============================================================================

describe('validateContainerPattern', () => {
  describe('allows matching containers', () => {
    const allowedPatterns = ['opencode-*', 'sandbox-*', 'test-*']

    test('allows containers matching prefix patterns', () => {
      expect(validateContainerPattern('opencode-abc123', allowedPatterns).valid).toBe(true)
      expect(validateContainerPattern('sandbox-dev', allowedPatterns).valid).toBe(true)
      expect(validateContainerPattern('test-unit', allowedPatterns).valid).toBe(true)
    })

    test('allows containers with complex suffixes', () => {
      expect(validateContainerPattern('opencode-python-abc123-xyz', allowedPatterns).valid).toBe(
        true
      )
      expect(validateContainerPattern('sandbox-a-b-c', allowedPatterns).valid).toBe(true)
    })
  })

  describe('handles Docker name formatting', () => {
    const allowedPatterns = ['opencode-*']

    test('strips leading slash from container name', () => {
      expect(validateContainerPattern('/opencode-abc', allowedPatterns).valid).toBe(true)
    })

    test('handles name without leading slash', () => {
      expect(validateContainerPattern('opencode-abc', allowedPatterns).valid).toBe(true)
    })

    test('only strips leading slash, not embedded slashes', () => {
      // If the name has embedded slashes (unusual but possible)
      expect(validateContainerPattern('/opencode-a/b', allowedPatterns).valid).toBe(true)
    })
  })

  describe('denies non-matching containers', () => {
    const allowedPatterns = ['opencode-*', 'sandbox-*', 'test-*']

    test('denies containers not matching any pattern', () => {
      const result = validateContainerPattern('production-app', allowedPatterns)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('not in allowed patterns')
      expect(result.violation).toContain('production-app')
    })

    test('denies containers with similar but non-matching names', () => {
      // "myopencode-abc" should not match "opencode-*"
      const result = validateContainerPattern('myopencode-abc', allowedPatterns)
      expect(result.valid).toBe(false)
    })

    test('denies exact pattern name without suffix', () => {
      // "opencode" without dash should not match "opencode-*"
      const result = validateContainerPattern('opencode', allowedPatterns)
      expect(result.valid).toBe(false)
    })

    test('violation message includes container name and allowed patterns', () => {
      const result = validateContainerPattern('badname', allowedPatterns)
      expect(result.violation).toContain('badname')
      expect(result.violation).toContain('opencode-*')
    })
  })

  describe('edge cases', () => {
    test('handles empty patterns array', () => {
      const result = validateContainerPattern('opencode-abc', [])
      expect(result.valid).toBe(false)
    })

    test('handles empty container name', () => {
      const result = validateContainerPattern('', ['*'])
      expect(result.valid).toBe(true)
    })

    test('exact match pattern', () => {
      expect(validateContainerPattern('mycontainer', ['mycontainer']).valid).toBe(true)
      expect(validateContainerPattern('mycontainer2', ['mycontainer']).valid).toBe(false)
    })

    test('wildcard matches all containers', () => {
      expect(validateContainerPattern('anything', ['*']).valid).toBe(true)
    })
  })
})

// =============================================================================
// validateResourceLimits
// =============================================================================

describe('validateResourceLimits', () => {
  describe('memory limits', () => {
    test('allows containers within memory limits', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 256 * 1024 * 1024, // 256MB
        },
      }
      const result = validateResourceLimits(config, '512m', undefined)
      expect(result.valid).toBe(true)
    })

    test('allows containers at exact memory limit', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 512 * 1024 * 1024, // 512MB
        },
      }
      const result = validateResourceLimits(config, '512m', undefined)
      expect(result.valid).toBe(true)
    })

    test('denies containers exceeding memory limits', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 2 * 1024 * 1024 * 1024, // 2GB
        },
      }
      const result = validateResourceLimits(config, '512m', undefined)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Memory limit')
      expect(result.violation).toContain('exceeds')
    })

    test('parses various memory unit formats', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 1024 * 1024 * 1024, // 1GB
        },
      }

      // 1g should equal 1GB
      expect(validateResourceLimits(config, '1g', undefined).valid).toBe(true)
      // 1024m should equal 1GB
      expect(validateResourceLimits(config, '1024m', undefined).valid).toBe(true)
      // 500m should fail
      expect(validateResourceLimits(config, '500m', undefined).valid).toBe(false)
    })

    test('handles kilobyte limits', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 1024 * 1024, // 1MB
        },
      }
      expect(validateResourceLimits(config, '2048k', undefined).valid).toBe(true)
      expect(validateResourceLimits(config, '512k', undefined).valid).toBe(false)
    })

    test('handles terabyte limits', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 500 * 1024 * 1024 * 1024, // 500GB
        },
      }
      expect(validateResourceLimits(config, '1t', undefined).valid).toBe(true)
    })
  })

  describe('CPU limits', () => {
    test('allows containers within CPU limits', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NanoCpus: 1e9, // 1 CPU
        },
      }
      const result = validateResourceLimits(config, undefined, 2)
      expect(result.valid).toBe(true)
    })

    test('allows containers at exact CPU limit', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NanoCpus: 2e9, // 2 CPUs
        },
      }
      const result = validateResourceLimits(config, undefined, 2)
      expect(result.valid).toBe(true)
    })

    test('denies containers exceeding CPU limits', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NanoCpus: 4e9, // 4 CPUs
        },
      }
      const result = validateResourceLimits(config, undefined, 2)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('CPU limit')
      expect(result.violation).toContain('exceeds')
    })

    test('handles fractional CPU limits', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NanoCpus: 0.5e9, // 0.5 CPUs
        },
      }
      expect(validateResourceLimits(config, undefined, 1).valid).toBe(true)
      expect(validateResourceLimits(config, undefined, 0.25).valid).toBe(false)
    })
  })

  describe('combined limits', () => {
    test('validates both memory and CPU limits', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 256 * 1024 * 1024, // 256MB
          NanoCpus: 1e9, // 1 CPU
        },
      }
      expect(validateResourceLimits(config, '512m', 2).valid).toBe(true)
    })

    test('fails if memory exceeds but CPU is ok', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 1024 * 1024 * 1024, // 1GB
          NanoCpus: 1e9, // 1 CPU
        },
      }
      const result = validateResourceLimits(config, '512m', 2)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Memory')
    })

    test('fails if CPU exceeds but memory is ok', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 256 * 1024 * 1024, // 256MB
          NanoCpus: 4e9, // 4 CPUs
        },
      }
      const result = validateResourceLimits(config, '512m', 2)
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('CPU')
    })
  })

  describe('edge cases', () => {
    test('allows containers without resource config', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
      }
      const result = validateResourceLimits(config, '512m', 2)
      expect(result.valid).toBe(true)
    })

    test('allows when no limits specified', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 10 * 1024 * 1024 * 1024, // 10GB
          NanoCpus: 100e9, // 100 CPUs
        },
      }
      const result = validateResourceLimits(config, undefined, undefined)
      expect(result.valid).toBe(true)
    })

    test('allows containers with zero memory', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          Memory: 0,
        },
      }
      const result = validateResourceLimits(config, '512m', undefined)
      expect(result.valid).toBe(true)
    })

    test('allows containers with zero NanoCpus', () => {
      const config: ContainerConfig = {
        Image: 'alpine:latest',
        HostConfig: {
          NanoCpus: 0,
        },
      }
      const result = validateResourceLimits(config, undefined, 2)
      expect(result.valid).toBe(true)
    })
  })
})

// =============================================================================
// validateConstraints
// =============================================================================

describe('validateConstraints', () => {
  describe('with no constraints', () => {
    test('allows operation when rule has no constraints', () => {
      const rule: PermissionPattern = {
        pattern: 'container:list',
        decision: 'allow',
      }
      const result = validateConstraints(rule, {})
      expect(result.valid).toBe(true)
    })
  })

  describe('with single constraint (string shorthand)', () => {
    test('validates no_privileged constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'container:create:*',
        decision: 'allow',
        constraints: ['no_privileged'],
      }

      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: { Privileged: false },
        },
      })
      expect(allowed.valid).toBe(true)

      const denied = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: { Privileged: true },
        },
      })
      expect(denied.valid).toBe(false)
    })

    test('validates no_host_network constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'container:create:*',
        decision: 'allow',
        constraints: ['no_host_network'],
      }

      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: { NetworkMode: 'bridge' },
        },
      })
      expect(allowed.valid).toBe(true)

      const denied = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: { NetworkMode: 'host' },
        },
      })
      expect(denied.valid).toBe(false)
    })
  })

  describe('with single constraint (object form)', () => {
    test('validates image_pattern constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'image:pull:*',
        decision: 'allow',
        constraints: [
          {
            type: 'image_pattern',
            value: ['node:*', 'python:*'],
          },
        ],
      }

      const allowed = validateConstraints(rule, {
        imageName: 'node:20',
      })
      expect(allowed.valid).toBe(true)

      const denied = validateConstraints(rule, {
        imageName: 'ubuntu:22.04',
      })
      expect(denied.valid).toBe(false)
    })

    test('validates container_pattern constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'container:stop:*',
        decision: 'allow',
        constraints: [
          {
            type: 'container_pattern',
            value: ['opencode-*', 'sandbox-*'],
          },
        ],
      }

      const allowed = validateConstraints(rule, {
        containerName: 'opencode-abc123',
      })
      expect(allowed.valid).toBe(true)

      const denied = validateConstraints(rule, {
        containerName: 'production-app',
      })
      expect(denied.valid).toBe(false)
    })

    test('validates allowed_mounts constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'container:create:*',
        decision: 'allow',
        constraints: [
          {
            type: 'allowed_mounts',
            value: ['/tmp/*'],
          },
        ],
      }

      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: { Binds: ['/tmp/data:/data'] },
        },
      })
      expect(allowed.valid).toBe(true)

      const denied = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: { Binds: ['/etc/passwd:/etc/passwd'] },
        },
      })
      expect(denied.valid).toBe(false)
    })

    test('validates resource_limits constraint', () => {
      const rule: PermissionPattern = {
        pattern: 'container:create:*',
        decision: 'allow',
        constraints: [
          {
            type: 'resource_limits',
            max_memory: '512m',
            max_cpus: 2,
          },
        ],
      }

      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: {
            Memory: 256 * 1024 * 1024,
            NanoCpus: 1e9,
          },
        },
      })
      expect(allowed.valid).toBe(true)

      const deniedMemory = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: {
            Memory: 2 * 1024 * 1024 * 1024,
          },
        },
      })
      expect(deniedMemory.valid).toBe(false)
    })
  })

  describe('with multiple constraints', () => {
    test('all constraints must pass', () => {
      const rule: PermissionPattern = {
        pattern: 'container:create:*',
        decision: 'allow',
        constraints: ['no_privileged', 'no_host_network'],
      }

      // Both pass
      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: {
            Privileged: false,
            NetworkMode: 'bridge',
          },
        },
      })
      expect(allowed.valid).toBe(true)

      // no_privileged fails
      const deniedPrivileged = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: {
            Privileged: true,
            NetworkMode: 'bridge',
          },
        },
      })
      expect(deniedPrivileged.valid).toBe(false)

      // no_host_network fails
      const deniedNetwork = validateConstraints(rule, {
        containerConfig: {
          Image: 'alpine:latest',
          HostConfig: {
            Privileged: false,
            NetworkMode: 'host',
          },
        },
      })
      expect(deniedNetwork.valid).toBe(false)
    })

    test('mixed constraint formats work together', () => {
      const rule: PermissionPattern = {
        pattern: 'container:create:*',
        decision: 'allow',
        constraints: [
          'no_privileged',
          {
            type: 'image_pattern',
            value: ['node:*', 'python:*'],
          },
          {
            type: 'allowed_mounts',
            value: ['/tmp/*'],
          },
        ],
      }

      // All pass
      const allowed = validateConstraints(rule, {
        containerConfig: {
          Image: 'node:20',
          HostConfig: {
            Privileged: false,
            Binds: ['/tmp/data:/data'],
          },
        },
        imageName: 'node:20',
      })
      expect(allowed.valid).toBe(true)

      // Image pattern fails
      const deniedImage = validateConstraints(rule, {
        containerConfig: {
          Image: 'ubuntu:22.04',
          HostConfig: {
            Privileged: false,
            Binds: ['/tmp/data:/data'],
          },
        },
        imageName: 'ubuntu:22.04',
      })
      expect(deniedImage.valid).toBe(false)
    })
  })

  describe('error handling', () => {
    test('errors on unknown constraint type', () => {
      const rule: PermissionPattern = {
        pattern: 'test:*',
        decision: 'allow',
        constraints: ['unknown_constraint' as any],
      }
      const result = validateConstraints(rule, {})
      expect(result.valid).toBe(false)
      expect(result.violation).toContain('Unknown constraint type')
    })

    test('skips constraint when context is missing', () => {
      // no_privileged requires containerConfig
      const rule: PermissionPattern = {
        pattern: 'test:*',
        decision: 'allow',
        constraints: ['no_privileged'],
      }
      // No containerConfig provided - should pass
      const result = validateConstraints(rule, {})
      expect(result.valid).toBe(true)
    })

    test('handles empty constraints array', () => {
      const rule: PermissionPattern = {
        pattern: 'test:*',
        decision: 'allow',
        constraints: [],
      }
      const result = validateConstraints(rule, {})
      expect(result.valid).toBe(true)
    })
  })

  describe('context requirements', () => {
    test('image_pattern requires imageName in context', () => {
      const rule: PermissionPattern = {
        pattern: 'image:pull:*',
        decision: 'allow',
        constraints: [{ type: 'image_pattern', value: ['node:*'] }],
      }
      // Without imageName - passes (constraint skipped)
      expect(validateConstraints(rule, {}).valid).toBe(true)
      // With matching imageName - passes
      expect(validateConstraints(rule, { imageName: 'node:20' }).valid).toBe(true)
      // With non-matching imageName - fails
      expect(validateConstraints(rule, { imageName: 'python:3' }).valid).toBe(false)
    })

    test('container_pattern requires containerName in context', () => {
      const rule: PermissionPattern = {
        pattern: 'container:stop:*',
        decision: 'allow',
        constraints: [{ type: 'container_pattern', value: ['opencode-*'] }],
      }
      // Without containerName - passes
      expect(validateConstraints(rule, {}).valid).toBe(true)
      // With matching containerName - passes
      expect(validateConstraints(rule, { containerName: 'opencode-abc' }).valid).toBe(true)
      // With non-matching containerName - fails
      expect(validateConstraints(rule, { containerName: 'production' }).valid).toBe(false)
    })
  })
})

// =============================================================================
// validateConstraint (YAML schema validation)
// =============================================================================

describe('validateConstraint', () => {
  describe('string shorthand constraints', () => {
    test('accepts valid string constraints', () => {
      expect(validateConstraint('no_privileged', 0, 0)).toBeUndefined()
      expect(validateConstraint('no_host_network', 0, 0)).toBeUndefined()
    })

    test('rejects invalid string constraint', () => {
      const error = validateConstraint('invalid_type', 0, 0)
      expect(error).toContain('Invalid constraint type')
    })

    test('rejects string shorthand for constraints requiring values', () => {
      expect(validateConstraint('allowed_mounts', 0, 0)).toContain('requires object form')
      expect(validateConstraint('image_pattern', 0, 0)).toContain('requires object form')
      expect(validateConstraint('container_pattern', 0, 0)).toContain('requires object form')
      expect(validateConstraint('resource_limits', 0, 0)).toContain('requires object form')
    })
  })

  describe('object form constraints', () => {
    test('accepts valid no_privileged object', () => {
      expect(validateConstraint({ type: 'no_privileged' }, 0, 0)).toBeUndefined()
    })

    test('accepts valid no_host_network object', () => {
      expect(validateConstraint({ type: 'no_host_network' }, 0, 0)).toBeUndefined()
    })

    test('accepts valid allowed_mounts with value array', () => {
      const constraint = { type: 'allowed_mounts', value: ['/tmp/*', '/home/*'] }
      expect(validateConstraint(constraint, 0, 0)).toBeUndefined()
    })

    test('rejects allowed_mounts without value', () => {
      const error = validateConstraint({ type: 'allowed_mounts' }, 0, 0)
      expect(error).toContain("requires 'value' as string array")
    })

    test('rejects allowed_mounts with non-array value', () => {
      const error = validateConstraint({ type: 'allowed_mounts', value: '/tmp/*' }, 0, 0)
      expect(error).toContain("requires 'value' as string array")
    })

    test('accepts valid image_pattern with value array', () => {
      const constraint = { type: 'image_pattern', value: ['node:*', 'python:*'] }
      expect(validateConstraint(constraint, 0, 0)).toBeUndefined()
    })

    test('rejects image_pattern with non-string values', () => {
      const error = validateConstraint({ type: 'image_pattern', value: [1, 2] }, 0, 0)
      expect(error).toContain("requires 'value' as string array")
    })

    test('accepts valid container_pattern with value array', () => {
      const constraint = { type: 'container_pattern', value: ['opencode-*'] }
      expect(validateConstraint(constraint, 0, 0)).toBeUndefined()
    })

    test('accepts valid resource_limits with memory', () => {
      const constraint = { type: 'resource_limits', max_memory: '512m' }
      expect(validateConstraint(constraint, 0, 0)).toBeUndefined()
    })

    test('accepts valid resource_limits with cpus', () => {
      const constraint = { type: 'resource_limits', max_cpus: 2 }
      expect(validateConstraint(constraint, 0, 0)).toBeUndefined()
    })

    test('accepts valid resource_limits with both', () => {
      const constraint = { type: 'resource_limits', max_memory: '1g', max_cpus: 4 }
      expect(validateConstraint(constraint, 0, 0)).toBeUndefined()
    })

    test('rejects resource_limits with non-string memory', () => {
      const error = validateConstraint({ type: 'resource_limits', max_memory: 512 }, 0, 0)
      expect(error).toContain('max_memory must be a string')
    })

    test('rejects resource_limits with non-number cpus', () => {
      const error = validateConstraint({ type: 'resource_limits', max_cpus: '2' }, 0, 0)
      expect(error).toContain('max_cpus must be a number')
    })
  })

  describe('invalid constraint formats', () => {
    test('rejects null constraint', () => {
      const error = validateConstraint(null, 0, 0)
      expect(error).toContain('must be a string or object')
    })

    test('rejects number constraint', () => {
      const error = validateConstraint(123, 0, 0)
      expect(error).toContain('must be a string or object')
    })

    test('rejects object without type field', () => {
      const error = validateConstraint({ value: ['something'] }, 0, 0)
      expect(error).toContain("missing 'type' field")
    })

    test('rejects unknown object type', () => {
      const error = validateConstraint({ type: 'unknown_type' }, 0, 0)
      expect(error).toContain('Unknown constraint type')
    })
  })
})

// =============================================================================
// validateYamlRule
// =============================================================================

describe('validateYamlRule', () => {
  describe('valid rules', () => {
    test('accepts rule with pattern and decision', () => {
      const rule = { pattern: 'container:list', decision: 'allow' }
      expect(validateYamlRule(rule, 0)).toBeUndefined()
    })

    test('accepts rule with patterns array and decision', () => {
      const rule = { patterns: ['container:list', 'image:list'], decision: 'allow' }
      expect(validateYamlRule(rule, 0)).toBeUndefined()
    })

    test('accepts rule with reason', () => {
      const rule = { pattern: 'test:*', decision: 'deny', reason: 'Not allowed' }
      expect(validateYamlRule(rule, 0)).toBeUndefined()
    })

    test('accepts rule with null reason', () => {
      const rule = { pattern: 'test:*', decision: 'allow', reason: null }
      expect(validateYamlRule(rule, 0)).toBeUndefined()
    })

    test('accepts rule with constraints', () => {
      const rule = {
        pattern: 'container:create:*',
        decision: 'allow',
        constraints: ['no_privileged', { type: 'no_host_network' }],
      }
      expect(validateYamlRule(rule, 0)).toBeUndefined()
    })
  })

  describe('invalid rules', () => {
    test('rejects non-object rule', () => {
      expect(validateYamlRule('not an object', 0)).toContain('Must be an object')
      expect(validateYamlRule(null, 0)).toContain('Must be an object')
    })

    test('rejects rule without pattern or patterns', () => {
      const rule = { decision: 'allow' }
      expect(validateYamlRule(rule, 0)).toContain("Must have 'pattern'")
    })

    test('rejects rule with non-string pattern', () => {
      const rule = { pattern: 123, decision: 'allow' }
      expect(validateYamlRule(rule, 0)).toContain("Must have 'pattern'")
    })

    test('rejects rule with non-array patterns', () => {
      const rule = { patterns: 'not-array', decision: 'allow' }
      expect(validateYamlRule(rule, 0)).toContain("Must have 'pattern'")
    })

    test('rejects rule with invalid decision', () => {
      const rule = { pattern: 'test:*', decision: 'maybe' }
      expect(validateYamlRule(rule, 0)).toContain("'decision' must be 'allow' or 'deny'")
    })

    test('rejects rule with missing decision', () => {
      const rule = { pattern: 'test:*' }
      expect(validateYamlRule(rule, 0)).toContain("'decision' must be 'allow' or 'deny'")
    })

    test('rejects rule with non-string reason', () => {
      const rule = { pattern: 'test:*', decision: 'allow', reason: 123 }
      expect(validateYamlRule(rule, 0)).toContain("'reason' must be a string or null")
    })

    test('rejects rule with non-array constraints', () => {
      const rule = { pattern: 'test:*', decision: 'allow', constraints: 'not-array' }
      expect(validateYamlRule(rule, 0)).toContain("'constraints' must be an array")
    })

    test('rejects rule with invalid constraint', () => {
      const rule = {
        pattern: 'test:*',
        decision: 'allow',
        constraints: ['invalid_constraint'],
      }
      const error = validateYamlRule(rule, 0)
      expect(error).toContain('Invalid constraint type')
    })
  })
})

// =============================================================================
// validateYamlConfig
// =============================================================================

describe('validateYamlConfig', () => {
  describe('valid configs', () => {
    test('accepts minimal valid config', () => {
      const config = {
        rules: [{ pattern: 'container:list', decision: 'allow' }],
      }
      expect(validateYamlConfig(config)).toEqual([])
    })

    test('accepts config with default and default_reason', () => {
      const config = {
        rules: [{ pattern: 'container:list', decision: 'allow' }],
        default: 'deny',
        default_reason: 'Not allowed',
      }
      expect(validateYamlConfig(config)).toEqual([])
    })

    test('accepts config with multiple rules', () => {
      const config = {
        rules: [
          { pattern: 'container:list', decision: 'allow' },
          { patterns: ['image:list', 'volume:list'], decision: 'allow' },
          { pattern: '*', decision: 'deny', reason: 'Default deny' },
        ],
      }
      expect(validateYamlConfig(config)).toEqual([])
    })
  })

  describe('invalid configs', () => {
    test('rejects non-object config', () => {
      expect(validateYamlConfig('not an object')).toContain('Config must be an object')
      expect(validateYamlConfig(null)).toContain('Config must be an object')
    })

    test('rejects config without rules array', () => {
      expect(validateYamlConfig({})).toContain('Config must have a "rules" array')
      expect(validateYamlConfig({ rules: 'not-array' })).toContain(
        'Config must have a "rules" array'
      )
    })

    test('rejects config with invalid default', () => {
      const config = {
        rules: [{ pattern: 'test:*', decision: 'allow' }],
        default: 'maybe',
      }
      expect(validateYamlConfig(config)).toContain("'default' must be 'allow' or 'deny'")
    })

    test('rejects config with non-string default_reason', () => {
      const config = {
        rules: [{ pattern: 'test:*', decision: 'allow' }],
        default_reason: 123,
      }
      expect(validateYamlConfig(config)).toContain("'default_reason' must be a string")
    })

    test('collects errors from multiple invalid rules', () => {
      const config = {
        rules: [
          { decision: 'allow' }, // Missing pattern
          { pattern: 'test:*', decision: 'invalid' }, // Invalid decision
        ],
      }
      const errors = validateYamlConfig(config)
      expect(errors.length).toBe(2)
    })
  })
})
