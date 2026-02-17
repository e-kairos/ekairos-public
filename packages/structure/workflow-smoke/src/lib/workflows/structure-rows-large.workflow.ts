import { structure } from "@ekairos/structure";

export type StructureRowsLargeWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
};

function buildLargeText(params: { header: string; targetBytes: number; filler: string }) {
  const lines: string[] = [params.header];
  let bytes = lines[0].length + 1;
  while (bytes < params.targetBytes) {
    lines.push(params.filler);
    bytes += params.filler.length + 1;
  }
  return { text: lines.join("\n"), bytes };
}

export async function structureRowsLargeWorkflow(input: StructureRowsLargeWorkflowInput) {
  "use workflow";

  const startedAt = Date.now();
  console.log(`STRUCTURE_LARGE_WORKFLOW_START=${new Date(startedAt).toISOString()}`);

  const header = [
    "code,description,price",
    "A1,Widget,10.5",
    "A2,Gadget,20",
    "A3,Thing,30.25",
  ].join("\n");

  const { text, bytes } = buildLargeText({
    header,
    targetBytes: 512 * 1024,
    filler: "lorem ipsum dolor sit amet, consectetur adipiscing elit",
  });

  console.log(`STRUCTURE_LARGE_INPUT_BYTES=${bytes}`);

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
    .from({ kind: "text", text, mimeType: "text/plain", name: "large.txt" })
    .instructions(
      [
        "Transform the file deterministically:",
        "- Input is a CSV with header: code,description,price.",
        "- Ignore any subsequent filler lines.",
        "- Output must match OutputSchema exactly.",
        "- Preserve row order.",
        "- Write output.jsonl to OutputPath.",
      ].join("\n"),
    )
    .schema(outputSchema)
    .asRows()
    .build();

  const finishedAt = Date.now();
  console.log(`STRUCTURE_LARGE_WORKFLOW_END=${new Date(finishedAt).toISOString()}`);
  console.log(`STRUCTURE_LARGE_WORKFLOW_ELAPSED_MS=${finishedAt - startedAt}`);

  return {
    datasetId: input.datasetId,
    dataset: (result as any)?.dataset ?? null,
    expectedRows: 3,
    inputBytes: bytes,
  };
}
