import { AgentService, ContextIdentifier } from "../service"

export async function ensureContextStep(params: { key: string; context: ContextIdentifier | null }) {
  "use step"
  const service = new AgentService()

  const selector: ContextIdentifier | null = params.context
  const ctx = await service.getOrCreateContext<any>(selector ?? { key: params.key })
  return { contextId: ctx.id }
}

export async function buildSystemPromptStep(params: { contextId: string; narrative: string }) {
  "use step"
  // Por ahora el prompt es plano, concatenando narrativa y metadatos básicos de contexto
  // No modificar prompts de negocio existentes; este es un prompt genérico de Story
  const systemPrompt = `${params.narrative}\n\n[context]\ncontextId: ${params.contextId}`
  return systemPrompt
}


