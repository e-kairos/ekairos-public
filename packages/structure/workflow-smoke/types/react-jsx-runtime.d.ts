// Minimal JSX runtime typings for workflow-smoke build.
// NOTE: This exists only to unblock `next build` in this harness.
// Prefer installing proper `@types/react` / `@types/react-dom` when pnpm patch config allows.

declare module "react/jsx-runtime" {
  export const Fragment: any;
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;

  export namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Element {}
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}

declare module "react/jsx-dev-runtime" {
  export const Fragment: any;
  export function jsxDEV(type: any, props: any, key?: any, isStaticChildren?: any, source?: any, self?: any): any;

  export namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Element {}
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}

