export * as CredentialMigration from "./credential-migration"

import { Effect } from "effect"
import { Global } from "../global"
import { GlobalCredential } from "../global-credential"
import { Database } from "bun:sqlite"
import fs from "fs/promises"
import path from "path"

export interface MigrationResult {
  migrated: number
  skipped: number
  errors: string[]
}

function mapValue(row: { value: string }) {
  const parsed = JSON.parse(row.value)
  if (parsed.type === "key") {
    return { type: "api_key" as const, key: parsed.key, metadata: parsed.metadata }
  }
  if (parsed.type === "oauth") {
    return {
      type: "oauth" as const,
      method_id: parsed.methodID,
      refresh: parsed.refresh,
      access: parsed.access,
      expires: parsed.expires,
      metadata: parsed.metadata,
    }
  }
  return undefined
}

export const migrate = Effect.fn("CredentialMigration.migrate")(function* () {
  const svc = yield* GlobalCredential.Service
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
      const db = new Database(dbPath, { readonly: true })
      const rows = db.prepare("SELECT * FROM credential").all() as Array<{
        id: string
        integration_id: string
        label: string
        value: string
      }>

      for (const row of rows) {
        try {
          const value = mapValue(row)
          if (!value) {
            result.errors.push(`Unknown credential type for ${row.id}`)
            continue
          }

          const existing = yield* svc.get(row.id as GlobalCredential.ID)
          if (existing) {
            result.skipped++
            continue
          }

          yield* svc.create({
            label: row.label,
            type: value.type,
            value: value as any,
            tags: ["migrated"],
          })

          yield* svc.link(
            path.join(dataDir, "projects", project),
            row.id as GlobalCredential.ID,
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
