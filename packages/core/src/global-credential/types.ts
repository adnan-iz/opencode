import { Schema } from "effect"

export const ApiKeyValueSchema = Schema.Struct({
  type: Schema.Literal("api_key"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "GlobalCredential.ApiKey" })

export interface ApiKeyValue {
  readonly type: "api_key"
  readonly key: string
  readonly metadata?: Record<string, unknown>
}

export const OAuthValueSchema = Schema.Struct({
  type: Schema.Literal("oauth"),
  method_id: Schema.String,
  refresh: Schema.String,
  access: Schema.String,
  expires: Schema.Number,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "GlobalCredential.OAuth" })

export interface OAuthValue {
  readonly type: "oauth"
  readonly method_id: string
  readonly refresh: string
  readonly access: string
  readonly expires: number
  readonly metadata?: Record<string, unknown>
}

export const UsernamePasswordValueSchema = Schema.Struct({
  type: Schema.Literal("username_password"),
  username: Schema.String,
  password: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "GlobalCredential.UsernamePassword" })

export interface UsernamePasswordValue {
  readonly type: "username_password"
  readonly username: string
  readonly password: string
  readonly metadata?: Record<string, unknown>
}

export const CertificateValueSchema = Schema.Struct({
  type: Schema.Literal("certificate"),
  cert: Schema.String,
  key: Schema.optional(Schema.String),
  ca: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "GlobalCredential.Certificate" })

export interface CertificateValue {
  readonly type: "certificate"
  readonly cert: string
  readonly key?: string
  readonly ca?: string
  readonly metadata?: Record<string, unknown>
}

export const CustomValueSchema = Schema.Struct({
  type: Schema.Literal("custom"),
  fields: Schema.Record(Schema.String, Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "GlobalCredential.Custom" })

export interface CustomValue {
  readonly type: "custom"
  readonly fields: Record<string, string>
  readonly metadata?: Record<string, unknown>
}

export const CredentialValueSchema = Schema.Union([
  ApiKeyValueSchema,
  OAuthValueSchema,
  UsernamePasswordValueSchema,
  CertificateValueSchema,
  CustomValueSchema,
]).pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "GlobalCredential.Value" })

export type CredentialValue = ApiKeyValue | OAuthValue | UsernamePasswordValue | CertificateValue | CustomValue

export type CredentialType = CredentialValue["type"]