# Credential Sharing Platform — Design Spec

**Date:** 2026-08-09  
**Status:** Approved  
**Scope:** Cross-project credential sharing with OS keychain encryption and web dashboard

---

## Problem

OpenCode's V2 credential system stores credentials per-project in SQLite. Users working across multiple projects must re-enter the same API keys, OAuth tokens, and secrets for each project. There is no encryption at rest beyond file permissions, and no GUI for managing credentials.

## Goals

1. **Cross-project sharing** — one credential, referenced by multiple projects
2. **OS keychain encryption** — credentials encrypted at rest via Windows Credential Manager / macOS Keychain / Linux Secret Service
3. **Web dashboard** — n8n-style GUI for CRUD operations on credentials
4. **MCP auto-injection** — credentials injected as env vars into MCP servers that reference them
5. **All credential types** — API keys, OAuth2, username+password, certificates, custom key-value

## Non-Goals

- Multi-user / team sharing (single-user only for now)
- Credential rotation policies
- Audit logging
- Credential versioning / history

---

## Architecture

### Data Model

**New SQLite database:** `$XDG_DATA_HOME/opencode/credentials.db`

```sql
CREATE TABLE global_credential (
  id          TEXT PRIMARY KEY,          -- cred_xxxxx (branded ID)
  label       TEXT NOT NULL,             -- human-readable name
  type        TEXT NOT NULL,             -- 'api_key' | 'oauth' | 'username_password' | 'certificate' | 'custom'
  value       TEXT NOT NULL,             -- encrypted payload (OS keychain reference or AES-256-GCM ciphertext)
  keychain_ref TEXT,                     -- OS keychain service/item identifier
  tags        TEXT,                      -- JSON array of strings for filtering
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

CREATE TABLE project_credential_ref (
  project_path  TEXT NOT NULL,           -- absolute path to project root
  credential_id TEXT NOT NULL,           -- references global_credential.id
  env_mapping   TEXT,                    -- JSON: { "env_var_name": "field_path" }
  PRIMARY KEY (project_path, credential_id)
);
```

### Credential Value Types

Extended from existing `@opencode-ai/schema/credential`:

| Type | Fields | Description |
|------|--------|-------------|
| `api_key` | `key: string`, `metadata?: Record` | Simple API key / secret token |
| `oauth` | `methodID, refresh, access, expires, metadata?` | OAuth2 tokens (matches existing OAuth schema) |
| `username_password` | `username: string`, `password: string`, `metadata?` | Username + password pair |
| `certificate` | `cert: string`, `key?: string`, `ca?: string`, `metadata?` | PEM certificates / SSH keys |
| `custom` | `fields: Record<string, string>`, `metadata?` | Arbitrary key-value pairs |

### Encryption Flow

1. **Write path:** Caller provides plaintext value → service serializes to JSON → encrypts via OS keychain (`keytar` package) → stores ciphertext in `value` column + keychain reference in `keychain_ref`
2. **Read path:** Service fetches row → decrypts via keychain → returns plaintext to internal callers only
3. **API responses:** Credential values are masked by default (`***`). Explicit `?reveal=true` query param required to return plaintext.
4. **Fallback:** If OS keychain unavailable, falls back to AES-256-GCM with a machine-derived key stored at `$XDG_DATA_HOME/opencode/.cred-key`

### Migration

