import { workflow } from "../index";

class MissingWorkflowSerde {
  constructor(readonly sandboxId: string) {}
}

// given: a class that does not implement the @workflow/serde static methods.
// when: it is used as a workflow output contract.
// then: workflow() rejects it because workflow outputs must be serializable
// across workflow steps.
// @ts-expect-error workflow output requires @workflow/serde static methods
workflow(MissingWorkflowSerde);
