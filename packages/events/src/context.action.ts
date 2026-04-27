import type { DomainSchemaResult } from "@ekairos/domain"
import type { z } from "zod"

import type { ContextEnvironment } from "./context.config.js"
import type { ContextToolExecuteContext } from "./context.engine.js"
import type { ContextRuntime } from "./context.runtime.js"
import { eventsDomain } from "./schema.js"

type MaybePromise<T> = T | Promise<T>

export type ContextActionSchema = z.ZodType

export type ContextActionBase = {
  type?: "function"
  description?: string
  providerOptions?: unknown
  auto?: boolean
}

export type ContextProviderDefinedAction = {
  type: "provider-defined"
  id: string
  name?: string
  args?: Record<string, unknown>
  auto?: boolean
}

export type ContextActionExecuteParams<
  TInput extends ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = ContextToolExecuteContext<Context, Env, RequiredDomain, Runtime> & {
  input: z.output<TInput>
}

export type DefineContextActionExecute<
  TInput extends ContextActionSchema,
  TOutput extends ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = (
  params: ContextActionExecuteParams<TInput, Context, Env, RequiredDomain, Runtime>,
) => MaybePromise<z.output<TOutput>>

export type ContextActionExecute<
  TInput extends ContextActionSchema,
  TOutput extends ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = DefineContextActionExecute<TInput, TOutput, Context, Env, RequiredDomain, Runtime>

export type LegacyContextActionExecute<
  TInput extends ContextActionSchema,
  TOutput extends ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = (
  input: z.output<TInput>,
  context: ContextToolExecuteContext<Context, Env, RequiredDomain, Runtime>,
) => MaybePromise<z.output<TOutput>>

export type DefineContextActionDefinition<
  TInput extends ContextActionSchema,
  TOutput extends ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = ContextActionBase & {
  input: TInput
  output: TOutput
  execute: DefineContextActionExecute<TInput, TOutput, Context, Env, RequiredDomain, Runtime>
}

export type LegacyContextActionDefinition<
  TInput extends ContextActionSchema,
  TOutput extends ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = ContextActionBase & {
  input: TInput
  output: TOutput
  execute: LegacyContextActionExecute<TInput, TOutput, Context, Env, RequiredDomain, Runtime>
}

export type ContextActionDefinition<
  TInput extends ContextActionSchema,
  TOutput extends ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = DefineContextActionDefinition<TInput, TOutput, Context, Env, RequiredDomain, Runtime>

export type ContextAction<
  TInput extends ContextActionSchema = ContextActionSchema,
  TOutput extends ContextActionSchema = ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> = ContextActionBase & {
  input: TInput
  output: TOutput
  inputSchema: TInput
  outputSchema: TOutput
  execute: LegacyContextActionExecute<TInput, TOutput, Context, Env, RequiredDomain, Runtime>
}

export type AnyContextAction = ContextAction<ContextActionSchema, ContextActionSchema, any, any, any, any>

export type ContextTool<
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
> =
  | ContextAction<ContextActionSchema, ContextActionSchema, Context, Env, RequiredDomain, Runtime>
  | ContextProviderDefinedAction

export type ContextActionInput<TAction> =
  TAction extends ContextAction<infer TInput, any, any, any>
    ? z.output<TInput>
    : never

export type ContextActionOutput<TAction> =
  TAction extends ContextAction<any, infer TOutput, any, any>
    ? z.output<TOutput>
    : never

function createContextAction<
  TInput extends ContextActionSchema,
  TOutput extends ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
>(
  definition: ContextActionBase & {
    input: TInput
    output: TOutput
  },
  invoke: (
    input: z.output<TInput>,
    context: ContextToolExecuteContext<Context, Env, RequiredDomain, Runtime>,
  ) => MaybePromise<z.output<TOutput>>,
): ContextAction<TInput, TOutput, Context, Env, RequiredDomain, Runtime> {
  const execute: LegacyContextActionExecute<TInput, TOutput, Context, Env, RequiredDomain, Runtime> = async (
    input,
    context,
  ) => {
    const parsedInput = definition.input.parse(input) as z.output<TInput>
    const result = await invoke(parsedInput, context)
    return definition.output.parse(result) as z.output<TOutput>
  }

  return {
    ...definition,
    inputSchema: definition.input,
    outputSchema: definition.output,
    execute,
  }
}

export function defineAction<
  TInput extends ContextActionSchema,
  TOutput extends ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
>(
  definition: DefineContextActionDefinition<TInput, TOutput, Context, Env, RequiredDomain, Runtime>,
): ContextAction<TInput, TOutput, Context, Env, RequiredDomain, Runtime> {
  return createContextAction(definition, async (input, context) =>
    await definition.execute({
      ...context,
      input,
    }),
  )
}

/**
 * @deprecated Use defineAction().
 */
export function action<
  TInput extends ContextActionSchema,
  TOutput extends ContextActionSchema,
  Context = any,
  Env extends ContextEnvironment = ContextEnvironment,
  RequiredDomain extends DomainSchemaResult = typeof eventsDomain,
  Runtime extends ContextRuntime<Env> = ContextRuntime<Env>,
>(
  definition: LegacyContextActionDefinition<TInput, TOutput, Context, Env, RequiredDomain, Runtime>,
): ContextAction<TInput, TOutput, Context, Env, RequiredDomain, Runtime> {
  return createContextAction(definition, async (input, context) =>
    await definition.execute(input, context),
  )
}