On first access after upgrade:
1. Scan all per-project SQLite databases for existing credentials
2. Encrypt and copy to global store
3. Create `project_credential_ref` entries linking original project
4. Mark original per-project credentials as migrated (don't delete — backup)
5. Log migration summary

---

## Core Service

**New file:** `packages/core/src/global-credential.ts`

```ts
export interface Interface {
  // CRUD
  readonly all: () => Effect.Effect<Info[]>
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  readonly create: (input: {
    readonly label: string
    readonly type: CredentialType
    readonly value: CredentialValue
    readonly tags?: string[]
  }) => Effect.Effect<Info>
  readonly update: (id: ID, updates: {
    readonly label?: string
    readonly value?: CredentialValue
    readonly tags?: string[]
  }) => Effect.Effect<void>
  readonly remove: (id: ID) => Effect.Effect<void>

  // Cross-project linking
  readonly link: (projectPath: string, credentialID: ID, envMapping?: Record<string, string>) => Effect.Effect<void>
  readonly unlink: (projectPath: string, credentialID: ID) => Effect.Effect<void>
  readonly linked: (projectPath: string) => Effect.Effect<Info[]>

  // MCP injection
  readonly resolveForProject: (projectPath: string) => Effect.Effect<Record<string, string>>
}
```

**Dependencies:** `Database.Service` (global), `Keychain.Service` (new, wraps `keytar`)

---

## Web Dashboard

### Location

Served at `/credentials` from the existing opencode HTTP server (Hono).

### Pages

| Route | View | Description |
|-------|------|-------------|
| `/credentials` | List | Table: label, type, tags, created date. Search/filter bar. |
| `/credentials/new` | Create | Form: label, type selector, dynamic fields per type, tag input. |
| `/credentials/:id` | Detail | Value (masked, reveal toggle), edit label/tags, delete, linked projects. |
| `/credentials/:id/link` | Link | Multi-select projects, configure env var mapping per project. |

### Tech Stack

- **SolidJS** + **TailwindCSS v4** (matches existing `packages/app/`)
- Static assets bundled into server, served as SPA
- No separate build process — integrated into existing Turborepo build

### API Endpoints

Added to `packages/protocol/src/groups/credential.ts`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/credentials` | List all global credentials |
| `POST` | `/api/credentials` | Create credential |
| `GET` | `/api/credentials/:id` | Get credential (value masked) |
| `PATCH` | `/api/credentials/:id` | Update credential |
| `DELETE` | `/api/credentials/:id` | Delete credential |
| `POST` | `/api/credentials/:id/link` | Link credential to project |
| `DELETE` | `/api/credentials/:id/link/:project` | Unlink credential from project |
| `GET` | `/api/credentials/resolve/:project` | Get env vars for MCP injection |

---

## MCP Auto-Injection

### Config Extension

Add `credential_refs` to MCP server config in `opencode.jsonc`:

```jsonc
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["node", "server.js"],
      "credential_refs": [
        {
          "id": "cred_abc123",
          "env": {
            "OPENAI_API_KEY": "key"  // maps to credential's value.key field
          }
        }
      ]
    }
  }
}
```

### Injection Flow

1. MCP server starts → `MCP.Service` reads `credential_refs` from config
2. For each ref, calls `GlobalCredential.get(ref.id)` → decrypts value
3. Maps credential fields to env var names via `ref.env` mapping
4. Merges resolved env vars into server's `environment` config
5. If OAuth token expired, attempts refresh before injection

### Security

- Credential values never logged, never stored in config files
- Env vars set only in child process, not in parent
- API responses mask values by default
- No credential data in WebSocket events or server logs

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `packages/core/src/global-credential.ts` | Core service (CRUD + linking + resolution) |
| `packages/core/src/global-credential/sql.ts` | Drizzle table definitions |
| `packages/core/src/keychain.ts` | OS keychain abstraction (keytar wrapper) |
| `packages/core/src/migration/credential-migration.ts` | One-time migration from per-project DB |
| `packages/protocol/src/groups/global-credential.ts` | API protocol definitions |
| `packages/server/src/handlers/global-credential.ts` | HTTP handlers |
| `packages/web/src/routes/credentials.tsx` | Web dashboard pages |
| `packages/web/src/components/credential-form.tsx` | Create/edit form |
| `packages/web/src/components/credential-list.tsx` | List view |
| `packages/web/src/components/credential-detail.tsx` | Detail view |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/index.ts` | Export new modules |
| `packages/server/src/api.ts` | Register new API group + handlers |
| `packages/opencode/src/mcp/index.ts` | Add credential injection on server start |
| `packages/core/src/v1/config/mcp.ts` | Add `credential_refs` to MCP config schema |
| `packages/opencode/src/config/config.ts` | Load global credentials DB on startup |
| `turbo.json` | Add web dashboard build pipeline |

---

## Implementation Order

1. **Phase 1: Core** — Global credential store + keychain encryption + migration
2. **Phase 2: API** — Protocol definitions + HTTP handlers
3. **Phase 3: Dashboard** — Web UI (SolidJS + TailwindCSS)
4. **Phase 4: MCP Integration** — Config extension + auto-injection
5. **Phase 5: Polish** — Error handling, edge cases, testing

---

## Testing

- Unit tests for encryption/decryption round-trip
- Unit tests for CRUD operations
- Unit tests for project linking/unlinking
- Integration test: create credential → link to project → resolve env vars
- E2E test: web dashboard CRUD flows
- Security test: verify values masked in API responses, never logged
