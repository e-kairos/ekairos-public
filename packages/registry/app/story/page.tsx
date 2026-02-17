"use client"

import { useState } from "react"
import type { UIMessage } from "ai"
import { cn } from "@/lib/utils"

export default function StoriesTestPage() {
  const [storyKey, setStoryKey] = useState("test-story")
  const [message, setMessage] = useState("Hello from test!")
  const [status, setStatus] = useState<string>("")
  const [registeredStories, setRegisteredStories] = useState<string[]>([])

  const registerTestStory = async () => {
    try {
      setStatus("Registering story...")
      
      const response = await fetch('/api/internal/story/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyKey,
          context: {
            userId: "user-123",
            projectId: "project-456",
            message: message,
          },
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to register story')
      }

      setStatus(`Story "${storyKey}" registered successfully!`)
      setRegisteredStories([...registeredStories, storyKey])
    }
    catch (error: any) {
      setStatus(`Error: ${error.message}`)
    }
  }

  const reactToStory = async () => {
    try {
      setStatus("Starting story reaction...")
      
      const uiMessages: UIMessage[] = [
        {
          id: "msg-1",
          role: "user",
          parts: [
            {
              type: "text",
              text: message,
            },
          ],
        },
      ]

      const response = await fetch('/api/internal/story/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyKey,
          messages: uiMessages,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to react to story')
      }

      const result = await response.json()
      setStatus(`Story "${storyKey}" reaction started! Check console for workflow output.`)
    }
    catch (error: any) {
      setStatus(`Error: ${error.message}`)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-10">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <p className="text-[0.7rem] uppercase tracking-[0.45em] text-muted-foreground">story toolkit</p>
          <h1 className="text-3xl font-semibold tracking-tight">Story system test</h1>
          <p className="text-sm text-muted-foreground">
            Registra un story demo y dispara una reacción para validar integraciones.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-border/80 bg-card p-6 space-y-4">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.4em] text-muted-foreground">registro</p>
              <h2 className="text-lg font-medium text-foreground">Registrar Story</h2>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Story Key</label>
                <input
                  type="text"
                  value={storyKey}
                  onChange={(e) => setStoryKey(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  placeholder="test-story"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Mensaje de prueba</label>
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  placeholder="Hello from test!"
                />
              </div>
              <button
                onClick={registerTestStory}
                className="inline-flex w-full items-center justify-center rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Registrar Story
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-border/80 bg-card p-6 space-y-4">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.4em] text-muted-foreground">reacción</p>
              <h2 className="text-lg font-medium text-foreground">Reaccionar Story</h2>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Story Key</label>
                <input
                  type="text"
                  value={storyKey}
                  onChange={(e) => setStoryKey(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  placeholder="test-story"
                />
              </div>
              <button
                onClick={reactToStory}
                className="inline-flex w-full items-center justify-center rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Reaccionar
              </button>
            </div>
          </section>
        </div>

        {registeredStories.length > 0 && (
          <section className="rounded-2xl border border-border/80 bg-card p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[0.65rem] uppercase tracking-[0.4em] text-muted-foreground">historico</p>
                <h2 className="text-lg font-medium">Stories registrados</h2>
              </div>
              <span className="text-xs text-muted-foreground">{registeredStories.length}</span>
            </div>
            <ul className="space-y-2">
              {registeredStories.map((key) => (
                <li key={key} className="rounded-lg border border-border/60 px-3 py-2 text-sm text-muted-foreground">
                  {key}
                </li>
              ))}
            </ul>
          </section>
        )}

        {status && (
          <div
            className={cn(
              "rounded-xl border px-4 py-3 text-sm",
              status.startsWith("Error")
                ? "border-destructive/60 text-destructive-foreground"
                : "border-emerald-200 text-emerald-700 dark:text-emerald-300"
            )}
          >
            {status}
          </div>
        )}
      </div>
    </div>
  )
}

