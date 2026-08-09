import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CredentialMigration } from "./credential-migration"
import { GlobalCredential } from "../global-credential"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { testEffect } from "../../test/lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([GlobalCredential.node, Database.node])))

describe("CredentialMigration", () => {
  it.effect("migrate returns result with no projects", () =>
    Effect.gen(function* () {
      const result = yield* CredentialMigration.migrate()
      expect(result).toHaveProperty("migrated")
      expect(result).toHaveProperty("skipped")
      expect(result).toHaveProperty("errors")
    }),
  )
})
