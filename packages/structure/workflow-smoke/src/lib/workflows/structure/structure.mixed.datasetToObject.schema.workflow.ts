import { structure } from "@ekairos/structure";

export type StructureMixedDatasetToObjectSchemaWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
  rowsDatasetId: string;
  fileId: string;
};

export async function structureMixedDatasetToObjectSchemaWorkflow(input: StructureMixedDatasetToObjectSchemaWorkflowInput) {
  "use workflow";

  const rowsSchema = {
    title: "ProductRecord",
    description: "One row per product record.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        code: { type: "string" },
        description: { type: "string" },
        price: { type: "number" },
      },
      required: ["code", "description", "price"],
    },
  };

  const rowsRes = await structure(input.env, { datasetId: input.rowsDatasetId })
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
    .schema(rowsSchema)
    .asRows()
    .build();

  const summarySchema = {
    title: "DatasetSummary",
    description: "Summary of the dataset.",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        recordCount: { type: "number" },
        minPrice: { type: "number" },
        maxPrice: { type: "number" },
      },
      required: ["recordCount", "minPrice", "maxPrice"],
    },
  };

  const objRes = await structure(input.env, { datasetId: input.datasetId })
    .from({ kind: "dataset", datasetId: rowsRes.datasetId })
    .instructions(
      [
        "Read the dataset source (JSONL rows).",
        "CRITICAL: Compute recordCount, minPrice, maxPrice over the row 'price' field by reading the dataset source file in the sandbox (do not guess, do not invent).",
        "CRITICAL: Use executeCommand to compute these values deterministically.",
        "Example Python (adapt paths from Sources):",
        "import json",
        "prices = []",
        "count = 0",
        "with open(SOURCE_PATH, 'r', encoding='utf-8') as f:",
        "  for line in f:",
        "    line = line.strip()",
        "    if not line: continue",
        "    rec = json.loads(line)",
        "    if rec.get('type') != 'row': continue",
        "    data = rec.get('data') or {}",
        "    p = data.get('price')",
        "    if isinstance(p, (int, float)):",
        "      prices.append(float(p))",
        "    count += 1",
        "result = {",
        "  'recordCount': count,",
        "  'minPrice': min(prices) if prices else 0,",
        "  'maxPrice': max(prices) if prices else 0,",
        "}",
        "Return ONLY the final JSON object. Then call complete.",
      ].join("\n"),
    )
    .schema(summarySchema)
    .asObject()
    .build();

  return objRes;
}

