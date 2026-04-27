import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";

import {
  defineDomainAction,
  type DomainActionExecuteParams,
  type DomainActionOutput,
  type DomainActionSerializedOutput,
  workflow,
} from "../index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type Expect<T extends true> = T;

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

// given: a domain action whose declared output is a workflow-serializable
// instance.
const createSandbox = defineDomainAction({
  description: "Create a workflow-serializable sandbox.",
  inputSchema: {} as unknown,
  output: workflow(WorkflowSandbox),
  async execute({ input }: DomainActionExecuteParams<Env, CreateSandboxInput, Runtime>) {
    return new WorkflowSandbox(input.sandboxId);
  },
});

// when: helper types extract runtime and serialized outputs.
type CreateSandboxRuntimeOutput = DomainActionOutput<typeof createSandbox>;
type CreateSandboxSerializedOutput = DomainActionSerializedOutput<typeof createSandbox>;

// then: runtime output is the serde instance, while serialized output is the
// state that crosses workflow boundaries.
type CreateSandboxRuntimeOutputIsInstance = Expect<
  Equal<CreateSandboxRuntimeOutput, WorkflowSandbox>
>;
type CreateSandboxSerializedOutputIsState = Expect<
  Equal<CreateSandboxSerializedOutput, SerializedSandbox>
>;
