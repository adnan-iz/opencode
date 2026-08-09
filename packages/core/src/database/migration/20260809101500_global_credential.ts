import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260809101500_global_credential",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`global_credential\` (
          \`id\` text PRIMARY KEY,
          \`label\` text NOT NULL,
          \`type\` text NOT NULL,
          \`value\` text NOT NULL,
          \`keychain_ref\` text,
          \`tags\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project_credential_ref\` (
          \`project_path\` text NOT NULL,
          \`credential_id\` text NOT NULL,
          \`env_mapping\` text,
          CONSTRAINT \`project_credential_ref_pk\` PRIMARY KEY(\`project_path\`, \`credential_id\`)
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration