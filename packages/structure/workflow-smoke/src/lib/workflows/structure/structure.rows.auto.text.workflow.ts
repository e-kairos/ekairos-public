import { structure } from "@ekairos/structure";

export type StructureRowsAutoTextWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
};

export async function structureRowsAutoTextWorkflow(input: StructureRowsAutoTextWorkflowInput) {
  "use workflow";

  const text = ["code,description,price", "A1,Widget,10.5", "A2,Gadget,20"].join("\n");

  const result = await structure(input.env, { datasetId: input.datasetId })
    .from({ kind: "text", text, mimeType: "text/csv", name: "sample.csv" })
    .instructions(
      [
        "Infer an output schema and then produce rows output.",
        "Output rows must be objects with fields code, description, price.",
        "CRITICAL: Write output.jsonl to OutputPath.",
        "CRITICAL: Call generateSchema first, then call complete.",
      ].join("\n"),
    )
    .auto()
    .asRows()
    .build();

  return result;
}

