import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";

import {
  defineDomainAction,
  type DomainActionExecuteParams,
  workflow,
} from "../index";

type Env = {
  orgId: string;
};

type Runtime = {
  runtimeId: string;
};

type CreateSandboxInput = {
  sandboxId: string;
};

type SerializedSandbox = {
  version: 1;
  sandboxId: string;
};

class WorkflowSandbox {
  constructor(readonly sandboxId: string) {}

  static [WORKFLOW_SERIALIZE](instance: WorkflowSandbox): SerializedSandbox {
    return {
      version: 1,
      sandboxId: instance.sandboxId,
    };
  }

  static [WORKFLOW_DESERIALIZE](data: SerializedSandbox): WorkflowSandbox {
    return new WorkflowSandbox(data.sandboxId);
  }
}

// given: an action declares a workflow output contract for WorkflowSandbox.
const invalidExecute = async ({
  input,
}: DomainActionExecuteParams<Env, CreateSandboxInput, Runtime>): Promise<SerializedSandbox> => ({
  version: 1,
  sandboxId: input.sandboxId,
});

// when: execute returns the serialized state instead of the serde instance.
// then: defineDomainAction rejects the implementation at compile time.
// @ts-expect-error workflow output requires the serde instance, not its serialized state
defineDomainAction({
  description: "Invalid workflow output.",
  inputSchema: {} as unknown,
  output: workflow(WorkflowSandbox),
  execute: invalidExecute,
});
