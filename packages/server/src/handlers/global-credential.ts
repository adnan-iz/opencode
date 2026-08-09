import { GlobalCredential } from "@opencode-ai/core/global-credential"
import { Location } from "@opencode-ai/core/location"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import path from "path"
import { Api } from "../api"

function serializeCred(c: GlobalCredential.Info) {
  return {
    id: c.id,
    label: c.label,
    type: c.type,
    value: { type: c.value.type },
    tags: c.tags ? Array.from(c.tags) : undefined,
    time_created: c.timeCreated,
    time_updated: c.timeUpdated,
  }
}

export const GlobalCredentialHandler = HttpApiBuilder.group(Api, "server.global-credential", (handlers) =>
  handlers
    .handle(
      "global-credential.list",
      Effect.fn(function* () {
        const globalCredential = yield* GlobalCredential.Service
        const creds = yield* globalCredential.all()
        return creds.map(serializeCred)
      }),
    )
    .handle(
      "global-credential.create",
      Effect.fn(function* (ctx) {
        const globalCredential = yield* GlobalCredential.Service
        const cred = yield* globalCredential.create({
          label: ctx.payload.label,
          type: ctx.payload.type as any,
          value: ctx.payload.value as any,
          tags: ctx.payload.tags as string[],
        })
        return serializeCred(cred)
      }),
    )
    .handle(
      "global-credential.get",
      Effect.fn(function* (ctx) {
        const globalCredential = yield* GlobalCredential.Service
        const cred = yield* globalCredential.get(ctx.params.id as GlobalCredential.ID)
        if (!cred) return HttpServerResponse.empty({ status: 404 })
        return serializeCred(cred)
      }),
    )
    .handle(
      "global-credential.update",
      Effect.fn(function* (ctx) {
        const globalCredential = yield* GlobalCredential.Service
        yield* globalCredential.update(ctx.params.id as GlobalCredential.ID, {
          label: ctx.payload.label,
          value: ctx.payload.value as any,
          tags: ctx.payload.tags as string[],
        })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "global-credential.remove",
      Effect.fn(function* (ctx) {
        const globalCredential = yield* GlobalCredential.Service
        yield* globalCredential.remove(ctx.params.id as GlobalCredential.ID)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "global-credential.link",
      Effect.fn(function* (ctx) {
        const globalCredential = yield* GlobalCredential.Service
        yield* globalCredential.link(
          ctx.payload.project_path,
          ctx.params.id as GlobalCredential.ID,
          ctx.payload.env_mapping,
        )
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "global-credential.unlink",
      Effect.fn(function* (ctx) {
        const globalCredential = yield* GlobalCredential.Service
        yield* globalCredential.unlink(ctx.params.project, ctx.params.id as GlobalCredential.ID)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "global-credential.resolve",
      Effect.fn(function* (ctx) {
        const location = yield* Location.Service
        if (path.resolve(ctx.params.project) !== path.resolve(location.directory)) {
          return HttpServerResponse.empty({ status: 403 })
        }
        const globalCredential = yield* GlobalCredential.Service
        return yield* globalCredential.resolveForProject(ctx.params.project)
      }),
    ),
)
