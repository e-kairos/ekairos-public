import { structure } from "@ekairos/structure";

export type StructureRowsSchemaSampleCsvWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
  fileId: string;
};

export async function structureRowsSchemaSampleCsvWorkflow(input: StructureRowsSchemaSampleCsvWorkflowInput) {
  "use workflow";

  const outputSchema = {
    title: "ProductRecord",
    description: "One row per product record.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        code: { type: "string", description: "Product code" },
        description: { type: "string", description: "Product description" },
        price: { type: "number", description: "Unit price" },
      },
      required: ["code", "description", "price"],
    },
  };

  const result = await structure(input.env, { datasetId: input.datasetId })
    .from({ kind: "file", fileId: input.fileId })
    .instructions(
      [
        "Transform the file deterministically:",
        "- Input is a CSV with headers code,description,price.",
        "- Output must match OutputSchema exactly.",
        "- Preserve row order.",
        "- Write output.jsonl to OutputPath.",
      ].join("\n"),
    )
    .schema(outputSchema)
    .asRows()
    .build();

  return result;
}

