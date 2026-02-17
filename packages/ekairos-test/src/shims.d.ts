declare module "@playwright/test/reporter" {
  export type Reporter = any;
  export type TestCase = any;
  export type TestResult = any;
  export type Suite = any;
}

declare module "vitest" {
  export type Reporter = any;
}

declare module "workflow/api" {
  export function resumeHook(token: string, data?: unknown): Promise<any>;
  export function getRun<TResult = any>(
    runId: string
  ): { status: Promise<string>; returnValue: Promise<TResult> };
}
