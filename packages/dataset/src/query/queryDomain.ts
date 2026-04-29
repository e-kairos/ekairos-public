import { queryDomainStep, type QueryDomainStepInput, type QueryDomainStepResult } from "./queryDomain.step.js"

export type QueryDomainInput = Omit<QueryDomainStepInput, "runtime">
export type QueryDomainResult = QueryDomainStepResult

/**
 * Workflow-compatible domain query.
 * Always returns a dataset + preview rows.
 */
export async function queryDomain(runtime: any, input: QueryDomainInput): Promise<QueryDomainResult> {
  "use step"
  return await queryDomainStep({ runtime, ...input })
}
