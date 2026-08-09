export * as GlobalCredential from "./global-credential"

import { and, asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "./database/database"
import { GlobalCredentialTable, ProjectCredentialRefTable } from "./global-credential/sql"
import { CredentialValueSchema } from "./global-credential/types"
import type { CredentialValue, CredentialType } from "./global-credential/types"
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
  readonly resolveForProject: (projectPath: string) => Effect.Effect<Record<string, string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GlobalCredential") {}

function generateId(): string {
  return "cred_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function extractField(value: CredentialValue, fieldPath: string): string | undefined {
  if (fieldPath === "key" && value.type === "api_key") return value.key
  if (fieldPath === "access" && value.type === "oauth") return value.access
  if (fieldPath === "password" && value.type === "username_password") return value.password
  if (fieldPath === "username" && value.type === "username_password") return value.username
  if (fieldPath === "cert" && value.type === "certificate") return value.cert
  if (value.type === "custom" && fieldPath in value.fields) return value.fields[fieldPath]
  return undefined
}

function rowToInfo(row: typeof GlobalCredentialTable.$inferSelect, value: CredentialValue): Info {
  return {
    id: row.id as ID,
    label: row.label,
    type: row.type,
    value,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const doGet = (id: ID) =>
      Effect.gen(function* () {
        const row = yield* db.select().from(GlobalCredentialTable).where(eq(GlobalCredentialTable.id, id)).get().pipe(Effect.orDie)
        if (!row) return undefined
        const value = JSON.parse(row.value) as CredentialValue
        return rowToInfo(row, value)
      })

    return Service.of({
      all: Effect.fn("GlobalCredential.all")(function* () {
        const rows = yield* db.select().from(GlobalCredentialTable).orderBy(asc(GlobalCredentialTable.time_created)).all().pipe(Effect.orDie)
        return rows.map((row) => rowToInfo(row, JSON.parse(row.value) as CredentialValue))
      }),

      get: Effect.fn("GlobalCredential.get")(doGet),

      create: Effect.fn("GlobalCredential.create")(function* (input) {
        const id = generateId() as ID
        const now = Date.now()
        yield* db.insert(GlobalCredentialTable).values({
          id,
          label: input.label,
          type: input.type,
          value: JSON.stringify(input.value),
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
        if (updates.value) sets.value = JSON.stringify(updates.value)
        yield* db.update(GlobalCredentialTable).set(sets).where(eq(GlobalCredentialTable.id, id)).run().pipe(Effect.orDie)
      }),

      remove: Effect.fn("GlobalCredential.remove")(function* (id) {
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
          .where(and(eq(ProjectCredentialRefTable.project_path, projectPath), eq(ProjectCredentialRefTable.credential_id, credentialID)))
          .run().pipe(Effect.orDie)
      }),

      linked: Effect.fn("GlobalCredential.linked")(function* (projectPath) {
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

      resolveForProject: Effect.fn("GlobalCredential.resolveForProject")(function* (projectPath) {
        const refs = yield* db.select().from(ProjectCredentialRefTable)
          .where(eq(ProjectCredentialRefTable.project_path, projectPath))
          .all().pipe(Effect.orDie)
        const env: Record<string, string> = {}
        for (const ref of refs) {
          const cred = yield* doGet(ref.credential_id as ID)
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

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })