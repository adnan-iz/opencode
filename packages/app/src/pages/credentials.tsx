import { createSignal, For, Show, onMount } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"

interface Credential {
  id: string
  label: string
  type: string
  tags?: string[]
  time_created: number
}

export default function CredentialsPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const [credentials, setCredentials] = createSignal<Credential[]>([])
  const [loading, setLoading] = createSignal(true)
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [showForm, setShowForm] = createSignal(false)

  onMount(async () => {
    try {
      const res = await fetch("/api/credentials")
      if (res.ok) {
        const data = await res.json()
        setCredentials(data)
      }
    } catch (error) {
      console.error("Failed to fetch credentials:", error)
    } finally {
      setLoading(false)
    }
  })

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/credentials/${id}`, { method: "DELETE" })
      if (res.ok) {
        setCredentials((prev) => prev.filter((c) => c.id !== id))
        setSelectedId(null)
      }
    } catch (error) {
      console.error("Failed to delete credential:", error)
    }
  }

  const handleCreate = (credential: Omit<Credential, "id" | "time_created">) => {
    const newCredential: Credential = {
      ...credential,
      id: crypto.randomUUID(),
      time_created: Date.now(),
    }
    setCredentials((prev) => [...prev, newCredential])
    setShowForm(false)
  }

  const selectedCredential = () => credentials().find((c) => c.id === selectedId())

  return (
    <div class="flex h-full bg-background-base">
      {/* Sidebar */}
      <div class="w-80 border-r border-border-base flex flex-col">
        <div class="p-4 border-b border-border-base">
          <div class="flex items-center justify-between">
            <h1 class="text-lg font-semibold text-text-strong">{language.t("credentials.title")}</h1>
            <button
              type="button"
              class="px-3 py-1.5 text-sm font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600"
              onClick={() => setShowForm(true)}
            >
              {language.t("credentials.add")}
            </button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto">
          {loading() ? (
            <div class="p-4 text-center text-text-weak">{language.t("common.loading")}</div>
          ) : credentials().length === 0 ? (
            <div class="p-4 text-center text-text-weak">{language.t("credentials.empty")}</div>
          ) : (
            <For each={credentials()}>
              {(cred) => (
                <button
                  type="button"
                  class={`w-full px-4 py-3 text-left border-b border-border-base hover:bg-background-hover ${
                    selectedId() === cred.id ? "bg-background-active" : ""
                  }`}
                  onClick={() => {
                    setSelectedId(cred.id)
                    setShowForm(false)
                  }}
                >
                  <div class="font-medium text-text-strong">{cred.label}</div>
                  <div class="text-sm text-text-weak">{cred.type}</div>
                  <Show when={cred.tags?.length}>
                    <div class="flex gap-1 mt-1">
                      <For each={cred.tags ?? []}>
                        {(tag) => (
                          <span class="px-1.5 py-0.5 text-xs bg-background-muted rounded">{tag}</span>
                        )}
                      </For>
                    </div>
                  </Show>
                </button>
              )}
            </For>
          )}
        </div>
      </div>

      {/* Main content */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={showForm()}
          fallback={
            <Show
              when={selectedCredential()}
              fallback={
                <div class="flex items-center justify-center h-full text-text-weak">
                  {language.t("credentials.selectOrCreate")}
                </div>
              }
            >
              {(cred) => (
                <CredentialDetail
                  credential={cred()}
                  onDelete={() => handleDelete(cred().id)}
                  onBack={() => setSelectedId(null)}
                />
              )}
            </Show>
          }
        >
          <CredentialForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        </Show>
      </div>
    </div>
  )
}

function CredentialDetail(props: { credential: Credential; onDelete: () => void; onBack: () => void }) {
  const language = useLanguage()
  const [revealed, setRevealed] = createSignal(false)

  return (
    <div class="p-6">
      <div class="flex items-center gap-2 mb-6">
        <button
          type="button"
          class="p-1 text-text-weak hover:text-text-strong"
          onClick={props.onBack}
          aria-label={language.t("common.goBack")}
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 class="text-xl font-semibold text-text-strong">{props.credential.label}</h2>
      </div>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-text-weak mb-1">{language.t("credentials.type")}</label>
          <div class="text-text-strong">{props.credential.type}</div>
        </div>

        <div>
          <label class="block text-sm font-medium text-text-weak mb-1">{language.t("credentials.value")}</label>
          <div class="flex items-center gap-2">
            <div class="flex-1 p-2 bg-background-muted rounded font-mono text-sm">
              {revealed() ? "••••••••••••••••" : "••••••••••••••••"}
            </div>
            <button
              type="button"
              class="px-3 py-1.5 text-sm text-text-weak hover:text-text-strong border border-border-base rounded"
              onClick={() => setRevealed((prev) => !prev)}
            >
              {revealed() ? language.t("credentials.hide") : language.t("credentials.reveal")}
            </button>
          </div>
        </div>

        <Show when={props.credential.tags?.length}>
          <div>
            <label class="block text-sm font-medium text-text-weak mb-1">{language.t("credentials.tags")}</label>
            <div class="flex gap-1">
              <For each={props.credential.tags ?? []}>
                {(tag) => (
                  <span class="px-2 py-1 text-sm bg-background-muted rounded">{tag}</span>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div>
          <label class="block text-sm font-medium text-text-weak mb-1">{language.t("credentials.created")}</label>
          <div class="text-text-strong">{new Date(props.credential.time_created).toLocaleDateString()}</div>
        </div>

        <div class="pt-4">
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-md hover:bg-red-600"
            onClick={props.onDelete}
          >
            {language.t("credentials.delete")}
          </button>
        </div>
      </div>
    </div>
  )
}

function CredentialForm(props: {
  onSubmit: (credential: Omit<Credential, "id" | "time_created">) => void
  onCancel: () => void
}) {
  const language = useLanguage()
  const [label, setLabel] = createSignal("")
  const [type, setType] = createSignal("API Key")
  const [tags, setTags] = createSignal("")
  const [value, setValue] = createSignal("")

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault()
    if (!label().trim()) return

    props.onSubmit({
      label: label().trim(),
      type: type(),
      tags: tags()
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    })
  }

  return (
    <form onSubmit={handleSubmit} class="p-6">
      <h2 class="text-xl font-semibold text-text-strong mb-6">{language.t("credentials.new")}</h2>

      <div class="space-y-4 max-w-md">
        <div>
          <label class="block text-sm font-medium text-text-weak mb-1">{language.t("credentials.label")}</label>
          <input
            type="text"
            class="w-full px-3 py-2 border border-border-base rounded-md bg-background-base text-text-strong focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={label()}
            onInput={(e) => setLabel(e.currentTarget.value)}
            required
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-text-weak mb-1">{language.t("credentials.type")}</label>
          <select
            class="w-full px-3 py-2 border border-border-base rounded-md bg-background-base text-text-strong focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={type()}
            onChange={(e) => setType(e.currentTarget.value)}
          >
            <option value="API Key">API Key</option>
            <option value="OAuth">OAuth</option>
            <option value="Username+Password">Username+Password</option>
            <option value="Certificate">Certificate</option>
            <option value="Custom">Custom</option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-text-weak mb-1">{language.t("credentials.value")}</label>
          <input
            type="password"
            class="w-full px-3 py-2 border border-border-base rounded-md bg-background-base text-text-strong focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={value()}
            onInput={(e) => setValue(e.currentTarget.value)}
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-text-weak mb-1">
            {language.t("credentials.tags")} ({language.t("credentials.tagsCommaSeparated")})
          </label>
          <input
            type="text"
            class="w-full px-3 py-2 border border-border-base rounded-md bg-background-base text-text-strong focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={tags()}
            onInput={(e) => setTags(e.currentTarget.value)}
            placeholder="production, api, external"
          />
        </div>

        <div class="flex gap-2 pt-4">
          <button
            type="submit"
            class="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600"
          >
            {language.t("credentials.save")}
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-text-weak border border-border-base rounded-md hover:bg-background-hover"
            onClick={props.onCancel}
          >
            {language.t("common.cancel")}
          </button>
        </div>
      </div>
    </form>
  )
}
