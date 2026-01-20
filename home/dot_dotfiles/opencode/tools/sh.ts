/**
 * Custom shell execution tool with permission enforcement and auditing.
 * Replaces the built-in bash tool with:
 * - Allowlist-based command permissions
 * - SQLite audit logging
 * - Stats, export, and hierarchy tools
 */

import { tool } from "@opencode-ai/plugin";
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// =============================================================================
// Database Setup
// =============================================================================

const AUDIT_DIR = join(homedir(), ".opencode", "audit");
const DB_PATH = join(AUDIT_DIR, "commands.db");

const getDb = (() => {
  let db: Database | null = null;
  return () => {
    if (!db) {
      if (!existsSync(AUDIT_DIR)) {
        mkdirSync(AUDIT_DIR, { recursive: true });
      }
      db = new Database(DB_PATH);
      db.run(`
        CREATE TABLE IF NOT EXISTS command_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          session_id TEXT,
          message_id TEXT,
          command TEXT NOT NULL,
          workdir TEXT,
          pattern_matched TEXT,
          decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
          exit_code INTEGER,
          duration_ms INTEGER
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON command_log(timestamp)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_decision ON command_log(decision)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_command ON command_log(command)`);
    }
    return db;
  };
})();

// =============================================================================
// Permission Patterns
// =============================================================================

type Decision = "allow" | "deny";

interface PermissionPattern {
  pattern: string;
  decision: Decision;
  comment?: string;
}

