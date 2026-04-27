import {
  defineDomainAction,
  type DomainActionExecuteParams,
  type DomainActionSerializedOutput,
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

// given: a normal domain action with no workflow output contract.
const normalAction = defineDomainAction({
  description: "Return normal JSON-like data.",
  inputSchema: {} as unknown,
  execute(_params: DomainActionExecuteParams<Env, CreateSandboxInput, Runtime>) {
    return { ok: true as const };
  },
});

// when: serialized output is extracted from that normal action.
type NormalSerializedOutput = DomainActionSerializedOutput<typeof normalAction>;

// then: the serialized output is just the runtime output because no serde
// boundary is declared.
type NormalSerializedOutputIsRuntimeOutput = Expect<
  Equal<NormalSerializedOutput, { ok: true }>
>;
