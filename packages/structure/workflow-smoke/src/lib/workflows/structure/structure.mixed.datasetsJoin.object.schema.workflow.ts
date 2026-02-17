import { structure } from "@ekairos/structure";

export type StructureMixedDatasetsJoinObjectSchemaWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
  productsDatasetId: string;
  categoriesDatasetId: string;
};

export async function structureMixedDatasetsJoinObjectSchemaWorkflow(input: StructureMixedDatasetsJoinObjectSchemaWorkflowInput) {
  "use workflow";

  const summarySchema = {
    title: "JoinSummary",
    description: "Deterministic summary over joined datasets.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        totalProducts: { type: "number" },
        categories: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              categoryName: { type: "string" },
              count: { type: "number" },
              avgPrice: { type: "number" },
            },
            required: ["categoryName", "count", "avgPrice"],
          },
          allOf: [
            { contains: { type: "object", properties: { categoryName: { const: "Hardware" } }, required: ["categoryName"] } },
            { contains: { type: "object", properties: { categoryName: { const: "Software" } }, required: ["categoryName"] } },
          ],
        },
      },
      required: ["totalProducts", "categories"],
    },
  };

  const summary = await structure(input.env, { datasetId: input.datasetId })
    .from({ kind: "dataset", datasetId: input.productsDatasetId }, { kind: "dataset", datasetId: input.categoriesDatasetId })
    .instructions(
      [
        "You have two dataset Sources:",
        "- products dataset (rows) with fields: code, description, price, categoryId",
        "- categories dataset (rows) with fields: categoryId, categoryName",
        "",
        "CRITICAL: Use executeCommand (python) ONCE to read BOTH JSONL source files from Sources paths.",
        "Process (no guessing):",
        "- Identify which Source is products and which is categories (by inspecting their row fields).",
        "- Read JSONL line-by-line; only keep records where type == 'row' and use record.data as the row object.",
        "- Build a map categoryId -> categoryName from the categories dataset.",
        "- Aggregate products by categoryName (join on categoryId): count and average price.",
        "- Set totalProducts to the total number of product rows.",
        "- Output categories sorted by categoryName ascending.",
        "CRITICAL: Immediately after computing the object, call complete with resultJson (inline JSON). Do not do anything else.",
      ].join("\n"),
    )
    .schema(summarySchema)
    .asObject()
    .build();

  return summary;
}

