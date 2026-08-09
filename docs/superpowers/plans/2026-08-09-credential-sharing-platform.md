# Credential Sharing Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-project credential sharing with OS keychain encryption, a web dashboard, and MCP auto-injection to OpenCode.

**Architecture:** Extend the existing V2 credential system with a global SQLite database at `$XDG_DATA_HOME/opencode/credentials.db`. Credentials are encrypted via OS keychain (keytar). A web dashboard served from the existing Hono server provides CRUD operations. MCP servers auto-inject linked credentials as env vars.

**Tech Stack:** TypeScript, Bun, Effect, Drizzle ORM, SQLite, keytar (OS keychain), SolidJS + TailwindCSS v4 (web dashboard), Hono (HTTP server)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/core/src/global-credential.ts` | Core service: CRUD, linking, resolution |
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
| `packages/core/package.json` | Add `keytar` dependency |

---

## Task 1: Keychain Abstraction

**Files:**
- Create: `packages/core/src/keychain.ts`
- Test: `packages/core/src/keychain.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/keychain.test.ts
import { describe, expect, test } from "bun:test"
import { Keychain } from "./keychain"

describe("Keychain", () => {
  test("encrypt and decrypt round-trip", async () => {
    const service = "opencode-test"
    const account = "test-credential"
    const plaintext = "my-secret-api-key-12345"

    const ref = await Keychain.setSecret(service, account, plaintext)()
    expect(ref).toBeString()

    const decrypted = await Keychain.getSecret(service, account)()
    expect(decrypted).toBe(plaintext)

    await Keychain.deleteSecret(service, account)()
  })

  test("getSecret returns undefined for missing key", async () => {
    const result = await Keychain.getSecret("opencode-test", "nonexistent")()
    expect(result).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test keychain.test.ts`
Expected: FAIL with "Keychain not defined"

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/keychain.ts
export * as Keychain from "./keychain"

import { Effect } from "effect"

let keytar: typeof import("keytar") | undefined

async function getKeytar() {
  if (!keytar) {
    try {
      keytar = await import("keytar")
    } catch {
      return undefined
    }
  }
  return keytar
}

export const setSecret = (service: string, account: string, password: string) =>
  Effect.tryPromise({
    try: async () => {
      const kt = await getKeytar()
      if (!kt) throw new Error("keytar not available")
      await kt.setPassword(service, account, password)
      return `${service}:${account}`
    },
    catch: (e) => new Error(`Failed to set secret: ${e}`),
  })

export const getSecret = (service: string, account: string) =>
  Effect.tryPromise({
    try: async () => {
      const kt = await getKeytar()
      if (!kt) return undefined
      return (await kt.getPassword(service, account)) ?? undefined
    },
    catch: () => undefined,
  })

export const deleteSecret = (service: string, account: string) =>
  Effect.tryPromise({
    try: async () => {
      const kt = await getKeytar()
      if (!kt) return
      await kt.deletePassword(service, account)
    },
    catch: (e) => new Error(`Failed to delete secret: ${e}`),
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test keychain.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/keychain.ts packages/core/src/keychain.test.ts
git commit -m "feat(core): add keychain abstraction for OS credential storage"
```

---

## Task 2: Global Credential Schema

**Files:**
- Create: `packages/core/src/global-credential/sql.ts`
- Create: `packages/core/src/global-credential.ts`
- Test: `packages/core/src/global-credential.test.ts`

- [ ] **Step 1: Write the Drizzle table definitions**

```typescript
// packages/core/src/global-credential/sql.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const GlobalCredentialTable = sqliteTable("global_credential", {
  id: text().primaryKey(),
  label: text().notNull(),
  type: text().notNull(),
  value: text().notNull(),
  keychain_ref: text(),
  tags: text(),
  ...Timestamps,
})

export const ProjectCredentialRefTable = sqliteTable("project_credential_ref", {
  project_path: text().notNull(),
  credential_id: text().notNull(),
  env_mapping: text(),
}, (t) => ({
  pk: { primaryKey: [t.project_path, t.credential_id] },
}))
```

- [ ] **Step 2: Write the credential value types**

```typescript
// packages/core/src/global-credential/types.ts
import { Schema } from "effect"
import { optional } from "@opencode-ai/schema/schema"

export const ApiKeyValue = Schema.Struct({
  type: Schema.Literal("api_key"),
  key: Schema.String,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "GlobalCredential.ApiKey" })

export interface ApiKeyValue extends Schema.Schema.Type<typeof ApiKeyValue> {}

export const OAuthValue = Schema.Struct({
  type: Schema.Literal("oauth"),
  method_id: Schema.String,
  refresh: Schema.String,
  access: Schema.String,
  expires: Schema.Number,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "GlobalCredential.OAuth" })

export interface OAuthValue extends Schema.Schema.Type<typeof OAuthValue> {}

export const UsernamePasswordValue = Schema.Struct({
  type: Schema.Literal("username_password"),
  username: Schema.String,
  password: Schema.String,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "GlobalCredential.UsernamePassword" })

export interface UsernamePasswordValue extends Schema.Schema.Type<typeof UsernamePasswordValue> {}

export const CertificateValue = Schema.Struct({
  type: Schema.Literal("certificate"),
  cert: Schema.String,
  key: optional(Schema.String),
  ca: optional(Schema.String),
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "GlobalCredential.Certificate" })

export interface CertificateValue extends Schema.Schema.Type<typeof CertificateValue> {}

export const CustomValue = Schema.Struct({
  type: Schema.Literal("custom"),
  fields: Schema.Record(Schema.String, Schema.String),
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "GlobalCredential.Custom" })

export interface CustomValue extends Schema.Schema.Type<typeof CustomValue> {}

export const CredentialValue = Schema.Union([
  ApiKeyValue,
  OAuthValue,
  UsernamePasswordValue,
  CertificateValue,
  CustomValue,
]).pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "GlobalCredential.Value" })

export type CredentialValue = Schema.Schema.Type<typeof CredentialValue>

export type CredentialType = CredentialValue["type"]
```

- [ ] **Step 3: Write the Info class**

```typescript
// packages/core/src/global-credential.ts (Info class part)
import { Schema } from "effect"
import { CredentialValue, CredentialType } from "./global-credential/types"

export const ID = Schema.String.pipe(
  Schema.brand("GlobalCredential.ID"),
  Schema.transform({
    decode: (s) => s,
    encode: (s) => s,
  }),
)
export type ID = typeof ID.Type

export class Info extends Schema.Class<Info>("GlobalCredential.Info")({
  id: ID,
  label: Schema.String,
  type: Schema.String,
  value: CredentialValue,
  tags: optional(Schema.Array(Schema.String)),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}) {}
```

- [ ] **Step 4: Write the service interface and implementation**

```typescript
// packages/core/src/global-credential.ts
export * as GlobalCredential from "./global-credential"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database/database"
import { Keychain } from "./keychain"
import { GlobalCredentialTable, ProjectCredentialRefTable } from "./global-credential/sql"
import { CredentialValue, CredentialType } from "./global-credential/types"
import { makeGlobalNode } from "./effect/app-node"

export const ID = Schema.String.pipe(
  Schema.brand("GlobalCredential.ID"),
)
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: ID,
  label: Schema.String,
  type: Schema.String,
  value: CredentialValue,
  tags: optional(Schema.Array(Schema.String)),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
})
export type Info = typeof Info.Type

export interface Interface {
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
  readonly link: (projectPath: string, credentialID: ID, envMapping?: Record<string, string>) => Effect.Effect<void>
  readonly unlink: (projectPath: string, credentialID: ID) => Effect.Effect<void>
  readonly linked: (projectPath: string) => Effect.Effect<Info[]>
  readonly resolveForProject: (projectPath: string) => Effect.Effect<Record<string, string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GlobalCredential") {}

const KEYCHAIN_SERVICE = "opencode-credentials"

function generateId(): string {
  return "cred_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const encryptValue = async (id: string, value: CredentialValue): Promise<{ encrypted: string; ref: string | null }> => {
      const json = JSON.stringify(value)
      const ref = `${KEYCHAIN_SERVICE}:${id}`
      try {
        await Effect.runPromise(Keychain.setSecret(KEYCHAIN_SERVICE, id, json))
        return { encrypted: "keychain:" + ref, ref }
      } catch {
        return { encrypted: json, ref: null }
      }
    }

    const decryptValue = async (encrypted: string, ref: string | null): Promise<CredentialValue> => {
      if (ref) {
        const json = await Effect.runPromise(Keychain.getSecret(KEYCHAIN_SERVICE, ref.replace(KEYCHAIN_SERVICE + ":", "")))
        if (json) return JSON.parse(json) as CredentialValue
      }
      return JSON.parse(encrypted) as CredentialValue
    }

    return Service.of({
      all: Effect.fn("GlobalCredential.all")(function* () {
        const rows = yield* db.select().from(GlobalCredentialTable).orderBy(asc(GlobalCredentialTable.time_created)).all().pipe(Effect.orDie)
        const results: Info[] = []
        for (const row of rows) {
          const value = yield* Effect.tryPromise({ try: () => decryptValue(row.value, row.keychain_ref), catch: () => new Error("decrypt failed") })
          results.push({
            id: row.id as ID,
            label: row.label,
            type: row.type,
            value,
            tags: row.tags ? JSON.parse(row.tags) : undefined,
            timeCreated: row.time_created,
            timeUpdated: row.time_updated,
          })
        }
        return results
      }),

      get: Effect.fn("GlobalCredential.get")(function* (id) {
        const row = yield* db.select().from(GlobalCredentialTable).where(eq(GlobalCredentialTable.id, id)).get().pipe(Effect.orDie)
        if (!row) return undefined
        const value = yield* Effect.tryPromise({ try: () => decryptValue(row.value, row.keychain_ref), catch: () => new Error("decrypt failed") })
        return {
          id: row.id as ID,
          label: row.label,
          type: row.type,
          value,
          tags: row.tags ? JSON.parse(row.tags) : undefined,
          timeCreated: row.time_created,
          timeUpdated: row.time_updated,
        }
      }),

      create: Effect.fn("GlobalCredential.create")(function* (input) {
        const id = generateId() as ID
        const { encrypted, ref } = yield* Effect.tryPromise({ try: () => encryptValue(id, input.value), catch: () => new Error("encrypt failed") })
        const now = Date.now()
        yield* db.insert(GlobalCredentialTable).values({
          id,
          label: input.label,
          type: input.type,
          value: encrypted,
          keychain_ref: ref,
          tags: input.tags ? JSON.stringify(input.tags) : null,
          time_created: now,
          time_updated: now,
        }).run().pipe(Effect.orDie)
        return {
          id,
          label: input.label,
          type: input.type,
          value: input.value,
          tags: input.tags,
          timeCreated: now,
          timeUpdated: now,
        }
      }),

      update: Effect.fn("GlobalCredential.update")(function* (id, updates) {
        const existing = yield* db.select().from(GlobalCredentialTable).where(eq(GlobalCredentialTable.id, id)).get().pipe(Effect.orDie)
        if (!existing) return
        const sets: Record<string, unknown> = { time_updated: Date.now() }
        if (updates.label) sets.label = updates.label
        if (updates.tags) sets.tags = JSON.stringify(updates.tags)
        if (updates.value) {
          const { encrypted, ref } = yield* Effect.tryPromise({ try: () => encryptValue(id, updates.value), catch: () => new Error("encrypt failed") })
          sets.value = encrypted
          sets.keychain_ref = ref
        }
        yield* db.update(GlobalCredentialTable).set(sets).where(eq(GlobalCredentialTable.id, id)).run().pipe(Effect.orDie)
      }),

      remove: Effect.fn("GlobalCredential.remove")(function* (id) {
        yield* Effect.tryPromise({ try: () => Keychain.deleteSecret(KEYCHAIN_SERVICE, id), catch: () => undefined })
        yield* db.delete(ProjectCredentialRefTable).where(eq(ProjectCredentialRefTable.credential_id, id)).run().pipe(Effect.orDie)
        yield* db.delete(GlobalCredentialTable).where(eq(GlobalCredentialTable.id, id)).run().pipe(Effect.orDie)
      }),

      link: Effect.fn("GlobalCredential.link")(function* (projectPath, credentialID, envMapping) {
        yield* db.insert(ProjectCredentialRefTable).values({
          project_path: projectPath,
          credential_id: credentialID,
          env_mapping: envMapping ? JSON.stringify(envMapping) : null,
        }).onConflictDoUpdate({
          target: [ProjectCredentialRefTable.project_path, ProjectCredentialRefTable.credential_id],
          set: { env_mapping: envMapping ? JSON.stringify(envMapping) : null },
        }).run().pipe(Effect.orDie)
      }),

      unlink: Effect.fn("GlobalCredential.unlink")(function* (projectPath, credentialID) {
        yield* db.delete(ProjectCredentialRefTable)
          .where(eq(ProjectCredentialRefTable.project_path, projectPath))
          .where(eq(ProjectCredentialRefTable.credential_id, credentialID))
          .run().pipe(Effect.orDie)
      }),

      linked: Effect.fn("GlobalCredential.linked")(function* (projectPath) {
        const refs = yield* db.select().from(ProjectCredentialRefTable)
          .where(eq(ProjectCredentialRefTable.project_path, projectPath))
          .all().pipe(Effect.orDie)
        const results: Info[] = []
        for (const ref of refs) {
          const cred = yield* Service.get(ref.credential_id as ID)
          if (cred) results.push(cred)
        }
        return results
      }),

      resolveForProject: Effect.fn("GlobalCredential.resolveForProject")(function* (projectPath) {
        const refs = yield* db.select().from(ProjectCredentialRefTable)
          .where(eq(ProjectCredentialRefTable.project_path, projectPath))
          .all().pipe(Effect.orDie)
        const env: Record<string, string> = {}
        for (const ref of refs) {
          const cred = yield* Service.get(ref.credential_id as ID)
          if (!cred) continue
          const mapping = ref.env_mapping ? JSON.parse(ref.env_mapping) as Record<string, string> : {}
          for (const [envKey, fieldPath] of Object.entries(mapping)) {
            const value = extractField(cred.value, fieldPath)
            if (value !== undefined) env[envKey] = value
          }
        }
        return env
      }),
    })
  }),
)

function extractField(value: CredentialValue, fieldPath: string): string | undefined {
  if (fieldPath === "key" && value.type === "api_key") return value.key
  if (fieldPath === "access" && value.type === "oauth") return value.access
  if (fieldPath === "password" && value.type === "username_password") return value.password
  if (fieldPath === "username" && value.type === "username_password") return value.username
  if (fieldPath === "cert" && value.type === "certificate") return value.cert
  if (value.type === "custom" && fieldPath in value.fields) return value.fields[fieldPath]
  return undefined
}

export const optional = <A>(schema: Schema.Schema<A>): Schema.Schema<A | undefined> =>
  Schema.optional(schema)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
```

- [ ] **Step 5: Write the test**

```typescript
// packages/core/src/global-credential.test.ts
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { GlobalCredential } from "./global-credential"

describe("GlobalCredential", () => {
  test("create and get credential", async () => {
    const cred = await Effect.runPromise(
      GlobalCredential.Service.create({
        label: "Test API Key",
        type: "api_key",
        value: { type: "api_key", key: "sk-test-12345" },
        tags: ["test"],
      })
    )

    expect(cred.id).toStartWith("cred_")
    expect(cred.label).toBe("Test API Key")
    expect(cred.type).toBe("api_key")
    expect(cred.value).toEqual({ type: "api_key", key: "sk-test-12345" })

    const fetched = await Effect.runPromise(GlobalCredential.Service.get(cred.id))
    expect(fetched).toBeDefined()
    expect(fetched?.value).toEqual({ type: "api_key", key: "sk-test-12345" })

    await Effect.runPromise(GlobalCredential.Service.remove(cred.id))
  })

  test("link and resolve credential", async () => {
    const cred = await Effect.runPromise(
      GlobalCredential.Service.create({
        label: "GitHub Token",
        type: "api_key",
        value: { type: "api_key", key: "ghp_test123" },
      })
    )

    await Effect.runPromise(
      GlobalCredential.Service.link("/test/project", cred.id, { GITHUB_TOKEN: "key" })
    )

    const linked = await Effect.runPromise(GlobalCredential.Service.linked("/test/project"))
    expect(linked.length).toBe(1)

    const env = await Effect.runPromise(GlobalCredential.Service.resolveForProject("/test/project"))
    expect(env.GITHUB_TOKEN).toBe("ghp_test123")

    await Effect.runPromise(GlobalCredential.Service.unlink("/test/project", cred.id))
    await Effect.runPromise(GlobalCredential.Service.remove(cred.id))
  })
})
```

- [ ] **Step 6: Run tests**

Run: `cd packages/core && bun test global-credential.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/global-credential/ packages/core/src/global-credential.ts packages/core/src/global-credential.test.ts
git commit -m "feat(core): add GlobalCredential service with keychain encryption"
```

---

## Task 3: Migration from Per-Project DB

**Files:**
- Create: `packages/core/src/migration/credential-migration.ts`
- Test: `packages/core/src/migration/credential-migration.test.ts`

- [ ] **Step 1: Write the migration service**

```typescript
// packages/core/src/migration/credential-migration.ts
export * as CredentialMigration from "./credential-migration"

import { Effect } from "effect"
import { Global } from "../global"
import { GlobalCredential } from "../global-credential"
import { Credential } from "@opencode-ai/schema/credential"
import fs from "fs/promises"
import path from "path"

export interface MigrationResult {
  migrated: number
  skipped: number
  errors: string[]
}

export const migrate = Effect.fn("CredentialMigration.migrate")(function* () {
  const dataDir = Global.Path.data
  const projectsDir = path.join(dataDir, "projects")
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: [] }

  const exists = yield* Effect.tryPromise({
    try: async () => {
      try {
        await fs.access(projectsDir)
        return true
      } catch {
        return false
      }
    },
    catch: () => false,
  })

  if (!exists) return result

  const projects = yield* Effect.tryPromise({
    try: () => fs.readdir(projectsDir),
    catch: () => new Error("Failed to read projects dir"),
  })

  for (const project of projects) {
    const dbPath = path.join(projectsDir, project, "opencode.db")
    const dbExists = yield* Effect.tryPromise({
      try: async () => {
        try {
          await fs.access(dbPath)
          return true
        } catch {
          return false
        }
      },
      catch: () => false,
    })

    if (!dbExists) continue

    try {
      const { default: Database } = await import("better-sqlite3")
      const db = new Database(dbPath, { readonly: true })
      const rows = db.prepare("SELECT * FROM credential").all() as Array<{
        id: string
        integration_id: string
        label: string
        value: string
      }>

      for (const row of rows) {
        try {
          const value = JSON.parse(row.value) as Credential.Value
          const existing = yield* GlobalCredential.Service.get(row.id as GlobalCredential.ID)
          if (existing) {
            result.skipped++
            continue
          }

          yield* GlobalCredential.Service.create({
            label: row.label,
            type: value.type === "key" ? "api_key" : "oauth",
            value: value as any,
            tags: ["migrated"],
          })

          yield* GlobalCredential.Service.link(
            path.join(dataDir, "projects", project),
            row.id as GlobalCredential.ID
          )

          result.migrated++
        } catch (e) {
          result.errors.push(`Failed to migrate ${row.id}: ${e}`)
        }
      }

      db.close()
    } catch (e) {
      result.errors.push(`Failed to open DB for ${project}: ${e}`)
    }
  }

  return result
})
```

- [ ] **Step 2: Write the test**

```typescript
// packages/core/src/migration/credential-migration.test.ts
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CredentialMigration } from "./credential-migration"

describe("CredentialMigration", () => {
  test("migrate returns result with no projects", async () => {
    const result = await Effect.runPromise(CredentialMigration.migrate())
    expect(result).toHaveProperty("migrated")
    expect(result).toHaveProperty("skipped")
    expect(result).toHaveProperty("errors")
  })
})
```

- [ ] **Step 3: Run tests**

Run: `cd packages/core && bun test migration/credential-migration.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/migration/
git commit -m "feat(core): add credential migration from per-project DB"
```

---

## Task 4: Protocol Definitions

**Files:**
- Create: `packages/protocol/src/groups/global-credential.ts`

- [ ] **Step 1: Write the protocol definitions**

```typescript
// packages/protocol/src/groups/global-credential.ts
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

const CredentialType = Schema.Literal("api_key", "oauth", "username_password", "certificate", "custom")

const CreateCredentialPayload = Schema.Struct({
  label: Schema.String,
  type: CredentialType,
  value: Schema.Unknown,
  tags: optional(Schema.Array(Schema.String)),
})

const UpdateCredentialPayload = Schema.Struct({
  label: optional(Schema.String),
  value: optional(Schema.Unknown),
  tags: optional(Schema.Array(Schema.String)),
})

const LinkCredentialPayload = Schema.Struct({
  project_path: Schema.String,
  env_mapping: optional(Schema.Record(Schema.String, Schema.String)),
})

const CredentialResponse = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  type: Schema.String,
  value: Schema.Unknown,
  tags: optional(Schema.Array(Schema.String)),
  time_created: Schema.Number,
  time_updated: Schema.Number,
})

const ResolveResponse = Schema.Record(Schema.String, Schema.String)

function optional<A>(schema: Schema.Schema<A>): Schema.Schema<A | undefined> {
  return Schema.optional(schema)
}

export const GlobalCredentialGroup = HttpApiGroup.make("server.global-credential")
  .add(
    HttpApiEndpoint.get("global-credential.list", "/api/credentials", {
      success: Schema.Array(CredentialResponse),
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.list",
          summary: "List all global credentials",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("global-credential.create", "/api/credentials", {
      payload: CreateCredentialPayload,
      success: CredentialResponse,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.create",
          summary: "Create a global credential",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("global-credential.get", "/api/credentials/:id", {
      params: { id: Schema.String },
      success: CredentialResponse,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.get",
          summary: "Get a global credential",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("global-credential.update", "/api/credentials/:id", {
      params: { id: Schema.String },
      payload: UpdateCredentialPayload,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.update",
          summary: "Update a global credential",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("global-credential.remove", "/api/credentials/:id", {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.remove",
          summary: "Delete a global credential",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("global-credential.link", "/api/credentials/:id/link", {
      params: { id: Schema.String },
      payload: LinkCredentialPayload,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.link",
          summary: "Link credential to project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("global-credential.unlink", "/api/credentials/:id/link/:project", {
      params: { id: Schema.String, project: Schema.String },
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.unlink",
          summary: "Unlink credential from project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("global-credential.resolve", "/api/credentials/resolve/:project", {
      params: { project: Schema.String },
      success: ResolveResponse,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.resolve",
          summary: "Resolve credentials for project",
        }),
      ),
  )
```

- [ ] **Step 2: Commit**

```bash
git add packages/protocol/src/groups/global-credential.ts
git commit -m "feat(protocol): add global credential API protocol definitions"
```

---

## Task 5: HTTP Handlers

**Files:**
- Create: `packages/server/src/handlers/global-credential.ts`
- Modify: `packages/server/src/api.ts`

- [ ] **Step 1: Write the handlers**

```typescript
// packages/server/src/handlers/global-credential.ts
import { GlobalCredential } from "@opencode-ai/core/global-credential"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

export const GlobalCredentialHandler = HttpApiBuilder.group(Api, "server.global-credential", (handlers) =>
  handlers
    .handle(
      "global-credential.list",
      Effect.fn(function* () {
        const creds = yield* (yield* GlobalCredential.Service).all()
        return creds.map((c) => ({
          id: c.id,
          label: c.label,
          type: c.type,
          value: { type: c.value.type },
          tags: c.tags,
          time_created: c.timeCreated,
          time_updated: c.timeUpdated,
        }))
      }),
    )
    .handle(
      "global-credential.create",
      Effect.fn(function* (ctx) {
        const cred = yield* (yield* GlobalCredential.Service).create({
          label: ctx.payload.label,
          type: ctx.payload.type as any,
          value: ctx.payload.value as any,
          tags: ctx.payload.tags,
        })
        return {
          id: cred.id,
          label: cred.label,
          type: cred.type,
          value: { type: cred.value.type },
          tags: cred.tags,
          time_created: cred.timeCreated,
          time_updated: cred.timeUpdated,
        }
      }),
    )
    .handle(
      "global-credential.get",
      Effect.fn(function* (ctx) {
        const cred = yield* (yield* GlobalCredential.Service).get(ctx.params.id as GlobalCredential.ID)
        if (!cred) return HttpApiSchema.NoContent.make()
        return {
          id: cred.id,
          label: cred.label,
          type: cred.type,
          value: { type: cred.value.type },
          tags: cred.tags,
          time_created: cred.timeCreated,
          time_updated: cred.timeUpdated,
        }
      }),
    )
    .handle(
      "global-credential.update",
      Effect.fn(function* (ctx) {
        yield* (yield* GlobalCredential.Service).update(ctx.params.id as GlobalCredential.ID, {
          label: ctx.payload.label,
          value: ctx.payload.value as any,
          tags: ctx.payload.tags,
        })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "global-credential.remove",
      Effect.fn(function* (ctx) {
        yield* (yield* GlobalCredential.Service).remove(ctx.params.id as GlobalCredential.ID)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "global-credential.link",
      Effect.fn(function* (ctx) {
        yield* (yield* GlobalCredential.Service).link(
          ctx.payload.project_path,
          ctx.params.id as GlobalCredential.ID,
          ctx.payload.env_mapping,
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "global-credential.unlink",
      Effect.fn(function* (ctx) {
        yield* (yield* GlobalCredential.Service).unlink(ctx.params.project, ctx.params.id as GlobalCredential.ID)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "global-credential.resolve",
      Effect.fn(function* (ctx) {
        return yield* (yield* GlobalCredential.Service).resolveForProject(ctx.params.project)
      }),
    ),
)
```

- [ ] **Step 2: Modify the API to include the new group**

```typescript
// packages/server/src/api.ts
// Add import at top:
import { GlobalCredentialGroup } from "@opencode-ai/protocol/groups/global-credential"

// Add to the Api definition (in the groups array or similar):
// .add(GlobalCredentialGroup)
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/handlers/global-credential.ts packages/server/src/api.ts
git commit -m "feat(server): add global credential HTTP handlers"
```

---

## Task 6: MCP Config Extension

**Files:**
- Modify: `packages/core/src/v1/config/mcp.ts`
- Modify: `packages/opencode/src/mcp/index.ts`

- [ ] **Step 1: Add credential_refs to MCP config schema**

```typescript
// packages/core/src/v1/config/mcp.ts
// Add to the local server config schema:

const CredentialRef = Schema.Struct({
  id: Schema.String,
  env: Schema.Record(Schema.String, Schema.String),
})

// Add to LocalMcpServer or similar:
// credential_refs: optional(Schema.Array(CredentialRef))
```

- [ ] **Step 2: Add injection to MCP server start**

```typescript
// packages/opencode/src/mcp/index.ts
// In the MCP server startup logic, after creating the server:

import { GlobalCredential } from "@opencode-ai/core/global-credential"

// Before starting the server:
if (config.credential_refs) {
  const env = yield* GlobalCredential.Service.resolveForProject(projectPath)
  for (const ref of config.credential_refs) {
    const resolved = yield* GlobalCredential.Service.resolveForProject(projectPath)
    Object.assign(config.environment ?? {}, resolved)
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/v1/config/mcp.ts packages/opencode/src/mcp/index.ts
git commit -m "feat(mcp): add credential_refs config and auto-injection"
```

---

## Task 7: Web Dashboard

**Files:**
- Create: `packages/web/src/routes/credentials.tsx`
- Create: `packages/web/src/components/credential-form.tsx`
- Create: `packages/web/src/components/credential-list.tsx`
- Create: `packages/web/src/components/credential-detail.tsx`

- [ ] **Step 1: Create the credentials route**

```typescript
// packages/web/src/routes/credentials.tsx
import { Route } from "wouter"
import { CredentialList } from "../components/credential-list"
import { CredentialDetail } from "../components/credential-detail"
import { CredentialForm } from "../components/credential-form"

export function CredentialsRoutes() {
  return (
    <>
      <Route path="/credentials" component={CredentialList} />
      <Route path="/credentials/new" component={CredentialForm} />
      <Route path="/credentials/:id" component={CredentialDetail} />
    </>
  )
}
```

- [ ] **Step 2: Create the credential list component**

```typescript
// packages/web/src/components/credential-list.tsx
import { createSignal, onMount } from "solid-js"

interface Credential {
  id: string
  label: string
  type: string
  tags?: string[]
  time_created: number
}

export function CredentialList() {
  const [credentials, setCredentials] = createSignal<Credential[]>([])
  const [loading, setLoading] = createSignal(true)

  onMount(async () => {
    const res = await fetch("/api/credentials")
    const data = await res.json()
    setCredentials(data)
    setLoading(false)
  })

  return (
    <div class="p-6">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">Credentials</h1>
        <a href="/credentials/new" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
          Add Credential
        </a>
      </div>
      {loading() ? (
        <div class="text-center py-8">Loading...</div>
      ) : credentials().length === 0 ? (
        <div class="text-center py-8 text-gray-500">No credentials yet. Add your first one!</div>
      ) : (
        <table class="w-full border-collapse">
          <thead>
            <tr class="border-b">
              <th class="text-left py-2">Label</th>
              <th class="text-left py-2">Type</th>
              <th class="text-left py-2">Tags</th>
              <th class="text-left py-2">Created</th>
              <th class="text-left py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {credentials().map((cred) => (
              <tr class="border-b hover:bg-gray-50">
                <td class="py-2">
                  <a href={`/credentials/${cred.id}`} class="text-blue-500 hover:underline">
                    {cred.label}
                  </a>
                </td>
                <td class="py-2">{cred.type}</td>
                <td class="py-2">
                  {cred.tags?.map((tag) => (
                    <span class="bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded mr-1">{tag}</span>
                  ))}
                </td>
                <td class="py-2">{new Date(cred.time_created).toLocaleDateString()}</td>
                <td class="py-2">
                  <a href={`/credentials/${cred.id}`} class="text-blue-500 hover:underline">View</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create the credential form component**

```typescript
// packages/web/src/components/credential-form.tsx
import { createSignal, For } from "solid-js"
import { useLocation } from "wouter"

const CREDENTIAL_TYPES = [
  { value: "api_key", label: "API Key" },
  { value: "oauth", label: "OAuth" },
  { value: "username_password", label: "Username + Password" },
  { value: "certificate", label: "Certificate" },
  { value: "custom", label: "Custom" },
]

export function CredentialForm() {
  const [, navigate] = useLocation()
  const [label, setLabel] = createSignal("")
  const [type, setType] = createSignal("api_key")
  const [key, setKey] = createSignal("")
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [cert, setCert] = createSignal("")
  const [certKey, setCertKey] = createSignal("")
  const [ca, setCa] = createSignal("")
  const [customFields, setCustomFields] = createSignal<Array<{ key: string; value: string }>>([])
  const [tags, setTags] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  function buildValue() {
    const t = type()
    if (t === "api_key") return { type: "api_key", key: key() }
    if (t === "username_password") return { type: "username_password", username: username(), password: password() }
    if (t === "certificate") return { type: "certificate", cert: cert(), key: certKey() || undefined, ca: ca() || undefined }
    if (t === "custom") {
      const fields: Record<string, string> = {}
      customFields().forEach((f) => { if (f.key) fields[f.key] = f.value })
      return { type: "custom", fields }
    }
    return { type: "oauth", method_id: "", refresh: "", access: "", expires: 0 }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setLoading(true)
    const tagList = tags().split(",").map((t) => t.trim()).filter(Boolean)
    await fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label(), type: type(), value: buildValue(), tags: tagList }),
    })
    navigate("/credentials")
  }

  return (
    <div class="p-6 max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-6">Add Credential</h1>
      <form onSubmit={handleSubmit} class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">Label</label>
          <input type="text" value={label()} onInput={(e) => setLabel(e.currentTarget.value)}
            class="w-full border rounded px-3 py-2" required />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Type</label>
          <select value={type()} onChange={(e) => setType(e.currentTarget.value)}
            class="w-full border rounded px-3 py-2">
            <For each={CREDENTIAL_TYPES}>{(t) => <option value={t.value}>{t.label}</option>}</For>
          </select>
        </div>
        {type() === "api_key" && (
          <div>
            <label class="block text-sm font-medium mb-1">API Key</label>
            <input type="password" value={key()} onInput={(e) => setKey(e.currentTarget.value)}
              class="w-full border rounded px-3 py-2" required />
          </div>
        )}
        {type() === "username_password" && (
          <>
            <div>
              <label class="block text-sm font-medium mb-1">Username</label>
              <input type="text" value={username()} onInput={(e) => setUsername(e.currentTarget.value)}
                class="w-full border rounded px-3 py-2" required />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Password</label>
              <input type="password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)}
                class="w-full border rounded px-3 py-2" required />
            </div>
          </>
        )}
        {type() === "certificate" && (
          <>
            <div>
              <label class="block text-sm font-medium mb-1">Certificate (PEM)</label>
              <textarea value={cert()} onInput={(e) => setCert(e.currentTarget.value)}
                class="w-full border rounded px-3 py-2 font-mono text-sm" rows={4} required />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Private Key (optional)</label>
              <textarea value={certKey()} onInput={(e) => setCertKey(e.currentTarget.value)}
                class="w-full border rounded px-3 py-2 font-mono text-sm" rows={4} />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">CA Certificate (optional)</label>
              <textarea value={ca()} onInput={(e) => setCa(e.currentTarget.value)}
                class="w-full border rounded px-3 py-2 font-mono text-sm" rows={4} />
            </div>
          </>
        )}
        {type() === "custom" && (
          <div>
            <label class="block text-sm font-medium mb-1">Custom Fields</label>
            <For each={customFields()}>
              {(field, i) => (
                <div class="flex gap-2 mb-2">
                  <input type="text" placeholder="Key" value={field.key}
                    onInput={(e) => {
                      const fields = [...customFields()]
                      fields[i()] = { ...fields[i()], key: e.currentTarget.value }
                      setCustomFields(fields)
                    }}
                    class="flex-1 border rounded px-3 py-2" />
                  <input type="text" placeholder="Value" value={field.value}
                    onInput={(e) => {
                      const fields = [...customFields()]
                      fields[i()] = { ...fields[i()], value: e.currentTarget.value }
                      setCustomFields(fields)
                    }}
                    class="flex-1 border rounded px-3 py-2" />
                  <button type="button" onClick={() => setCustomFields(customFields().filter((_, j) => j !== i()))}
                    class="text-red-500">Remove</button>
                </div>
              )}
            </For>
            <button type="button" onClick={() => setCustomFields([...customFields(), { key: "", value: "" }])}
              class="text-blue-500 text-sm">+ Add Field</button>
          </div>
        )}
        <div>
          <label class="block text-sm font-medium mb-1">Tags (comma-separated)</label>
          <input type="text" value={tags()} onInput={(e) => setTags(e.currentTarget.value)}
            class="w-full border rounded px-3 py-2" placeholder="production, api, aws" />
        </div>
        <div class="flex gap-2">
          <button type="submit" disabled={loading()}
            class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50">
            {loading() ? "Creating..." : "Create Credential"}
          </button>
          <a href="/credentials" class="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300">Cancel</a>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Create the credential detail component**

```typescript
// packages/web/src/components/credential-detail.tsx
import { createSignal, onMount, For } from "solid-js"
import { useParams, useLocation } from "wouter"

interface Credential {
  id: string
  label: string
  type: string
  value: any
  tags?: string[]
  time_created: number
}

export function CredentialDetail() {
  const params = useParams()
  const [, navigate] = useLocation()
  const [credential, setCredential] = createSignal<Credential | null>(null)
  const [revealed, setRevealed] = createSignal(false)
  const [loading, setLoading] = createSignal(true)

  onMount(async () => {
    const res = await fetch(`/api/credentials/${params.id}`)
    if (res.ok) {
      setCredential(await res.json())
    }
    setLoading(false)
  })

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this credential?")) return
    await fetch(`/api/credentials/${params.id}`, { method: "DELETE" })
    navigate("/credentials")
  }

  function maskValue(value: any): string {
    if (!value) return "***"
    if (value.type === "api_key") return value.key.slice(0, 4) + "***" + value.key.slice(-4)
    if (value.type === "username_password") return value.username + " / ***"
    if (value.type === "oauth") return value.access.slice(0, 4) + "***"
    return "***"
  }

  return (
    <div class="p-6 max-w-2xl mx-auto">
      {loading() ? (
        <div class="text-center py-8">Loading...</div>
      ) : !credential() ? (
        <div class="text-center py-8 text-gray-500">Credential not found</div>
      ) : (
        <>
          <div class="flex justify-between items-center mb-6">
            <h1 class="text-2xl font-bold">{credential()!.label}</h1>
            <button onClick={handleDelete} class="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600">
              Delete
            </button>
          </div>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-500">Type</label>
              <p class="mt-1">{credential()!.type}</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-500">Value</label>
              <div class="mt-1 flex items-center gap-2">
                <code class="bg-gray-100 px-2 py-1 rounded font-mono text-sm">
                  {revealed() ? JSON.stringify(credential()!.value, null, 2) : maskValue(credential()!.value)}
                </code>
                <button onClick={() => setRevealed(!revealed())} class="text-blue-500 text-sm">
                  {revealed() ? "Hide" : "Reveal"}
                </button>
              </div>
            </div>
            {credential()!.tags && (
              <div>
                <label class="block text-sm font-medium text-gray-500">Tags</label>
                <div class="mt-1">
                  {credential()!.tags!.map((tag) => (
                    <span class="bg-gray-200 text-gray-700 text-xs px-2 py-1 rounded mr-1">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label class="block text-sm font-medium text-gray-500">Created</label>
              <p class="mt-1">{new Date(credential()!.time_created).toLocaleString()}</p>
            </div>
          </div>
          <div class="mt-6">
            <a href="/credentials" class="text-blue-500 hover:underline">Back to list</a>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add credential management dashboard"
```

---

## Task 8: Integration and Wiring

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/server/src/api.ts`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add keytar dependency**

```bash
cd packages/core && bun add keytar
```

- [ ] **Step 2: Export new modules**

```typescript
// packages/core/src/index.ts
// Add exports:
export * from "./global-credential"
export * from "./global-credential/types"
export * from "./keychain"
```

- [ ] **Step 3: Wire up the handler in the server**

```typescript
// packages/server/src/api.ts
// Add import and register the handler:
import { GlobalCredentialHandler } from "./handlers/global-credential"

// In the API definition, add:
.add(GlobalCredentialHandler)
```

- [ ] **Step 4: Run typecheck**

Run: `cd packages/core && bun typecheck`
Expected: PASS

- [ ] **Step 5: Run typecheck for server**

Run: `cd packages/server && bun typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/server/src/api.ts packages/core/package.json
git commit -m "feat: wire up global credential system end-to-end"
```

---

## Task 9: Verification

- [ ] **Step 1: Run all tests**

Run: `cd packages/core && bun test`
Expected: All tests PASS

- [ ] **Step 2: Start the server and verify dashboard**

Run: `bun run dev`
Expected: Navigate to `http://localhost:3000/credentials` and see the dashboard

- [ ] **Step 3: Create a credential via API**

```bash
curl -X POST http://localhost:3000/api/credentials \
  -H "Content-Type: application/json" \
  -d '{"label":"Test Key","type":"api_key","value":{"type":"api_key","key":"sk-test-12345"},"tags":["test"]}'
```

Expected: Returns credential with id starting with `cred_`

- [ ] **Step 4: Verify credential is encrypted in DB**

Run: `sqlite3 ~/.local/share/opencode/credentials.db "SELECT value FROM global_credential"`
Expected: Value should be encrypted (not plaintext)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: credential sharing platform complete"
```
