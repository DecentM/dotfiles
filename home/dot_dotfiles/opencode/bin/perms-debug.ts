#!/usr/bin/env bun
import { resolve } from 'node:path'

import type { ConstraintResult, MatchResultWithTrace } from '../lib/permissions'
import {
  createPatternMatcherWithTrace,
  createPermissionLoader,
  simplePatternToRegex,
} from '../lib/permissions'
import type { ConstraintConfig, PermissionPattern } from '../tools/sh/types'
import { validateConstraints, validateYamlConfig } from '../tools/sh/validators'

interface FormatOptions {
  workdir: string
  finalDecision: 'allow' | 'deny'
  hasConstraints: boolean
  constraintResult?: ConstraintResult
}

const COLOUR_SUCCESS = '\x1b[32m'
const COLOUR_FAILURE = '\x1b[31m'
const COLOUR_RESET = '\x1b[0m'

const ICON_CROSS = '\u2717'
const ICON_CHECK = '\u2713'

const colour = (colour: string, input: string) => {
  return `${colour}${input}${COLOUR_RESET}`
}

const formatTrace = (
  input: string,
  result: MatchResultWithTrace<ConstraintConfig>,
  options: FormatOptions
): string => {
  const lines: string[] = []

  lines.push(`Input: ${input}`)
  lines.push(`Working directory: ${options.workdir}`)
  lines.push('-'.repeat(80))
  lines.push('')
  lines.push('Trace (patterns checked in order):')
  lines.push('-'.repeat(80))

  for (const entry of result.trace) {
    if (!entry.matched) continue

    const matchLabel = entry.matched ? '[MATCH]' : '[     ]'
    lines.push(`${matchLabel} #${String(entry.index).padStart(3, '0')} ${entry.pattern}`)
    lines.push(
      `         regex: /${entry.compiledRegex.source}/${entry.compiledRegex.flags} -> ${entry.decision.toUpperCase()}`
    )

    if (entry.reason) {
      lines.push(`         reason: ${entry.reason}`)
    }
  }

  // If no matches were found, show default behavior
  if (!result.trace.some((e) => e.matched)) {
    lines.push('  (no patterns matched - using default)')
  }

  lines.push('')

  // Show constraint validation results if applicable
  if (options.hasConstraints) {
    lines.push('Constraint validation:')

    if (options.constraintResult) {
      if (options.constraintResult.valid) {
        lines.push(colour(COLOUR_SUCCESS, `  ${ICON_CHECK} All constraints passed`))
      } else {
        lines.push(colour(COLOUR_FAILURE, `  ${ICON_CROSS} ${options.constraintResult.violation}`))
      }
    }
    lines.push('')
  }

  // Final result
  lines.push('Result:')
  lines.push('-'.repeat(80))

  const verdictColor = options.finalDecision === 'allow' ? COLOUR_SUCCESS : COLOUR_FAILURE

  if (result.pattern) {
    lines.push(`Matched: ${result.pattern}`)
  } else {
    lines.push('Matched: (default rule)')
  }

  lines.push(`Decision: ${colour(verdictColor, options.finalDecision.toUpperCase())}`)
  if (result.reason) {
    lines.push(`Reason: ${result.reason}`)
  }

  return lines.join('\n')
}

const parseArgs = (
  args: string[]
): {
  yamlPath: string
  pattern: string
  workdir: string
  showHelp: boolean
} => {
  let workdir = process.cwd()
  let yamlPath = ''
  const patternParts: string[] = []
  let showHelp = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--help' || arg === '-h') {
      showHelp = true
      continue
    }

    if (arg === '--workdir' || arg === '-w') {
      const nextArg = args[i + 1]
      if (nextArg) {
        workdir = resolve(nextArg)
        i++ // Skip next arg
      }
      continue
    }

    // First non-option arg is yaml path
    if (!yamlPath) {
      yamlPath = arg
    } else {
      // Rest is the pattern
      patternParts.push(arg)
    }
  }

  return {
    yamlPath,
    pattern: patternParts.join(' '),
    workdir,
    showHelp,
  }
}

const printUsage = (): void => {
  console.log(`
Usage: bun bin/perms-debug.ts [options] <permissions-yaml> <pattern-to-test>

Options:
  -w, --workdir <path>   Working directory for constraint validation (default: cwd)
  -h, --help             Show this help message

Arguments:
  permissions-yaml   Path to the YAML permissions file
  pattern-to-test    The command/pattern string to test against permissions

Examples:
  bin/perms-debug.ts tools/sh-permissions.yaml "rm -rf /"
  bin/perms-debug.ts tools/sh-permissions.yaml "ls -la"
  bin/perms-debug.ts -w /home/user/project tools/sh-permissions.yaml "find . -maxdepth 5"
  bin/perms-debug.ts tools/docker/docker-permissions.yaml "container:create:node:20"

Exit codes:
  0  Command would be ALLOWED
  1  Command would be DENIED
  2  Error (invalid args, missing file, etc.)
`)
}

const main = (): void => {
  const args = process.argv.slice(2)
  const parsed = parseArgs(args)

  if (parsed.showHelp || !parsed.yamlPath || !parsed.pattern) {
    printUsage()
    process.exit(parsed.showHelp ? 0 : 1)
  }

  try {
    const absolutePath = resolve(process.cwd(), parsed.yamlPath)

    // Create a loader for the permissions file
    const getPermissions = createPermissionLoader<ConstraintConfig>({
      yamlPath: absolutePath,
      patternToRegex: simplePatternToRegex,
      validateConfig: validateYamlConfig,
      logPrefix: '[perms-debug]',
    })

    // Create a matcher with trace
    const matchWithTrace = createPatternMatcherWithTrace(getPermissions)

    // Match and get trace
    const result = matchWithTrace(parsed.pattern)

    // Determine if we need to validate constraints
    let constraintResult: ConstraintResult | undefined
    let finalDecision = result.decision
    const hasConstraints =
      !!(result.decision === 'allow' && result.rule?.constraints && result.rule.constraints.length > 0)

    if (hasConstraints && result.rule) {
      // Validate constraints using the sh tool's validator
      constraintResult = validateConstraints(
        parsed.pattern,
        parsed.workdir,
        result.rule as PermissionPattern
      )

      // If constraints fail, override decision to deny
      if (!constraintResult.valid) {
        finalDecision = 'deny'
      }
    }

    console.log(
      formatTrace(parsed.pattern, result, {
        workdir: parsed.workdir,
        constraintResult,
        finalDecision,
        hasConstraints,
      })
    )

    process.exit(finalDecision === 'allow' ? 0 : 1)
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`)
    } else {
      console.error('An unknown error occurred')
    }
    process.exit(2)
  }
}

main()
