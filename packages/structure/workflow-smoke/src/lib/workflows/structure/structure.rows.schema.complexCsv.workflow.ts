import { structure } from "@ekairos/structure";

export type StructureRowsSchemaComplexCsvWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
  fileId: string;
};

export async function structureRowsSchemaComplexCsvWorkflow(input: StructureRowsSchemaComplexCsvWorkflowInput) {
  "use workflow";

  const outputSchema = {
    title: "ProductRecord",
    description: "One row per product record.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        code: { type: "string" },
        description: { type: "string" },
        price: { type: "number" },
        categoryId: { type: "string" },
      },
      required: ["code", "description", "price", "categoryId"],
    },
  };

  const result = await structure(input.env, { datasetId: input.datasetId })
    .from({ kind: "file", fileId: input.fileId })
    .instructions(
      [
        "Transform the file deterministically:",
        "- Input is a CSV with headers code,description,price,categoryId,notes.",
        "- Output must match OutputSchema exactly.",
        "- Preserve row order.",
        "- Price normalization: strip '$' and commas, trim whitespace, parse as number.",
        "- Ignore the input column 'notes'.",
        "- Write output.jsonl to OutputPath.",
        "",
        "CRITICAL: Use executeCommand with Python and the csv module.",
      ].join("\n"),
    )
    .schema(outputSchema)
    .asRows()
    .build();

  return result;
}

