import { codexReactorShowcase } from "@/lib/examples/reactors/codex/definition";

export { codexReactorShowcase } from "@/lib/examples/reactors/codex/definition";
export type { ReactorShowcaseDefinition } from "@/lib/examples/reactors/types";

export const reactorShowcases = [codexReactorShowcase];

export function getReactorShowcaseBySlug(slug: string) {
  return reactorShowcases.find((showcase) => showcase.slug === slug) ?? null;
}
