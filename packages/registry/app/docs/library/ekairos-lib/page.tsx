"use client"

import React from "react"

const sections = [
  {
    title: "1. Configuración del Agente (createAgent)",
    description:
      "El núcleo del flujo es la función fluida `createAgent()` expuesta por `ekairos/agent`. Define el contexto persistente, el prompt del sistema y las herramientas (tipadas con Zod) sin tocar genéricos.",
    path: "packages/web/src/lib/agents/simple-agent.ts",
    code: [
      'import { createAgent } from "ekairos/agent"',
      'import { z } from "zod"',
      'import { tool } from "ai"',
      "const simpleAgentBuilder = createAgent()",
      "  .context(async (stored) => {",
      "    const previous = stored.content",
      "",
      "    return {",
      '      userId: previous?.userId ?? "test-user",',
      '      topic: previous?.topic ?? "general",',
      "    }",
      "  })",
      "  .systemPrompt(async ({ content }) => {",
      "    const { topic } = content",
      "    return `You are a helpful assistant for testing purposes.",
      "    Current topic: ${topic}.`",
      "  })",
      "  .tools(async ({ content }, stream) => {",
      "    void stream",
      "    const { topic } = content",
      "",
      "    return {",
      "      setTopic: tool({",
      "        description: `Set the conversation topic (current: ${topic})`,",
      "        inputSchema: z.object({",
      '          topic: z.string().describe("The topic to set for the conversation"),',
      "        }),",
      "        execute: async ({ topic }) => ({ success: true, message: `Topic set to ${topic}` }),",
      "      }),",
      "    }",
      "  })",
      '  .model("gpt-4o-mini")',
      "",
      "export const simpleAgentConfig = simpleAgentBuilder.config()",
      "export const simpleAgent = simpleAgentBuilder.build()",
    ].join("\n"),
  },
  {
    title: "2. API Route",
    description:
      "La API HTTP recibe los mensajes del componente Agent y los convierte en eventos compatibles con Ekairos. Esta es la pieza que siempre se monta primero.",
    path: "packages/web/src/app/api/test-agent/route.ts",
    code: [
      'import { UIMessage, createUIMessageStreamResponse } from "ai"',
      'import { simpleAgent } from "@/lib/agents/simple-agent"',
      "",
      "function createUserItemFromUIMessages(messages: UIMessage[]) {",
      "  if (!Array.isArray(messages) || messages.length === 0) {",
      '    throw new Error("Missing messages to create event")',
      "  }",
      "",
      "  const lastMessage = messages[messages.length - 1]",
      "",
      "  return {",
      "    id: lastMessage.id,",
      '    type: "user.message",',
      '    channel: "web",',
      "    content: {",
      "      parts: lastMessage.parts,",
      "    },",
      "    createdAt: new Date().toISOString(),",
      "  }",
      "}",
      "",
      "export async function POST(req: Request) {",
      "  const { messages, contextKey }: { messages: UIMessage[]; contextKey?: string } = await req.json()",
      "",
      "  const event = createUserItemFromUIMessages(messages)",
      "",
      "  try {",
      "    const result = await simpleAgent.progressStream(event, contextKey ? { key: contextKey } : null)",
      "",
      "    return createUIMessageStreamResponse({ stream: result.stream })",
      "  } catch (error) {",
      '    console.error("[api/test-agent] progressStream failed", JSON.stringify(error, null, 2))',
      "",
      "    return new Response(",
      "      JSON.stringify({",
      '        error: "Agent failed to respond",',
      "      }),",
      "      {",
      "        status: 500,",
      '        headers: { "Content-Type": "application/json" },',
      "      },",
      "    )",
      "  }",
      "}",
    ].join("\n"),
  },
  {
    title: "3. UI del Agente (opcional)",
    description:
      "La librería es independiente de la UI. Aquí mostramos cómo el `Agent` de Ekairos consume la API, pero cualquier cliente que emita eventos compatibles funcionará.",
    path: "packages/web/src/app/test-agent/page.tsx",
    code: [
      '"use client"',
      "",
      'import { useCallback, Suspense } from "react"',
      'import { useSearchParams } from "next/navigation"',
      'import Agent from "@/components/ekairos/agent/Agent"',
      "",
      "function TestAgentContent() {",
      "  const searchParams = useSearchParams()",
      "",
      "  const handleContextUpdate = useCallback((contextId: string) => {",
      "    const params = new URLSearchParams(window.location.search)",
      "    if (contextId && contextId.length > 0) {",
      "      params.set(\"contextId\", contextId)",
      "    } else {",
      "      params.delete(\"contextId\")",
      "    }",
      "    const paramsString = params.toString()",
      "    let nextUrl = window.location.pathname",
      "    if (paramsString.length > 0) {",
      "      nextUrl = `${nextUrl}?${paramsString}`",
      "    }",
      "    window.history.replaceState({}, \"\", nextUrl)",
      "",
      "    console.log(\"[Test Agent] Context updated:\", contextId)",
      "  }, [])",
      "",
      "  const initialContextId = searchParams.get(\"contextId\") || undefined",
      "",
      "  return (",
      '    <div className="min-h-screen h-screen w-full">',
      "      <Agent",
      '        apiUrl="/api/test-agent"',
      "        onContextUpdate={handleContextUpdate}",
      "        toolComponents={{}}",
      "        initialContextId={initialContextId}",
      "      />",
      "    </div>",
      "  )",
      "}",
      "",
      "export default function TestAgentPage() {",
      "  return (",
      "    <Suspense",
      "      fallback={",
      '        <div className="min-h-screen h-screen flex items-center justify-center bg-background">',
      '          <div className="text-center">',
      '            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>',
      '            <p className="text-muted-foreground">Loading Ekairos Agent...</p>',
      "          </div>",
      "        </div>",
      "      }",
      "    >",
      "      <TestAgentContent />",
      "    </Suspense>",
      "  )",
      "}",
    ].join("\n"),
  },
]

