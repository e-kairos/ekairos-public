import type { QueryDomainStepInput, QueryDomainStepResult } from "./queryDomain.step"

export type QueryDomainInput = QueryDomainStepInput
export type QueryDomainResult = QueryDomainStepResult

/**
 * Workflow-compatible domain query.
 * Always returns a dataset + preview rows.
 */
export async function queryDomain(input: QueryDomainInput): Promise<QueryDomainResult> {
  "use step"
  const { queryDomainStep } = await import("./queryDomain.step")
  return await queryDomainStep(input)
}
