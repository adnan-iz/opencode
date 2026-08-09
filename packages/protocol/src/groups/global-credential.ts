// packages/protocol/src/groups/global-credential.ts
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

function optional<A>(schema: Schema.Schema<A>): Schema.Schema<A | undefined> {
  return Schema.optional(schema)
}

const CredentialType = Schema.Union([
  Schema.Literal("api_key"),
  Schema.Literal("oauth"),
  Schema.Literal("username_password"),
  Schema.Literal("certificate"),
  Schema.Literal("custom"),
])

const CreateCredentialPayload = Schema.Struct({
  label: Schema.String,
  type: CredentialType,
  value: Schema.Unknown,
  tags: optional(Schema.Array(Schema.String)),
})

const UpdateCredentialPayload = Schema.Struct({
  label: optional(Schema.String),
  value: optional(Schema.Unknown),
  tags: optional(Schema.Array(Schema.String)),
})

const LinkCredentialPayload = Schema.Struct({
  project_path: Schema.String,
  env_mapping: optional(Schema.Record(Schema.String, Schema.String)),
})

const CredentialResponse = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  type: Schema.String,
  value: Schema.Unknown,
  tags: optional(Schema.Array(Schema.String)),
  time_created: Schema.Number,
  time_updated: Schema.Number,
})

const ResolveResponse = Schema.Record(Schema.String, Schema.String)

export const GlobalCredentialGroup = HttpApiGroup.make("server.global-credential")
  .add(
    HttpApiEndpoint.get("global-credential.list", "/api/credentials", {
      success: Schema.Array(CredentialResponse),
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.list",
          summary: "List all global credentials",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("global-credential.create", "/api/credentials", {
      payload: CreateCredentialPayload,
      success: CredentialResponse,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.create",
          summary: "Create a global credential",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("global-credential.get", "/api/credentials/:id", {
      params: { id: Schema.String },
      success: CredentialResponse,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.get",
          summary: "Get a global credential",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("global-credential.update", "/api/credentials/:id", {
      params: { id: Schema.String },
      payload: UpdateCredentialPayload,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.update",
          summary: "Update a global credential",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("global-credential.remove", "/api/credentials/:id", {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.remove",
          summary: "Delete a global credential",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("global-credential.link", "/api/credentials/:id/link", {
      params: { id: Schema.String },
      payload: LinkCredentialPayload,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.link",
          summary: "Link credential to project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("global-credential.unlink", "/api/credentials/:id/link/:project", {
      params: { id: Schema.String, project: Schema.String },
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.unlink",
          summary: "Unlink credential from project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("global-credential.resolve", "/api/credentials/resolve/:project", {
      params: { project: Schema.String },
      success: ResolveResponse,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "global-credential.resolve",
          summary: "Resolve credentials for project",
        }),
      ),
  )
