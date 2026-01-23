import path from 'node:path'
import { tool } from '@opencode-ai/plugin'

// Import for internal use
import { matchCommand, validateConstraints } from './sh/index'

export default tool({
  description: `Execute shell commands`,
  args: {
    command: tool.schema.string().describe('The shell command to execute (use relative paths)'),
    workdir: tool.schema.string().describe('Working directory for command execution'),
    timeout: tool.schema.number().describe('Timeout in milliseconds'),
  },
  async execute(args) {
    const { command, workdir, timeout } = args

    // Check permissions
    const match = matchCommand(command)

    if (match.decision === 'deny') {
      // Standardized error format
      const reason = match.reason ?? 'Command not in allowlist'
      const patternInfo = match.pattern ? `\nPattern: ${match.pattern}` : ''
      return `Error: Command denied\nReason: ${reason}${patternInfo}\n\nCommand: ${command}`
    }

    // Check constraints for allowed commands
    if (match.rule) {
      const effectiveWorkdir = workdir ?? process.cwd()
      const relative = path.relative(process.cwd(), effectiveWorkdir)
      const isSubdir = relative && !relative.startsWith('..') && !path.isAbsolute(relative)

      if (!isSubdir && effectiveWorkdir !== process.cwd()) {
        return `Error: workdir must be under ${process.cwd()}`
      }

      const constraintResult = validateConstraints(command, effectiveWorkdir, match.rule)

      if (!constraintResult.valid) {
        // Standardized error format - violation message already includes "Command denied:"
        const reasonInfo = match.reason ? `\nReason: ${match.reason}` : ''
        return `Error: ${constraintResult.violation}\nPattern: ${match.pattern}${reasonInfo}\n\nCommand: ${command}`
      }
    }

    try {
      // Execute the command
      const proc = Bun.spawn(['sh', '-c', command], {
        cwd: workdir ?? process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
      })

      /**
       * Terminate process with signal escalation.
       * Tries SIGTERM first, then SIGKILL after grace period.
       */
      const terminateProcess = async (): Promise<void> => {
        try {
          // First attempt: SIGTERM (graceful)
          proc.kill('SIGTERM')

          // Wait briefly for graceful shutdown
          const gracePeriod = 1000 // 1 second
          const exited = await Promise.race([
            proc.exited.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), gracePeriod)),
          ])

          // If still running, escalate to SIGKILL
          if (!exited) {
            try {
              proc.kill('SIGKILL')
            } catch {
              // Process may have exited between check and kill
            }
          }
        } catch {
          // Process may have already exited
        }
      }

      // Handle timeout with proper cleanup
      let timedOut = false
      const timeoutId = setTimeout(() => {
        timedOut = true
        terminateProcess()
      }, timeout)

      // Wait for completion
      const exitCode = await proc.exited
      clearTimeout(timeoutId)

      // Read output
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()

      // Handle timeout case
      if (timedOut) {
        return `Error: Command timed out after ${timeout}ms and was terminated\n\nCommand: ${command}`
      }

      // Format output
      let output = ''
      if (stdout.trim()) {
        output += stdout
      }
      if (stderr.trim()) {
        if (output) output += '\n'
        output += `[stderr]\n${stderr}`
      }

      // Truncate if too long
      const MAX_OUTPUT = 50 * 1024 // 50KB
      if (output.length > MAX_OUTPUT) {
        output = output.substring(0, MAX_OUTPUT) + `\n...[truncated, ${output.length} bytes total]`
      }

      if (exitCode !== 0) {
        output = `Command exited with code ${exitCode}\n${output}`
      }

      return output || '(no output)'
    } catch (error) {
      return `Error: Command execution failed: ${error instanceof Error ? error.message : String(error)}\n\nCommand: ${command}`
    }
  },
})
