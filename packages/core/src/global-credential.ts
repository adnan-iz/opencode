export * as GlobalCredential from "./global-credential"

import { and, asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database/database"
import { GlobalCredentialTable, ProjectCredentialRefTable } from "./global-credential/sql"
import { CredentialValueSchema } from "./global-credential/types"
import type { CredentialValue, CredentialType } from "./global-credential/types"
import { Keychain } from "./keychain"
import { makeGlobalNode } from "./effect/app-node"

export const ID = Schema.String.pipe(
  Schema.brand("GlobalCredential.ID"),
)
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: ID,
  label: Schema.String,
  type: Schema.String,
  value: CredentialValueSchema,
  tags: Schema.optional(Schema.Array(Schema.String)),
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
  readonly refresh: (id: ID) => Effect.Effect<boolean>
  readonly resolveForProject: (projectPath: string) => Effect.Effect<Record<string, string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GlobalCredential") {}

const KEYCHAIN_SERVICE = "opencode-credentials"

export const DANGEROUS_ENV_VARS = new Set([
  "PATH", "NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES", "BASH_ENV", "ENV", "SHELL",
  "PS1", "SHLVL", "PROMPT_COMMAND",
])

function generateId(): string {
  return "cred_" + crypto.randomUUID()
}

function extractField(value: CredentialValue, fieldPath: string): string | undefined {
  if (fieldPath === "key" && value.type === "api_key") return value.key
  if (fieldPath === "access" && value.type === "oauth") {
    if (value.expires < Date.now() / 1000) return undefined
    return value.access
  }
  if (fieldPath === "password" && value.type === "username_password") return value.password
  if (fieldPath === "username" && value.type === "username_password") return value.username
  if (fieldPath === "cert" && value.type === "certificate") return value.cert
  if (value.type === "custom" && fieldPath in value.fields) return value.fields[fieldPath]
  return undefined
}

function rowToInfo(row: typeof GlobalCredentialTable.$inferSelect, value: CredentialValue): Info {
  let tags: string[] | undefined
  if (row.tags) {
    try { tags = JSON.parse(row.tags) } catch { tags = undefined }
  }
  return {
    id: row.id as ID,
    label: row.label,
    type: row.type,
    value,
    tags,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const decode = Schema.decodeUnknownSync(CredentialValueSchema)

    const decryptValue = (encrypted: string, keychainRef: string | null) =>
      Effect.gen(function* () {
        if (!keychainRef) {
          return yield* Effect.die(new Error("Credential has no keychain reference — re-create it"))
        }
        const account = keychainRef.replace(KEYCHAIN_SERVICE + ":", "")
        const json = yield* Keychain.getSecret(KEYCHAIN_SERVICE, account).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        )
        if (!json) return yield* Effect.die(new Error("Credential not found in keychain"))
        return decode(JSON.parse(json))
      })

    const encryptValue = (id: string, value: CredentialValue) =>
      Effect.gen(function* () {
        const json = JSON.stringify(value)
        const result = yield* Keychain.setSecret(KEYCHAIN_SERVICE, id, json).pipe(
          Effect.catch(() => Effect.succeed(null)),
        )
        if (result === null) {
          return yield* Effect.die(new Error("Keychain storage unavailable — cannot store credentials safely"))
        }
        return { encrypted: "keychain:encrypted", keychainRef: result } as const
      })

    const doGet = (id: ID) =>
      Effect.gen(function* () {
        const row = yield* db.select().from(GlobalCredentialTable).where(eq(GlobalCredentialTable.id, id)).get().pipe(Effect.orDie)
        if (!row) return undefined
        const value = yield* decryptValue(row.value, row.keychain_ref)
        return rowToInfo(row, value)
      })

    return Service.of({
      all: Effect.fn("GlobalCredential.all")(function* () {
        const rows = yield* db.select().from(GlobalCredentialTable).orderBy(asc(GlobalCredentialTable.time_created)).all().pipe(Effect.orDie)
        const results: Info[] = []
        for (const row of rows) {
          const value = yield* decryptValue(row.value, row.keychain_ref)
          results.push(rowToInfo(row, value))
        }
        return results
      }),

      get: Effect.fn("GlobalCredential.get")(doGet),

      create: Effect.fn("GlobalCredential.create")(function* (input) {
        const id = generateId() as ID
        const { encrypted, keychainRef } = yield* encryptValue(id, input.value)
        const now = Date.now()
        yield* db.insert(GlobalCredentialTable).values({
          id,
          label: input.label,
          type: input.type,
          value: encrypted,
          keychain_ref: keychainRef,
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
        if (updates.label !== undefined) sets.label = updates.label
        if (updates.tags !== undefined) sets.tags = JSON.stringify(updates.tags)
        if (updates.value !== undefined) {
          const { encrypted, keychainRef } = yield* encryptValue(id, updates.value)
          sets.value = encrypted
          sets.keychain_ref = keychainRef
        }
        yield* db.update(GlobalCredentialTable).set(sets).where(eq(GlobalCredentialTable.id, id)).run().pipe(Effect.orDie)
      }),

      remove: Effect.fn("GlobalCredential.remove")(function* (id) {
        yield* Keychain.deleteSecret(KEYCHAIN_SERVICE, id).pipe(Effect.catch(() => Effect.void))
        yield* db.delete(ProjectCredentialRefTable).where(eq(ProjectCredentialRefTable.credential_id, id)).run().pipe(Effect.orDie)
        yield* db.delete(GlobalCredentialTable).where(eq(GlobalCredentialTable.id, id)).run().pipe(Effect.orDie)
      }),

      link: Effect.fn("GlobalCredential.link")(function* (projectPath, credentialID, envMapping) {
        const existing = yield* doGet(credentialID)
        if (!existing) return yield* Effect.die(new Error(`Credential ${credentialID} not found`))
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
          .where(and(eq(ProjectCredentialRefTable.project_path, projectPath), eq(ProjectCredentialRefTable.credential_id, credentialID)))
          .run().pipe(Effect.orDie)
      }),

      linked: Effect.fn("GlobalCredential.linked")(function* (projectPath) {
        // ponytail: N+1 acceptable for credential store, batch if throughput matters
        const refs = yield* db.select().from(ProjectCredentialRefTable)
          .where(eq(ProjectCredentialRefTable.project_path, projectPath))
          .all().pipe(Effect.orDie)
        const results: Info[] = []
        for (const ref of refs) {
          const cred = yield* doGet(ref.credential_id as ID)
          if (cred) results.push(cred)
        }
        return results
      }),

      refresh: Effect.fn("GlobalCredential.refresh")(function* (id) {
        const cred = yield* doGet(id)
        if (!cred) return false
        if (cred.value.type === "oauth") return cred.value.expires > Date.now() / 1000
        return true
      }),

      resolveForProject: Effect.fn("GlobalCredential.resolveForProject")(function* (projectPath) {
        // ponytail: N+1 acceptable for credential store, batch if throughput matters
        const refs = yield* db.select().from(ProjectCredentialRefTable)
          .where(eq(ProjectCredentialRefTable.project_path, projectPath))
          .all().pipe(Effect.orDie)
        const env: Record<string, string> = {}
        for (const ref of refs) {
          const cred = yield* doGet(ref.credential_id as ID)
          if (!cred) continue
          const mapping = (() => {
            if (!ref.env_mapping) return {} as Record<string, string>
            try { return JSON.parse(ref.env_mapping) as Record<string, string> } catch { return {} }
          })()
          for (const [envKey, fieldPath] of Object.entries(mapping)) {
            if (DANGEROUS_ENV_VARS.has(envKey)) continue
            const value = extractField(cred.value, fieldPath)
            if (value !== undefined) env[envKey] = value
          }
        }
        return env
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })