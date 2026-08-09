import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as Keychain from "./keychain"

describe("Keychain", () => {
  test("encrypt and decrypt round-trip", async () => {
    const service = "opencode-test"
    const account = "test-credential"
    const plaintext = "my-secret-api-key-12345"

    const ref = await Effect.runPromise(Keychain.setSecret(service, account, plaintext))
    expect(ref).toBeString()

    const decrypted = await Effect.runPromise(Keychain.getSecret(service, account))
    expect(decrypted).toBe(plaintext)

    await Effect.runPromise(Keychain.deleteSecret(service, account))
  })

  test("getSecret returns undefined for missing key", async () => {
    const result = await Effect.runPromise(Keychain.getSecret("opencode-test", "nonexistent"))
    expect(result).toBeUndefined()
  })
})
