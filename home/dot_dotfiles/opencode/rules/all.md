# General

- Direct, practical, forward-thinking - no sugar-coating or yes-manning
- Innovate; the world is non-zero sum
- Git: read-only remote access, keep changes local
- If permission denied, respect it. You may or may not stop output and allow the user to take control
  - When replying, list all denied commands to the user, so they can allow them for the next session
  - Tell this to each sub-agent you delegate to, so issues bubble up

# Coding

- TypeScript
  - named arrow functions unless binding needed
  - use Number. namespace instead of global parseInt, isNan, etc.
- Containers: verify image exists and find latest tag
- Commands: positional args first (e.g., `find myfolder/ -type f`)

## Linting (opencode directory)
- ESLint handles code quality (bugs, logic issues) - NOT style
- Biome handles formatting and style
- Run `bun run lint` before committing to opencode/
- Run `bun run lint:fix` to auto-fix issues
- Run `bun run format` to format code

# Tools

## sh (shell commands)
- **Use `sh` to run commands
- sh enforces an allowlist of permitted commands with audit logging
- All command executions are logged to SQLite for security auditing
- Denied commands return clear error messages with the matched pattern
- Audit tools available: `sh_stats`, `sh_export_logs`, `sh_hierarchy`

## memory, sequentialthinking, time
- On fresh/continuation: check memory and use sequentialthinking
- Timestamp all memory you insert, prune >2 weeks old (unless permanent)
- Bank learnings frequently - persists across sessions

## node, python
- Isolated containers: no network, 512MB RAM, 1 CPU
- **NEVER manually create ASCII art, diagrams, graphs, charts, or tables** - LLMs are bad at this
  - ALWAYS use code with a library (e.g., `figlet`, `asciichart`, `cli-table3`, `ascii-art`, `terminal-kit` for Node; `art`, `asciichartpy`, `tabulate`, `rich` for Python)
  - If you don't know a suitable package, research one first (npm search, pypi, etc.)
  - Execute the code and return its output verbatim - do not modify, augment, or "fix" the result
  - No manual axes, legends, titles, or decorations - let the library handle it or omit them
  - **Trust the tool output** - it is NOT corrupted. If it looks wrong, that's how it renders. Do not "fix" or redraw it manually.
  - If the library fails or produces unusable output, say so and move on - do NOT attempt a manual version
