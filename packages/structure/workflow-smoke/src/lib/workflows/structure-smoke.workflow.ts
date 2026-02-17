import { structure } from "@ekairos/structure";
import type { SandboxConfig } from "@ekairos/sandbox";

export type StructureSmokeWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
  sandboxConfig?: SandboxConfig;
};

export async function structureSmokeWorkflow(input: StructureSmokeWorkflowInput) {
  "use workflow";

  const objectSchema = {
    title: "SmokeObject",
    description: "Simple object output for workflow smoke test",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        recordCount: { type: "number" },
        currency: { type: "string" },
      },
      required: ["recordCount", "currency"],
    },
  };

  const text = ["records=3", "currency=USD"].join("\n");

  const result = await structure(input.env, { datasetId: input.datasetId, sandboxConfig: input.sandboxConfig })
    .from({ kind: "text", text, mimeType: "text/plain", name: "smoke.txt" })
    .instructions(
      [
        "Return EXACTLY this JSON object and nothing else:",
        "{\"recordCount\":3,\"currency\":\"USD\"}",
        "CRITICAL: Call complete.",
      ].join("\n"),
    )
    .schema(objectSchema)
    .asObject()
    .build();

  // IMPORTANT: workflow return values must be serializable.
  // `structure().build()` can include non-serializable helpers (e.g. reader.read).
  const value =
    (result as any)?.dataset?.content?.structure?.outputs?.object?.value ??
    (result as any)?.dataset?.content?.structure?.outputs?.object?.resultJson ??
    null;

  return {
    datasetId: input.datasetId,
    dataset: (result as any)?.dataset ?? null,
    value,
  };
}

