import { structure } from "@ekairos/structure";

export type StructureObjectAutoTextWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
};

export async function structureObjectAutoTextWorkflow(input: StructureObjectAutoTextWorkflowInput) {
  "use workflow";

  const text = ["records=3", "currency=USD"].join("\n");

  const result = await structure(input.env, { datasetId: input.datasetId })
    .from({ kind: "text", text, mimeType: "text/plain", name: "meta.txt" })
    .instructions(
      [
        "Infer an output schema and then produce the final object result.",
        "Return EXACTLY this JSON object:",
        '{"recordCount":3,"currency":"USD"}',
        "CRITICAL: Call generateSchema first, then call complete.",
      ].join("\n"),
    )
    .auto()
    .asObject()
    .build();

  return result;
}