// Order matters: first match wins. More specific patterns should come first.
// This is migrated from opencode.jsonc bash permissions.
const PERMISSIONS: PermissionPattern[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // Explicit denies - dangerous commands
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "python*", decision: "deny", comment: "use sandbox MCP" },
  { pattern: "node*", decision: "deny", comment: "use sandbox MCP" },
  { pattern: "rm*", decision: "deny", comment: "too dangerous" },
  { pattern: "htop*", decision: "deny", comment: "interactive, use top -bn1" },

  // Shell scripts - deny (was 'ask')
  { pattern: "*.sh", decision: "deny", comment: "shell scripts need review" },
  { pattern: "bin/*", decision: "deny", comment: "bin scripts need review" },
  { pattern: "./*", decision: "deny", comment: "relative executables need review" },

  // Containers - fallback deny, specific allows below
  { pattern: "docker*", decision: "deny" },
  { pattern: "docker-compose*", decision: "deny" },
  { pattern: "distrobox*", decision: "deny" },

  // ─────────────────────────────────────────────────────────────────────────
  // Infrastructure - kubectl
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "kubectl describe*", decision: "allow" },
  { pattern: "kubectl get*", decision: "allow" },
  { pattern: "kubectl logs*", decision: "allow" },
  { pattern: "kubectl run*", decision: "allow" },
  { pattern: "kubectl exec*", decision: "allow" },
  { pattern: "kubectl wait*", decision: "allow" },
  { pattern: "kubectl create job*", decision: "allow" },
  { pattern: "kubectl delete job*", decision: "allow" },
  { pattern: "kubectl version*", decision: "allow" },
  { pattern: "kubectl version", decision: "allow" },
  { pattern: "kubectl config view*", decision: "allow" },
  { pattern: "kubectl config get*", decision: "allow" },
  { pattern: "kubectl config current-context*", decision: "allow" },
  { pattern: "kubectl cluster-info*", decision: "allow" },
  { pattern: "kubectl api-resources*", decision: "allow" },
  { pattern: "kubectl api-versions*", decision: "allow" },
  { pattern: "kubectl explain*", decision: "allow" },
  { pattern: "kubectl top*", decision: "allow" },
  { pattern: "kubectl auth can-i*", decision: "allow" },
  { pattern: "kubectl diff*", decision: "allow" },
  { pattern: "kubectl events*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Infrastructure - helm
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "helm list*", decision: "allow" },
  { pattern: "helm status*", decision: "allow" },
  { pattern: "helm get*", decision: "allow" },
  { pattern: "helm show*", decision: "allow" },
  { pattern: "helm search*", decision: "allow" },
  { pattern: "helm repo list*", decision: "allow" },
  { pattern: "helm history*", decision: "allow" },
  { pattern: "helm template*", decision: "allow" },
  { pattern: "helm lint*", decision: "allow" },
  { pattern: "helm verify*", decision: "allow" },
  { pattern: "helm version*", decision: "allow" },
  { pattern: "helm env*", decision: "allow" },
  { pattern: "helm dependency list*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Infrastructure - terraform
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "terraform show*", decision: "allow" },
  { pattern: "terraform validate*", decision: "allow" },
  { pattern: "terraform fmt*", decision: "allow" },
  { pattern: "terraform version*", decision: "allow" },
  { pattern: "terraform output*", decision: "allow" },
  { pattern: "terraform state list*", decision: "allow" },
  { pattern: "terraform state show*", decision: "allow" },
  { pattern: "terraform providers*", decision: "allow" },
  { pattern: "terraform graph*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Shell utilities
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "true", decision: "allow" },
  { pattern: "false", decision: "allow" },
  { pattern: "grep*", decision: "allow" },
  { pattern: "sed*", decision: "allow" },
  { pattern: "uniq*", decision: "allow" },
  { pattern: "uniq", decision: "allow" },
  { pattern: "tail*", decision: "allow" },
  { pattern: "tail", decision: "allow" },
  { pattern: "head*", decision: "allow" },
  { pattern: "head", decision: "allow" },
  { pattern: "sort*", decision: "allow" },
  { pattern: "sort", decision: "allow" },
  { pattern: "awk*", decision: "allow" },
  { pattern: "cut*", decision: "allow" },
  { pattern: "wc*", decision: "allow" },
  { pattern: "wc", decision: "allow" },
  { pattern: "ping*", decision: "allow" },
  { pattern: "curl*", decision: "allow" },
  { pattern: "echo*", decision: "allow" },
  { pattern: "echo", decision: "allow" },
  { pattern: "printf*", decision: "allow" },
  { pattern: "printf", decision: "allow" },
  { pattern: "ls*", decision: "allow" },
  { pattern: "ls", decision: "allow" },
  { pattern: "paste*", decision: "allow" },
  { pattern: "column*", decision: "allow" },
  { pattern: "xargs*", decision: "allow" },
  { pattern: "find*", decision: "allow" },
  { pattern: "cat*", decision: "allow" },
  { pattern: "rg*", decision: "allow" },
  { pattern: "basename*", decision: "allow" },
  { pattern: "tree*", decision: "allow" },
  { pattern: "wget*", decision: "allow" },
  { pattern: "jq*", decision: "allow" },
  { pattern: "jq", decision: "allow" },
  { pattern: "yq*", decision: "allow" },
  { pattern: "yq", decision: "allow" },
  { pattern: "pwd", decision: "allow" },
  { pattern: "which*", decision: "allow" },
  { pattern: "sleep*", decision: "allow" },
  { pattern: "mkdir*", decision: "allow" },
  { pattern: "dirname*", decision: "allow" },
  { pattern: "touch*", decision: "allow" },
  { pattern: "cp*", decision: "allow" },
  { pattern: "cp -*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // System info - read-only
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "uname*", decision: "allow" },
  { pattern: "hostname", decision: "allow" },
  { pattern: "hostname -f", decision: "allow" },
  { pattern: "hostname -I", decision: "allow" },
  { pattern: "whoami", decision: "allow" },
  { pattern: "id", decision: "allow" },
  { pattern: "id*", decision: "allow" },
  { pattern: "groups", decision: "allow" },
  { pattern: "groups*", decision: "allow" },
  { pattern: "uptime*", decision: "allow" },
  { pattern: "free*", decision: "allow" },
  { pattern: "df*", decision: "allow" },
  { pattern: "du*", decision: "allow" },
  { pattern: "lsblk*", decision: "allow" },
  { pattern: "lscpu*", decision: "allow" },
  { pattern: "lsmem*", decision: "allow" },
  { pattern: "lspci*", decision: "allow" },
  { pattern: "lsusb*", decision: "allow" },
  { pattern: "lsmod*", decision: "allow" },
  { pattern: "lsns*", decision: "allow" },
  { pattern: "lsof*", decision: "allow" },
  { pattern: "lsipc*", decision: "allow" },
  { pattern: "lslocks*", decision: "allow" },
  { pattern: "nproc*", decision: "allow" },
  { pattern: "getconf*", decision: "allow" },
  { pattern: "arch", decision: "allow" },
  { pattern: "w", decision: "allow" },
  { pattern: "who", decision: "allow" },
  { pattern: "who*", decision: "allow" },
  { pattern: "last*", decision: "allow" },
  { pattern: "lastlog*", decision: "allow" },
  { pattern: "getent*", decision: "allow" },
  { pattern: "locale*", decision: "allow" },
  { pattern: "timedatectl", decision: "allow" },
  { pattern: "timedatectl status", decision: "allow" },
  { pattern: "timedatectl show", decision: "allow" },
  { pattern: "hostnamectl", decision: "allow" },
  { pattern: "hostnamectl status", decision: "allow" },
  { pattern: "loginctl list*", decision: "allow" },
  { pattern: "loginctl show*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Process info - read-only
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "ps*", decision: "allow" },
  { pattern: "ps", decision: "allow" },
  { pattern: "pgrep*", decision: "allow" },
  { pattern: "pidof*", decision: "allow" },
  { pattern: "top -bn1*", decision: "allow" },
  { pattern: "pstree*", decision: "allow" },
  { pattern: "fuser*", decision: "allow" },
  { pattern: "jobs", decision: "allow" },
  { pattern: "wait*", decision: "allow" },
  { pattern: "watch*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Logs and debug - read-only
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "journalctl*", decision: "allow" },
  { pattern: "dmesg*", decision: "allow" },
  { pattern: "systemctl status*", decision: "allow" },
  { pattern: "systemctl is-active*", decision: "allow" },
  { pattern: "systemctl is-enabled*", decision: "allow" },
  { pattern: "systemctl is-failed*", decision: "allow" },
  { pattern: "systemctl list-units*", decision: "allow" },
  { pattern: "systemctl list-unit-files*", decision: "allow" },
  { pattern: "systemctl list-timers*", decision: "allow" },
  { pattern: "systemctl list-sockets*", decision: "allow" },
  { pattern: "systemctl list-jobs*", decision: "allow" },
  { pattern: "systemctl list-dependencies*", decision: "allow" },
  { pattern: "systemctl show*", decision: "allow" },
  { pattern: "systemctl cat*", decision: "allow" },
  { pattern: "systemctl help*", decision: "allow" },
  { pattern: "systemctl --version", decision: "allow" },
  { pattern: "strace*", decision: "allow" },
  { pattern: "ltrace*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // File info and checksums - read-only
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "stat*", decision: "allow" },
  { pattern: "file*", decision: "allow" },
  { pattern: "readlink*", decision: "allow" },
  { pattern: "realpath*", decision: "allow" },
  { pattern: "namei*", decision: "allow" },
  { pattern: "getfacl*", decision: "allow" },
  { pattern: "lsattr*", decision: "allow" },
  { pattern: "md5sum*", decision: "allow" },
  { pattern: "sha1sum*", decision: "allow" },
  { pattern: "sha256sum*", decision: "allow" },
  { pattern: "sha512sum*", decision: "allow" },
  { pattern: "sha224sum*", decision: "allow" },
  { pattern: "sha384sum*", decision: "allow" },
  { pattern: "b2sum*", decision: "allow" },
  { pattern: "cksum*", decision: "allow" },
  { pattern: "sum*", decision: "allow" },
  { pattern: "diff*", decision: "allow" },
  { pattern: "cmp*", decision: "allow" },
  { pattern: "comm*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Text processing
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "tr*", decision: "allow" },
  { pattern: "tee*", decision: "allow" },
  { pattern: "rev*", decision: "allow" },
  { pattern: "nl*", decision: "allow" },
  { pattern: "expand*", decision: "allow" },
  { pattern: "unexpand*", decision: "allow" },
  { pattern: "fold*", decision: "allow" },
  { pattern: "fmt*", decision: "allow" },
  { pattern: "join*", decision: "allow" },
  { pattern: "split*", decision: "allow" },
  { pattern: "csplit*", decision: "allow" },
  { pattern: "colrm*", decision: "allow" },
  { pattern: "pr*", decision: "allow" },
  { pattern: "tsort*", decision: "allow" },
  { pattern: "numfmt*", decision: "allow" },
  { pattern: "base64*", decision: "allow" },
  { pattern: "base32*", decision: "allow" },
  { pattern: "od*", decision: "allow" },
  { pattern: "xxd*", decision: "allow" },
  { pattern: "hexdump*", decision: "allow" },
  { pattern: "strings*", decision: "allow" },
  { pattern: "iconv*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Network diagnostics - read-only
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "ip addr*", decision: "allow" },
  { pattern: "ip link*", decision: "allow" },
  { pattern: "ip route*", decision: "allow" },
  { pattern: "ip neigh*", decision: "allow" },
  { pattern: "ip -s*", decision: "allow" },
  { pattern: "ip a*", decision: "allow" },
  { pattern: "ip r*", decision: "allow" },
  { pattern: "ss*", decision: "allow" },
  { pattern: "netstat*", decision: "allow" },
  { pattern: "ifconfig*", decision: "allow" },
  { pattern: "route*", decision: "allow" },
  { pattern: "dig*", decision: "allow" },
  { pattern: "nslookup*", decision: "allow" },
  { pattern: "host*", decision: "allow" },
  { pattern: "traceroute*", decision: "allow" },
  { pattern: "tracepath*", decision: "allow" },
  { pattern: "mtr*", decision: "allow" },
  { pattern: "whois*", decision: "allow" },
  { pattern: "arp*", decision: "allow" },
  { pattern: "ethtool*", decision: "allow" },
  { pattern: "iwconfig*", decision: "allow" },
  { pattern: "iw*", decision: "allow" },
  { pattern: "nmcli*", decision: "allow" },
  { pattern: "resolvectl*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Archive operations - read/extract only
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "tar tf*", decision: "allow" },
  { pattern: "tar tvf*", decision: "allow" },
  { pattern: "tar xf*", decision: "allow" },
  { pattern: "tar xvf*", decision: "allow" },
  { pattern: "tar xzf*", decision: "allow" },
  { pattern: "tar xjf*", decision: "allow" },
  { pattern: "tar --list*", decision: "allow" },
  { pattern: "tar -tf*", decision: "allow" },
  { pattern: "tar -tvf*", decision: "allow" },
  { pattern: "tar -xf*", decision: "allow" },
  { pattern: "tar -xvf*", decision: "allow" },
  { pattern: "tar -xzf*", decision: "allow" },
  { pattern: "tar -xjf*", decision: "allow" },
  { pattern: "unzip*", decision: "allow" },
  { pattern: "zipinfo*", decision: "allow" },
  { pattern: "zcat*", decision: "allow" },
  { pattern: "zless*", decision: "allow" },
  { pattern: "zmore*", decision: "allow" },
  { pattern: "zgrep*", decision: "allow" },
  { pattern: "gunzip*", decision: "allow" },
  { pattern: "gzip -l*", decision: "allow" },
  { pattern: "gzip -t*", decision: "allow" },
  { pattern: "xz -l*", decision: "allow" },
  { pattern: "xz -t*", decision: "allow" },
  { pattern: "xzcat*", decision: "allow" },
  { pattern: "unxz*", decision: "allow" },
  { pattern: "bzip2 -d*", decision: "allow" },
  { pattern: "bunzip2*", decision: "allow" },
  { pattern: "bzcat*", decision: "allow" },
  { pattern: "7z l*", decision: "allow" },
  { pattern: "7z x*", decision: "allow" },
  { pattern: "7z e*", decision: "allow" },
  { pattern: "unrar*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Date, time, math utilities
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "date*", decision: "allow" },
  { pattern: "cal*", decision: "allow" },
  { pattern: "ncal*", decision: "allow" },
  { pattern: "bc*", decision: "allow" },
  { pattern: "dc*", decision: "allow" },
  { pattern: "expr*", decision: "allow" },
  { pattern: "seq*", decision: "allow" },
  { pattern: "shuf*", decision: "allow" },
  { pattern: "factor*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Environment inspection
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "env", decision: "allow" },
  { pattern: "printenv*", decision: "allow" },
  { pattern: "set", decision: "allow" },
  { pattern: "declare -p*", decision: "allow" },
  { pattern: "type*", decision: "allow" },
  { pattern: "command -v*", decision: "allow" },
  { pattern: "hash*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Man pages and help
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "man*", decision: "allow" },
  { pattern: "info*", decision: "allow" },
  { pattern: "apropos*", decision: "allow" },
  { pattern: "whatis*", decision: "allow" },
  { pattern: "tldr*", decision: "allow" },
  { pattern: "help*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Build tools
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "make*", decision: "allow" },
  { pattern: "cmake*", decision: "allow" },
  { pattern: "ninja*", decision: "allow" },
  { pattern: "meson*", decision: "allow" },
  { pattern: "autoconf*", decision: "allow" },
  { pattern: "automake*", decision: "allow" },
  { pattern: "configure*", decision: "allow" },
  { pattern: "gcc*", decision: "allow" },
  { pattern: "g++*", decision: "allow" },
  { pattern: "clang*", decision: "allow" },
  { pattern: "clang++*", decision: "allow" },
  { pattern: "cc*", decision: "allow" },
  { pattern: "c++*", decision: "allow" },
  { pattern: "ld*", decision: "allow" },
  { pattern: "ar*", decision: "allow" },
  { pattern: "nm*", decision: "allow" },
  { pattern: "objdump*", decision: "allow" },
  { pattern: "readelf*", decision: "allow" },
  { pattern: "size*", decision: "allow" },

  // Go
  { pattern: "go build*", decision: "allow" },
  { pattern: "go test*", decision: "allow" },
  { pattern: "go run*", decision: "allow" },
  { pattern: "go mod*", decision: "allow" },
  { pattern: "go fmt*", decision: "allow" },
  { pattern: "go vet*", decision: "allow" },
  { pattern: "go doc*", decision: "allow" },
  { pattern: "go list*", decision: "allow" },
  { pattern: "go env*", decision: "allow" },
  { pattern: "go version*", decision: "allow" },
  { pattern: "go generate*", decision: "allow" },
  { pattern: "go clean*", decision: "allow" },

  // Rust
  { pattern: "rustc*", decision: "allow" },
  { pattern: "rustup show*", decision: "allow" },
  { pattern: "rustup which*", decision: "allow" },
  { pattern: "rustup doc*", decision: "allow" },
  { pattern: "rustup --version", decision: "allow" },
  { pattern: "rustfmt*", decision: "allow" },
  { pattern: "rust-analyzer*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Package management - npm
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "npm info*", decision: "allow" },
  { pattern: "npm run*", decision: "allow" },
  { pattern: "npm audit*", decision: "allow" },
  { pattern: "npm search*", decision: "allow" },
  { pattern: "npm view*", decision: "allow" },
  { pattern: "npm list*", decision: "allow" },
  { pattern: "npm ls*", decision: "allow" },
  { pattern: "npm outdated*", decision: "allow" },
  { pattern: "npm explain*", decision: "allow" },
  { pattern: "npm why*", decision: "allow" },
  { pattern: "npm fund*", decision: "allow" },
  { pattern: "npm doctor*", decision: "allow" },
  { pattern: "npm prefix*", decision: "allow" },
  { pattern: "npm root*", decision: "allow" },
  { pattern: "npm bin*", decision: "allow" },
  { pattern: "npm config list*", decision: "allow" },
  { pattern: "npm config get*", decision: "allow" },
  { pattern: "npm pack*", decision: "allow" },
  { pattern: "npm version", decision: "allow" },
  { pattern: "npm help*", decision: "allow" },
  { pattern: "npm exec*", decision: "allow" },
  { pattern: "npm test*", decision: "allow" },
  { pattern: "npm start*", decision: "allow" },
  { pattern: "npm rebuild*", decision: "allow" },
  { pattern: "npm dedupe*", decision: "allow" },
  { pattern: "npm prune*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Package management - yarn
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "yarn audit*", decision: "allow" },
  { pattern: "yarn info*", decision: "allow" },
  { pattern: "yarn list*", decision: "allow" },
  { pattern: "yarn why*", decision: "allow" },
  { pattern: "yarn outdated*", decision: "allow" },
  { pattern: "yarn config list*", decision: "allow" },
  { pattern: "yarn config get*", decision: "allow" },
  { pattern: "yarn version", decision: "allow" },
  { pattern: "yarn versions", decision: "allow" },
  { pattern: "yarn cache list*", decision: "allow" },
  { pattern: "yarn workspaces list*", decision: "allow" },
  { pattern: "yarn licenses list*", decision: "allow" },
  { pattern: "yarn run*", decision: "allow" },
  { pattern: "yarn build*", decision: "allow" },
  { pattern: "yarn test*", decision: "allow" },
  { pattern: "yarn lint*", decision: "allow" },
  { pattern: "yarn start*", decision: "allow" },
  { pattern: "yarn dedupe*", decision: "allow" },
  { pattern: "yarn explain*", decision: "allow" },
  { pattern: "yarn pack*", decision: "allow" },
  { pattern: "yarn help*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Package management - pnpm
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "pnpm audit*", decision: "allow" },
  { pattern: "pnpm list*", decision: "allow" },
  { pattern: "pnpm ls*", decision: "allow" },
  { pattern: "pnpm outdated*", decision: "allow" },
  { pattern: "pnpm why*", decision: "allow" },
  { pattern: "pnpm licenses list*", decision: "allow" },
  { pattern: "pnpm run*", decision: "allow" },
  { pattern: "pnpm exec*", decision: "allow" },
  { pattern: "pnpm env list*", decision: "allow" },
  { pattern: "pnpm root*", decision: "allow" },
  { pattern: "pnpm bin*", decision: "allow" },
  { pattern: "pnpm prefix*", decision: "allow" },
  { pattern: "pnpm store status*", decision: "allow" },
  { pattern: "pnpm config list*", decision: "allow" },
  { pattern: "pnpm config get*", decision: "allow" },
  { pattern: "pnpm build", decision: "allow" },
  { pattern: "pnpm test", decision: "allow" },
  { pattern: "pnpm start", decision: "allow" },
  { pattern: "pnpm moon", decision: "allow" },
  { pattern: "pnpm dedupe*", decision: "allow" },
  { pattern: "pnpm rebuild*", decision: "allow" },
  { pattern: "pnpm prune*", decision: "allow" },
  { pattern: "pnpm pack*", decision: "allow" },
  { pattern: "pnpm help*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Package management - bun
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "bun run*", decision: "allow" },
  { pattern: "bun test*", decision: "allow" },
  { pattern: "bun build*", decision: "allow" },
  { pattern: "bun pm ls*", decision: "allow" },
  { pattern: "bun pm cache*", decision: "allow" },
  { pattern: "bun outdated*", decision: "allow" },
  { pattern: "bun --version", decision: "allow" },
  { pattern: "bun --help", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Package management - cargo
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "cargo check*", decision: "allow" },
  { pattern: "cargo build*", decision: "allow" },
  { pattern: "cargo test*", decision: "allow" },
  { pattern: "cargo run*", decision: "allow" },
  { pattern: "cargo doc*", decision: "allow" },
  { pattern: "cargo bench*", decision: "allow" },
  { pattern: "cargo tree*", decision: "allow" },
  { pattern: "cargo metadata*", decision: "allow" },
  { pattern: "cargo search*", decision: "allow" },
  { pattern: "cargo info*", decision: "allow" },
  { pattern: "cargo fetch*", decision: "allow" },
  { pattern: "cargo verify-project*", decision: "allow" },
  { pattern: "cargo locate-project*", decision: "allow" },
  { pattern: "cargo read-manifest*", decision: "allow" },
  { pattern: "cargo pkgid*", decision: "allow" },
  { pattern: "cargo generate-lockfile*", decision: "allow" },
  { pattern: "cargo clippy*", decision: "allow" },
  { pattern: "cargo fmt*", decision: "allow" },
  { pattern: "cargo audit*", decision: "allow" },
  { pattern: "cargo fix*", decision: "allow" },
  { pattern: "cargo clean*", decision: "allow" },
  { pattern: "cargo vendor*", decision: "allow" },
  { pattern: "cargo version*", decision: "allow" },
  { pattern: "cargo --version", decision: "allow" },
  { pattern: "cargo help*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Build and test tools
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "tsc*", decision: "allow" },
  { pattern: "eslint*", decision: "allow" },
  { pattern: "prettier*", decision: "allow" },
  { pattern: "jest*", decision: "allow" },
  { pattern: "vitest*", decision: "allow" },
  { pattern: "pytest*", decision: "allow" },
  { pattern: "time*", decision: "allow" },
  { pattern: "hyperfine*", decision: "allow" },
  { pattern: "perf*", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Docker - read-only and safe commands
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "docker build*", decision: "allow" },
  { pattern: "docker manifest inspect*", decision: "allow" },
  { pattern: "docker search*", decision: "allow" },
  { pattern: "docker pull*", decision: "allow" },
  { pattern: "docker logs*", decision: "allow" },
  { pattern: "docker images*", decision: "allow" },
  { pattern: "docker run*", decision: "allow" },
  { pattern: "docker ps*", decision: "allow" },
  { pattern: "docker inspect*", decision: "allow" },
  { pattern: "docker info*", decision: "allow" },
  { pattern: "docker info", decision: "allow" },
  { pattern: "docker version*", decision: "allow" },
  { pattern: "docker version", decision: "allow" },
  { pattern: "docker stats*", decision: "allow" },
  { pattern: "docker top*", decision: "allow" },
  { pattern: "docker port*", decision: "allow" },
  { pattern: "docker diff*", decision: "allow" },
  { pattern: "docker history*", decision: "allow" },
  { pattern: "docker events*", decision: "allow" },
  { pattern: "docker cp*", decision: "allow" },
  { pattern: "docker tag*", decision: "allow" },
  { pattern: "docker network ls*", decision: "allow" },
  { pattern: "docker network inspect*", decision: "allow" },
  { pattern: "docker volume ls*", decision: "allow" },
  { pattern: "docker volume inspect*", decision: "allow" },
  { pattern: "docker system df*", decision: "allow" },
  { pattern: "docker system info*", decision: "allow" },
  { pattern: "docker container ls*", decision: "allow" },
  { pattern: "docker container logs*", decision: "allow" },
  { pattern: "docker container inspect*", decision: "allow" },
  { pattern: "docker image ls*", decision: "allow" },
  { pattern: "docker image inspect*", decision: "allow" },
  { pattern: "docker image history*", decision: "allow" },
  { pattern: "docker buildx*", decision: "allow" },
  { pattern: "docker context*", decision: "allow" },
  { pattern: "docker help*", decision: "allow" },
  { pattern: "docker --version", decision: "allow" },
  { pattern: "docker --help", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Docker Compose - read-only and safe commands
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "docker compose ps*", decision: "allow" },
  { pattern: "docker compose logs*", decision: "allow" },
  { pattern: "docker compose config*", decision: "allow" },
  { pattern: "docker compose top*", decision: "allow" },
  { pattern: "docker compose images*", decision: "allow" },
  { pattern: "docker compose port*", decision: "allow" },
  { pattern: "docker compose version*", decision: "allow" },
  { pattern: "docker compose ls*", decision: "allow" },
  { pattern: "docker compose --help", decision: "allow" },
  { pattern: "docker-compose ps*", decision: "allow" },
  { pattern: "docker-compose logs*", decision: "allow" },
  { pattern: "docker-compose config*", decision: "allow" },
  { pattern: "docker-compose top*", decision: "allow" },
  { pattern: "docker-compose images*", decision: "allow" },
  { pattern: "docker-compose port*", decision: "allow" },
  { pattern: "docker-compose version*", decision: "allow" },
  { pattern: "docker-compose --help", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Distrobox - read-only commands only
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "distrobox list*", decision: "allow" },
  { pattern: "distrobox ls*", decision: "allow" },
  { pattern: "distrobox version*", decision: "allow" },
  { pattern: "distrobox --help", decision: "allow" },
  { pattern: "distrobox-export --list-apps*", decision: "allow" },
  { pattern: "distrobox-export --list-binaries*", decision: "allow" },
  { pattern: "distrobox-export --help", decision: "allow" },
  { pattern: "distrobox-export --version", decision: "allow" },

  // ─────────────────────────────────────────────────────────────────────────
  // Git - version control (read-heavy, some writes)
  // ─────────────────────────────────────────────────────────────────────────
  { pattern: "git*", decision: "allow" },
];

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Convert a glob pattern to a regex.
 * Supports * as wildcard (matches any characters).
 */
