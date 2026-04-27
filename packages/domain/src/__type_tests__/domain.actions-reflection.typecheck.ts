import { i } from "@instantdb/core";

import { defineDomainAction, domain, type DomainActionsOf } from "../index.ts";

const reflectedDomain = domain("typed-action-reflection")
  .withSchema({
    entities: {
      typed_action_tasks: i.entity({
        title: i.string(),
      }),
    },
    links: {},
    rooms: {},
  })
  .withActions({
    getSandbox: defineDomainAction<
      Record<string, unknown>,
      { sandboxId: string },
      { id: string }
    >({
      name: "typedActionReflection.getSandbox",
      execute: async ({ input }) => ({ id: input.sandboxId }),
    }),
  });

const reflectedActions: DomainActionsOf<typeof reflectedDomain> = reflectedDomain.actions;

reflectedActions.getSandbox.execute({
  env: {},
  input: { sandboxId: "sandbox_1" },
  runtime: {},
});

// @ts-expect-error action keys are the literal keys declared in withActions().
reflectedActions.missingSandbox;

reflectedActions.getSandbox.execute({
  env: {},
  // @ts-expect-error action inputs keep the declared shape.
  input: { wrong: "sandbox_1" },
  runtime: {},
});
