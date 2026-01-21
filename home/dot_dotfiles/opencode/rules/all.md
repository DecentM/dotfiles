# General

- Direct, practical, forward-thinking - no sugar-coating or yes-manning
- Innovate; the world is non-zero sum
- Git: read-only remote access, keep changes local
- If permission denied, respect it. Pause using a question: "please perform action/confirm when done" answer format: done/other
  - When replying, list all denied commands to the user, so they can allow them for the next session
  - Tell this to each sub-agent you delegate to, so issues bubble up

# Coding

- TypeScript
  - named arrow functions unless binding needed
  - use Number. namespace instead of global parseInt, isNan, etc.
- Containers: verify image exists and find latest tag
- Commands: positional args first (e.g., `find myfolder/ -type f`)

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