const flowSteps = [
  {
    title: "1. Configuración con `createAgent()`",
    detail:
      "Definimos el contexto, prompt y herramientas mediante la API fluida sin genéricos. El builder produce el `AgentConfig` y la instancia final (`build()`).",
  },
  {
    title: "2. La API traduce a eventos",
    detail:
      "La función `createUserItemFromUIMessages` del route prepara un evento `user.message` compatible con `simpleAgent.progressStream`.",
  },
  {
    title: "3. El agente responde en streaming",
    detail:
      "`simpleAgent.progressStream` (definido en `packages/web/src/lib/agents/simple-agent.ts`) regresa un stream que `createUIMessageStreamResponse` transforma en SSE para el componente `Agent`.",
  },
]

const libraryHighlights = [
  {
    title: "Contexto tipado",
    description:
      "El callback `context()` del builder define y persiste estados arbitrarios (InstantDB, KV, etc.). Su return type alimenta automáticamente al resto de la cadena.",
  },
  {
    title: "Herramientas basadas en Zod",
    description:
      "Cada `tool` usa `inputSchema` para validar la carga útil. Esto genera JSON Schema automáticamente para AI SDK y evita prompts frágiles.",
  },
  {
    title: "Streams con control de progreso",
    description:
      "`progressStream(event, opts?)` retorna `{ stream, metadata }`. El stream es compatible con `ai` (`createUIMessageStreamResponse`) y conserva `contextKey` para reanudar conversaciones.",
  },
]

export default function EkairosLibDocPage() {
  return (
    <article className="space-y-12 text-foreground">
      <header className="space-y-3">
        <p className="text-[0.65rem] uppercase tracking-[0.35em] text-muted-foreground">
          Ekairos · Librería
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Flujo base de Ekairos Agent
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Referencia mínima de cómo integrar la librería tal cual se encuentra hoy: API
          route, configuración del agente y UI de prueba. Cada sección enlaza directamente con
          el archivo real dentro del monorepo.
        </p>
      </header>

      {sections.map((section) => (
        <section key={section.title} className="space-y-4">
          <div>
            <p className="text-[0.7rem] uppercase tracking-[0.4em] text-muted-foreground">
              {section.path}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
            <p className="text-muted-foreground">{section.description}</p>
          </div>
          <pre className="bg-card border border-border/80 rounded-xl p-4 text-sm overflow-x-auto">
            <code>{section.code}</code>
          </pre>
        </section>
      ))}

      <section className="space-y-4">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.4em] text-muted-foreground">
            Flujo completo
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">Resumen operacional</h2>
          <p className="text-muted-foreground">
            Estos pasos explican el pipeline sin modificar nada: ideal para validar antes de
            iterar nombres o comportamientos.
          </p>
        </div>
        <ol className="list-decimal pl-6 space-y-3 text-sm text-muted-foreground">
          {flowSteps.map((step) => (
            <li key={step.title}>
              <span className="text-foreground font-medium">{step.title}.</span> {step.detail}
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.4em] text-muted-foreground">
            Por qué usar la librería
          </p>
      <h2 className="text-2xl font-semibold tracking-tight">Conceptos clave de `ekairos/agent`</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {libraryHighlights.map((item) => (
            <div key={item.title} className="border border-border/80 rounded-xl p-4 bg-card h-full">
              <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
              <p className="text-sm text-muted-foreground mt-2">{item.description}</p>
            </div>
          ))}
        </div>
      </section>
    </article>
  )
}


