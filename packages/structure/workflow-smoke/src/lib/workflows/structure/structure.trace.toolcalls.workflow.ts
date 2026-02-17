import { structure } from "@ekairos/structure";

export type StructureTraceToolcallsWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
};

export async function structureTraceToolcallsWorkflow(input: StructureTraceToolcallsWorkflowInput) {
  "use workflow";

  const objectSchema = {
    title: "TraceObj",
    description: "Trace object",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ok: { type: "boolean" },
      },
      required: ["ok"],
    },
  };

  const result = await structure(input.env, { datasetId: input.datasetId })
    .from({ kind: "text", text: "ok=true", mimeType: "text/plain", name: "trace.txt" })
    .instructions('Return only {"ok":true} and call complete.')
    .schema(objectSchema)
    .asObject()
    .build();

  return result;
}

