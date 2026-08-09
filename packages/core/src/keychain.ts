export * as Keychain from "./keychain"

import { Effect } from "effect"

let keytar: typeof import("keytar") | undefined

async function getKeytar() {
  if (!keytar) {
    try {
      keytar = await import("keytar")
    } catch {
      return undefined
    }
  }
  return keytar
}

export const setSecret = (service: string, account: string, password: string) =>
  Effect.tryPromise({
    try: async () => {
      const kt = await getKeytar()
      if (!kt) throw new Error("keytar not available")
      await kt.setPassword(service, account, password)
      return `${service}:${account}`
    },
    catch: (e) => new Error(`Failed to set secret: ${e}`),
  })

export const getSecret = (service: string, account: string) =>
  Effect.tryPromise({
    try: async () => {
      const kt = await getKeytar()
      if (!kt) return undefined
      return (await kt.getPassword(service, account)) ?? undefined
    },
    catch: (e) => new Error(`Failed to get secret: ${e}`),
  })

export const deleteSecret = (service: string, account: string) =>
  Effect.tryPromise({
    try: async () => {
      const kt = await getKeytar()
      if (!kt) return
      await kt.deletePassword(service, account)
    },
    catch: (e) => new Error(`Failed to delete secret: ${e}`),
  })
