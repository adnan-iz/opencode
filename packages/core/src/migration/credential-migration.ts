export * as CredentialMigration from "./credential-migration"

import { Effect } from "effect"
import { Database } from "../database/database"
import { CredentialTable } from "../credential/sql"
import { GlobalCredential } from "../global-credential"
import { Credential } from "../credential"

export interface MigrationResult {
  migrated: number
  skipped: number
  errors: string[]
}

type LegacyRow = typeof CredentialTable.$inferSelect

function mapValue(value: Credential.Value) {
  if (value.type === "key") {
    return { type: "api_key" as const, key: value.key, metadata: value.metadata }
  }
  if (value.type === "oauth") {
    return {
      type: "oauth" as const,
      method_id: value.methodID,
      refresh: value.refresh,
      access: value.access,
      expires: value.expires,
      metadata: value.metadata,
    }
  }
  return undefined
}

// TODO: wire migration into server startup behind idempotent flag
export const migrate = Effect.fn("CredentialMigration.migrate")(function* () {
  const { db } = yield* Database.Service
  const svc = yield* GlobalCredential.Service
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: [] }

  // Legacy `credential` table lives in the same DB as `global_credential`.
  // If the table is absent (fresh install), the query fails and migration is a no-op.
  const rows = yield* db.select().from(CredentialTable).all().pipe(
    Effect.catch(() => Effect.succeed([] as LegacyRow[])),
  )

  for (const row of rows) {
    try {
      const value = mapValue(row.value)
      if (!value) {
        result.errors.push(`Unknown credential type for ${row.id}`)
        continue
      }

      const existing = yield* svc.get(row.id as unknown as GlobalCredential.ID)
      if (existing) {
        result.skipped++
        continue
      }

      const created = yield* svc.create({
        label: row.label,
        type: value.type,
        value: value as any,
        tags: ["migrated"],
      })

      // No project association is known from the legacy schema; link under a stable sentinel path.
      yield* svc.link("migrated", created.id)

      result.migrated++
    } catch (e) {
      result.errors.push(`Failed to migrate ${row.id}: ${e}`)
    }
  }

  return result
})
