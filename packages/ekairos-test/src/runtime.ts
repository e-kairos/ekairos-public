import type { DomainSchemaResult } from "@ekairos/domain";
import {
  configureRuntime,
  getRuntimeConfig,
  type RuntimeResolver,
} from "@ekairos/domain/runtime";
import { createAppTestingDomain, ekairosTestDomain } from "./schema.js";

export type ResolveEkairosRuntime<
  Env extends Record<string, unknown> = Record<string, unknown>,
  Domain extends DomainSchemaResult = DomainSchemaResult,
  Runtime = unknown,
> = (params: { env: Env; domain: Domain }) => Promise<Runtime> | Runtime;

export type ComposeTestDomain = (params: {
  appDomain: DomainSchemaResult;
  testDomain: DomainSchemaResult;
  name?: string;
}) => DomainSchemaResult;

export type TestRuntimeParams<
  Env extends Record<string, unknown> = Record<string, unknown>,
> = {
  testDomain?: DomainSchemaResult;
  composedDomainName?: string;
  resolveRuntime: ResolveEkairosRuntime<Env, DomainSchemaResult, unknown>;
  shouldInject?: (params: { env: Env; domain: DomainSchemaResult }) => boolean;
  composeDomain?: ComposeTestDomain;
  runtimeDomain?: DomainSchemaResult;
};

function composeTestDomain(params: {
  appDomain: DomainSchemaResult;
  testDomain: DomainSchemaResult;
  name?: string;
  composeDomain?: ComposeTestDomain;
}): DomainSchemaResult {
  if (params.composeDomain) {
    return params.composeDomain({
      appDomain: params.appDomain,
      testDomain: params.testDomain,
      name: params.name,
    });
  }

  return createAppTestingDomain({
    appDomain: params.appDomain,
    testDomain: params.testDomain,
    name: params.name,
  });
}

export async function getEkairosRuntime<
  Env extends Record<string, unknown>,
  Domain extends DomainSchemaResult,
  Runtime,
>(params: {
  env: Env;
  domain: Domain;
  resolveRuntime: ResolveEkairosRuntime<Env, Domain, Runtime>;
}): Promise<Runtime> {
  if (!params.domain) {
    throw new Error("getEkairosRuntime requires an explicit domain.");
  }
  return await params.resolveRuntime({
    env: params.env,
    domain: params.domain,
  });
}

export async function getEkairosTestRuntime<
  Env extends Record<string, unknown>,
  Runtime,
>(params: {
  env: Env;
  appDomain: DomainSchemaResult;
  testDomain?: DomainSchemaResult;
  composedDomainName?: string;
  resolveRuntime: ResolveEkairosRuntime<Env, DomainSchemaResult, Runtime>;
  composeDomain?: ComposeTestDomain;
}): Promise<{ runtime: Runtime; domain: DomainSchemaResult }> {
  const domain = composeTestDomain({
    appDomain: params.appDomain,
    testDomain: params.testDomain ?? ekairosTestDomain,
    name: params.composedDomainName,
    composeDomain: params.composeDomain,
  });

  const runtime = await getEkairosRuntime({
    env: params.env,
    domain,
    resolveRuntime: params.resolveRuntime,
  });

  return { runtime, domain };
}

export function configureTestRuntime<
  Env extends Record<string, unknown> = Record<string, unknown>,
>(params: TestRuntimeParams<Env>): void {
  const testDomain = params.testDomain ?? ekairosTestDomain;

  const runtimeResolver: RuntimeResolver<Env> = async (env, domain) => {
    const appDomain = domain as DomainSchemaResult | null | undefined;
    if (!appDomain) {
      throw new Error(
        "configureTestRuntime requires runtime(domain, env) calls with an explicit domain."
      );
    }

    const shouldInject = params.shouldInject
      ? params.shouldInject({ env, domain: appDomain })
      : true;

    const resolvedDomain = shouldInject
      ? composeTestDomain({
          appDomain,
          testDomain,
          name: params.composedDomainName,
          composeDomain: params.composeDomain,
        })
      : appDomain;

    return await params.resolveRuntime({
      env,
      domain: resolvedDomain,
    });
  };

  const existing = getRuntimeConfig();
  configureRuntime({
    runtime: runtimeResolver,
    domain: {
      ...(existing ?? {}),
      domain: params.runtimeDomain ?? existing?.domain,
    },
  });
}