const patternToRegex = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
};

interface MatchResult {
  decision: Decision;
  pattern: string | null;
  comment?: string;
}

/**
 * Find the first matching permission pattern for a command.
 */
const matchCommand = (command: string): MatchResult => {
  const trimmed = command.trim();
  
  for (const perm of PERMISSIONS) {
    const regex = patternToRegex(perm.pattern);
    if (regex.test(trimmed)) {
      return {
        decision: perm.decision,
        pattern: perm.pattern,
        comment: perm.comment,
      };
    }
  }
  
  // Default: deny if no pattern matches
  return {
    decision: "deny",
    pattern: null,
    comment: "no matching pattern found",
  };
};

// =============================================================================
// Audit Logging
// =============================================================================

interface LogEntry {
  sessionId?: string;
  messageId?: string;
  command: string;
  workdir?: string;
  patternMatched: string | null;
  decision: Decision;
  exitCode?: number;
  durationMs?: number;
}

const logCommand = (entry: LogEntry): number => {
  const db = getDb();
  const result = db.run(
    `INSERT INTO command_log 
     (session_id, message_id, command, workdir, pattern_matched, decision, exit_code, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.sessionId ?? null,
      entry.messageId ?? null,
      entry.command,
      entry.workdir ?? null,
      entry.patternMatched,
      entry.decision,
      entry.exitCode ?? null,
      entry.durationMs ?? null,
    ]
  );
  return Number(result.lastInsertRowid);
};

const updateLogEntry = (id: number, exitCode: number, durationMs: number) => {
  const db = getDb();
  db.run(
    `UPDATE command_log SET exit_code = ?, duration_ms = ? WHERE id = ?`,
    [exitCode, durationMs, id]
  );
};

// =============================================================================
// Main Shell Tool
// =============================================================================

export default tool({
  description: `Execute shell commands with permission enforcement and audit logging.
Commands are checked against an allowlist before execution.
Denied commands will return an error with the reason.`,
  args: {
    command: tool.schema.string().describe("The shell command to execute"),
    workdir: tool.schema.string().optional().describe("Working directory for command execution"),
    timeout: tool.schema.number().optional().describe("Timeout in milliseconds (default: 120000)"),
  },
  async execute(args, context) {
    const { command, workdir, timeout = 120000 } = args;
    const { sessionID, messageID } = context;
    
    // Check permissions
    const match = matchCommand(command);
    
    if (match.decision === "deny") {
      // Log the denied attempt
      logCommand({
        sessionId: sessionID,
        messageId: messageID,
        command,
        workdir,
        patternMatched: match.pattern,
        decision: "deny",
      });
      
      const reason = match.pattern
        ? `Command denied: pattern "${match.pattern}" matched${match.comment ? ` (${match.comment})` : ""}`
        : `Command denied: no matching allow pattern found`;
      
      return `Error: ${reason}\n\nCommand: ${command}`;
    }
    
    // Log the allowed attempt (will update with exit code after)
    const logId = logCommand({
      sessionId: sessionID,
      messageId: messageID,
      command,
      workdir,
      patternMatched: match.pattern,
      decision: "allow",
    });
    
    const startTime = performance.now();
    
    try {
      // Execute the command
      const proc = Bun.spawn(["sh", "-c", command], {
        cwd: workdir ?? process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      
      // Handle timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          proc.kill();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      });
      
      // Wait for completion or timeout
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);
      
      const durationMs = Math.round(performance.now() - startTime);
      
      // Read output
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      
      // Update log with results
      updateLogEntry(logId, exitCode, durationMs);
      
      // Format output
      let output = "";
      if (stdout.trim()) {
        output += stdout;
      }
      if (stderr.trim()) {
        if (output) output += "\n";
        output += `[stderr]\n${stderr}`;
      }
      
      // Truncate if too long
      const MAX_OUTPUT = 50 * 1024; // 50KB
      if (output.length > MAX_OUTPUT) {
        output = output.substring(0, MAX_OUTPUT) + `\n...[truncated, ${output.length} bytes total]`;
      }
      
      if (exitCode !== 0) {
        output = `Command exited with code ${exitCode}\n${output}`;
      }
      
      return output || "(no output)";
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime);
      updateLogEntry(logId, -1, durationMs);
      
      return `Error executing command: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

// =============================================================================
// Stats Tool
// =============================================================================

export const stats = tool({
  description: `Show statistics about shell command execution.
Displays counts of allowed/denied commands, most common patterns, etc.`,
  args: {
    since: tool.schema
      .string()
      .optional()
      .describe("Time filter: '1h', '24h', '7d', 'week', 'month', or ISO date"),
    decision: tool.schema
      .enum(["allow", "deny"])
      .optional()
      .describe("Filter by decision type"),
  },
  async execute(args) {
    const db = getDb();
    const { since, decision } = args;
    
    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | null)[] = [];
    
    if (since) {
      const sinceDate = parseSince(since);
      conditions.push("timestamp >= ?");
      params.push(sinceDate.toISOString());
    }
    
    if (decision) {
      conditions.push("decision = ?");
      params.push(decision);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    
    // Get overall stats
    const overallQuery = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) as allowed,
        SUM(CASE WHEN decision = 'deny' THEN 1 ELSE 0 END) as denied,
        AVG(CASE WHEN decision = 'allow' THEN duration_ms ELSE NULL END) as avg_duration_ms
      FROM command_log
      ${whereClause}
    `;
    
    const overall = db.query(overallQuery).get(...params) as {
      total: number;
      allowed: number;
      denied: number;
      avg_duration_ms: number | null;
    };
    
    // Get top patterns
    const patternsQuery = `
      SELECT 
        pattern_matched,
        decision,
        COUNT(*) as count
      FROM command_log
      ${whereClause}
      GROUP BY pattern_matched, decision
      ORDER BY count DESC
      LIMIT 15
    `;
    
    const patterns = db.query(patternsQuery).all(...params) as Array<{
      pattern_matched: string | null;
      decision: string;
      count: number;
    }>;
    
    // Get top commands (denied)
    const deniedQuery = `
      SELECT command, COUNT(*) as count
      FROM command_log
      WHERE decision = 'deny'
      ${since ? "AND timestamp >= ?" : ""}
      GROUP BY command
      ORDER BY count DESC
      LIMIT 10
    `;
    
    const deniedCommands = since
      ? (db.query(deniedQuery).all(parseSince(since).toISOString()) as Array<{
          command: string;
          count: number;
        }>)
      : (db.query(deniedQuery).all() as Array<{ command: string; count: number }>);
    
    // Format output
    let output = "# Shell Command Statistics\n\n";
    
    output += `## Overview\n`;
    output += `- Total commands: ${overall.total}\n`;
    output += `- Allowed: ${overall.allowed} (${((overall.allowed / overall.total) * 100 || 0).toFixed(1)}%)\n`;
    output += `- Denied: ${overall.denied} (${((overall.denied / overall.total) * 100 || 0).toFixed(1)}%)\n`;
    if (overall.avg_duration_ms !== null) {
      output += `- Avg execution time: ${overall.avg_duration_ms.toFixed(0)}ms\n`;
    }
    output += "\n";
    
    if (patterns.length > 0) {
      output += `## Top Patterns\n`;
      output += "| Pattern | Decision | Count |\n";
      output += "|---------|----------|-------|\n";
      for (const p of patterns) {
        output += `| ${p.pattern_matched ?? "(no match)"} | ${p.decision} | ${p.count} |\n`;
      }
      output += "\n";
    }
    
    if (deniedCommands.length > 0) {
      output += `## Top Denied Commands\n`;
      output += "| Command | Count |\n";
      output += "|---------|-------|\n";
      for (const c of deniedCommands) {
        const truncated = c.command.length > 60 ? c.command.substring(0, 57) + "..." : c.command;
        output += `| \`${truncated}\` | ${c.count} |\n`;
      }
    }
    
    return output;
  },
});

// =============================================================================
// Export Tool
// =============================================================================

export { stats as export_data };

export const export_logs = tool({
  description: `Export command audit logs as CSV or JSON.`,
  args: {
    format: tool.schema
      .enum(["csv", "json"])
      .optional()
      .default("csv")
      .describe("Output format"),
    since: tool.schema
      .string()
      .optional()
      .describe("Time filter: '1h', '24h', '7d', 'week', 'month', or ISO date"),
    decision: tool.schema
      .enum(["allow", "deny"])
      .optional()
      .describe("Filter by decision type"),
    limit: tool.schema
      .number()
      .optional()
      .default(1000)
      .describe("Maximum number of records"),
  },
  async execute(args) {
    const db = getDb();
    const { format = "csv", since, decision, limit = 1000 } = args;
    
    // Build query
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    
    if (since) {
      conditions.push("timestamp >= ?");
      params.push(parseSince(since).toISOString());
    }
    
    if (decision) {
      conditions.push("decision = ?");
      params.push(decision);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    
    const query = `
      SELECT timestamp, session_id, command, workdir, pattern_matched, decision, exit_code, duration_ms
      FROM command_log
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ?
    `;
    
    params.push(limit);
    
    const rows = db.query(query).all(...params) as Array<{
      timestamp: string;
      session_id: string | null;
      command: string;
      workdir: string | null;
      pattern_matched: string | null;
      decision: string;
      exit_code: number | null;
      duration_ms: number | null;
    }>;
    
    if (format === "json") {
      return JSON.stringify(rows, null, 2);
    }
    
    // CSV format
    const headers = [
      "timestamp",
      "session_id",
      "command",
      "workdir",
      "pattern_matched",
      "decision",
      "exit_code",
      "duration_ms",
    ];
    
    let csv = headers.join(",") + "\n";
    
    for (const row of rows) {
      const values = [
        row.timestamp,
        row.session_id ?? "",
        `"${row.command.replace(/"/g, '""')}"`,
        row.workdir ?? "",
        row.pattern_matched ?? "",
        row.decision,
        row.exit_code?.toString() ?? "",
        row.duration_ms?.toString() ?? "",
      ];
      csv += values.join(",") + "\n";
    }
    
    return csv;
  },
});

// =============================================================================
// Hierarchy Tool
// =============================================================================

export const hierarchy = tool({
  description: `Show command hierarchy tree with usage statistics.
Groups commands by their first words to show patterns of usage.`,
  args: {
    since: tool.schema
      .string()
      .optional()
      .describe("Time filter: '1h', '24h', '7d', 'week', 'month', or ISO date"),
    minCount: tool.schema
      .number()
      .optional()
      .default(1)
      .describe("Minimum count to display"),
  },
  async execute(args) {
    const db = getDb();
    const { since, minCount = 1 } = args;
    
    // Build query
    const conditions: string[] = [];
    const params: string[] = [];
    
    if (since) {
      conditions.push("timestamp >= ?");
      params.push(parseSince(since).toISOString());
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    
    const query = `
      SELECT command, decision
      FROM command_log
      ${whereClause}
    `;
    
    const rows = db.query(query).all(...params) as Array<{
      command: string;
      decision: string;
    }>;
    
    // Build hierarchy tree
    interface TreeNode {
      name: string;
      total: number;
      allowed: number;
      denied: number;
      children: Map<string, TreeNode>;
    }
    
    const root: TreeNode = {
      name: "root",
      total: 0,
      allowed: 0,
      denied: 0,
      children: new Map(),
    };
    
    for (const row of rows) {
      const parts = row.command.trim().split(/\s+/).slice(0, 3); // First 3 words
      let node = root;
      
      root.total++;
      if (row.decision === "allow") root.allowed++;
      else root.denied++;
      
      for (const part of parts) {
        if (!node.children.has(part)) {
          node.children.set(part, {
            name: part,
            total: 0,
            allowed: 0,
            denied: 0,
            children: new Map(),
          });
        }
        node = node.children.get(part)!;
        node.total++;
        if (row.decision === "allow") node.allowed++;
        else node.denied++;
      }
    }
    
    // Render tree
    const renderNode = (node: TreeNode, prefix: string, isLast: boolean): string => {
      if (node.total < minCount) return "";
      
      const denyRate =
        node.total > 0 ? ((node.denied / node.total) * 100).toFixed(1) : "0.0";
      
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";
      
      let line = "";
      if (node.name !== "root") {
        line = `${prefix}${connector}${node.name} (${node.total} total, ${denyRate}% denied)\n`;
      }
      
      const children = Array.from(node.children.values())
        .filter((c) => c.total >= minCount)
        .sort((a, b) => b.denied / b.total - a.denied / a.total || b.total - a.total);
      
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childIsLast = i === children.length - 1;
        line += renderNode(child, prefix + childPrefix, childIsLast);
      }
      
      return line;
    };
    
    let output = "# Command Hierarchy\n\n";
    output += `Total commands: ${root.total}\n`;
    output += `Allowed: ${root.allowed} | Denied: ${root.denied}\n\n`;
    output += "```\n";
    
    const children = Array.from(root.children.values())
      .filter((c) => c.total >= minCount)
      .sort((a, b) => b.denied / b.total - a.denied / a.total || b.total - a.total);
    
    for (let i = 0; i < children.length; i++) {
      output += renderNode(children[i], "", i === children.length - 1);
    }
    
    output += "```\n";
    
    return output;
  },
});

// =============================================================================
// Helpers
// =============================================================================

const parseSince = (since: string): Date => {
  const now = new Date();
  
  const match = since.match(/^(\d+)(h|d|w|m)$/);
  if (match) {
    const [, num, unit] = match;
    const n = parseInt(num, 10);
    switch (unit) {
      case "h":
        return new Date(now.getTime() - n * 60 * 60 * 1000);
      case "d":
        return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
      case "w":
        return new Date(now.getTime() - n * 7 * 24 * 60 * 60 * 1000);
      case "m":
        return new Date(now.getTime() - n * 30 * 24 * 60 * 60 * 1000);
    }
  }
  
  // Named periods
  switch (since.toLowerCase()) {
    case "hour":
      return new Date(now.getTime() - 60 * 60 * 1000);
    case "day":
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "week":
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "month":
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      // Try parsing as ISO date
      const parsed = new Date(since);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      // Default to 24h
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
};
