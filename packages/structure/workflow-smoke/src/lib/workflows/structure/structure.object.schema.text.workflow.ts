import { structure } from "@ekairos/structure";

export type StructureObjectSchemaTextWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
};

export async function structureObjectSchemaTextWorkflow(input: StructureObjectSchemaTextWorkflowInput) {
  "use workflow";

  const objectSchema = {
    title: "FileSummary",
    description: "Simple summary object",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        recordCount: { type: "number", description: "Number of records" },
        currency: { type: "string", description: "Currency code" },
      },
      required: ["recordCount", "currency"],
    },
  };

  const text = ["records=3", "currency=USD"].join("\n");

  const result = await structure(input.env, { datasetId: input.datasetId })
    .from({ kind: "text", text, mimeType: "text/plain", name: "meta.txt" })
    .instructions(['Return EXACTLY this JSON object and nothing else:', '{"recordCount":3,"currency":"USD"}'].join("\n"))
    .schema(objectSchema)
    .asObject()
    .build();

  return result;
}

