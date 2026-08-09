import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { GlobalCredential } from "./global-credential"
import { LayerNode } from "./effect/layer-node"
import { testEffect } from "../test/lib/effect"

const it = testEffect(LayerNode.compile(GlobalCredential.node))

describe("GlobalCredential", () => {
  it.effect("create and get credential", () =>
    Effect.gen(function* () {
      const svc = yield* GlobalCredential.Service
      const cred = yield* svc.create({
        label: "Test API Key",
        type: "api_key",
        value: { type: "api_key", key: "sk-test-12345" },
        tags: ["test"],
      })

      expect(cred.id).toStartWith("cred_")
      expect(cred.label).toBe("Test API Key")
      expect(cred.type).toBe("api_key")
      expect(cred.value).toEqual({ type: "api_key", key: "sk-test-12345" })

      const fetched = yield* svc.get(cred.id)
      expect(fetched).toBeDefined()
      expect(fetched?.value).toEqual({ type: "api_key", key: "sk-test-12345" })

      yield* svc.remove(cred.id)
    }),
  )

  it.effect("link and resolve credential", () =>
    Effect.gen(function* () {
      const svc = yield* GlobalCredential.Service
      const cred = yield* svc.create({
        label: "GitHub Token",
        type: "api_key",
        value: { type: "api_key", key: "ghp_test123" },
      })

      yield* svc.link("/test/project", cred.id, { GITHUB_TOKEN: "key" })

      const linked = yield* svc.linked("/test/project")
      expect(linked.length).toBe(1)

      const env = yield* svc.resolveForProject("/test/project")
      expect(env.GITHUB_TOKEN).toBe("ghp_test123")

      yield* svc.unlink("/test/project", cred.id)
      yield* svc.remove(cred.id)
    }),
  )

  it.effect("dangerous env vars are never injected", () =>
    Effect.gen(function* () {
      const svc = yield* GlobalCredential.Service
      const cred = yield* svc.create({
        label: "Leaky Token",
        type: "api_key",
        value: { type: "api_key", key: "leak-123" },
      })

      yield* svc.link("/leak/project", cred.id, {
        GITHUB_TOKEN: "key",
        PATH: "key",
        NODE_OPTIONS: "key",
        LD_PRELOAD: "key",
      })

      const env = yield* svc.resolveForProject("/leak/project")
      expect(env.GITHUB_TOKEN).toBe("leak-123")
      expect(env.PATH).toBeUndefined()
      expect(env.NODE_OPTIONS).toBeUndefined()
      expect(env.LD_PRELOAD).toBeUndefined()

      yield* svc.unlink("/leak/project", cred.id)
      yield* svc.remove(cred.id)
    }),
  )

  it.effect("link fails for missing credential", () =>
    Effect.gen(function* () {
      const svc = yield* GlobalCredential.Service
      const exit = yield* svc.link("/missing/proj", "cred_nonexistent" as GlobalCredential.ID, { KEY: "key" }).pipe(
        Effect.exit,
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})