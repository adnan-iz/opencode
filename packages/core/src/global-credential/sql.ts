import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
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

export const ProjectCredentialRefTable = sqliteTable(
  "project_credential_ref",
  {
    project_path: text().notNull(),
    credential_id: text().notNull(),
    env_mapping: text(),
  },
  (table) => [primaryKey({ columns: [table.project_path, table.credential_id] })],
)