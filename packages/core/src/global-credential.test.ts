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

  it.effect("skip expired OAuth tokens in resolve", () =>
    Effect.gen(function* () {
      const svc = yield* GlobalCredential.Service
      const future = Math.floor(Date.now() / 1000) + 3600
      const past = Math.floor(Date.now() / 1000) - 3600

      const valid = yield* svc.create({
        label: "Valid OAuth",
        type: "oauth",
        value: { type: "oauth", method_id: "m1", refresh: "rt1", access: "valid-token", expires: future },
      })

      const expired = yield* svc.create({
        label: "Expired OAuth",
        type: "oauth",
        value: { type: "oauth", method_id: "m2", refresh: "rt2", access: "expired-token", expires: past },
      })

      yield* svc.link("/oauth/project", valid.id, { OAUTH_VALID: "access" })
      yield* svc.link("/oauth/project", expired.id, { OAUTH_EXPIRED: "access" })

      const env = yield* svc.resolveForProject("/oauth/project")
      expect(env.OAUTH_VALID).toBe("valid-token")
      expect(env.OAUTH_EXPIRED).toBeUndefined()

      const stillValid = yield* svc.refresh(valid.id)
      expect(stillValid).toBe(true)

      const stillValid2 = yield* svc.refresh(expired.id)
      expect(stillValid2).toBe(false)

      yield* svc.unlink("/oauth/project", valid.id)
      yield* svc.unlink("/oauth/project", expired.id)
      yield* svc.remove(valid.id)
      yield* svc.remove(expired.id)
    }),
  )

  it.effect("end-to-end: create, link, resolve, unlink, delete", () =>
    Effect.gen(function* () {
      const svc = yield* GlobalCredential.Service

      const cred = yield* svc.create({
        label: "E2E GitHub Token",
        type: "api_key",
        value: { type: "api_key", key: "ghp_e2e_test_token_12345" },
        tags: ["e2e", "github"],
      })
      expect(cred.id).toStartWith("cred_")

      yield* svc.link("/e2e/project", cred.id, { GITHUB_TOKEN: "key", GH_ENTERPRISE: "key" })

      const linked = yield* svc.linked("/e2e/project")
      expect(linked.length).toBe(1)
      expect(linked[0].id).toBe(cred.id)

      const env = yield* svc.resolveForProject("/e2e/project")
      expect(env.GITHUB_TOKEN).toBe("ghp_e2e_test_token_12345")
      expect(env.GH_ENTERPRISE).toBe("ghp_e2e_test_token_12345")

      yield* svc.link("/e2e/project", cred.id, { GITHUB_TOKEN: "key", PATH: "key" })
      const env2 = yield* svc.resolveForProject("/e2e/project")
      expect(env2.PATH).toBeUndefined()
      expect(env2.GITHUB_TOKEN).toBe("ghp_e2e_test_token_12345")

      yield* svc.unlink("/e2e/project", cred.id)

      const afterUnlink = yield* svc.linked("/e2e/project")
      expect(afterUnlink.length).toBe(0)

      yield* svc.remove(cred.id)

      const deleted = yield* svc.get(cred.id)
      expect(deleted).toBeUndefined()
    }),
  )
})