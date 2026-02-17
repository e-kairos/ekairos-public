import { structure } from "@ekairos/structure";

export type StructureE2EWorkflowScenario =
  | "object_schema_text"
  | "object_auto_text"
  | "rows_schema_sample_csv"
  | "rows_schema_sample_pdf"
  | "rows_schema_complex_products_csv"
  | "rows_auto_text_csv"
  | "mixed_dataset_to_object"
  | "datasets_join_object_summary"
  | "trace_toolcalls";

export type StructureE2EWorkflowInput = {
  env: { orgId: string };
  datasetId: string;
  scenario: StructureE2EWorkflowScenario;
  fileId?: string;
  rowsDatasetId?: string;
  productsDatasetId?: string;
  categoriesDatasetId?: string;
};

export async function structureE2EWorkflow(input: StructureE2EWorkflowInput) {
  "use workflow";

  switch (input.scenario) {
    case "object_schema_text": {
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
        .instructions(
          [
            "Return EXACTLY this JSON object and nothing else:",
            '{"recordCount":3,"currency":"USD"}',
          ].join("\n"),
        )
        .schema(objectSchema)
        .asObject()
        .build();

      return { scenario: input.scenario, datasetId: input.datasetId, result };
    }

    case "object_auto_text": {
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

      return { scenario: input.scenario, datasetId: input.datasetId, result };
    }

    case "rows_schema_sample_csv": {
      if (!input.fileId) throw new Error("rows_schema_sample_csv requires fileId");

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

      return { scenario: input.scenario, datasetId: input.datasetId, result };
    }

    case "rows_schema_sample_pdf": {
      if (!input.fileId) throw new Error("rows_schema_sample_pdf requires fileId");

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
            "- Input is a PDF containing a CSV-like table with headers code,description,price.",
            "- Extract rows in order.",
            "- Output must match OutputSchema exactly.",
            "- Preserve row order.",
            "- Write output.jsonl to OutputPath.",
            "",
            "CRITICAL: Use executeCommand with Python (no external PDF libraries).",
            "CRITICAL: Read the PDF bytes from Sources[0].path and extract text by parsing PDF content stream literals.",
            "Hint: scan the bytes (latin-1) for patterns like '(...) Tj' and join those strings with newlines; then parse CSV lines.",
          ].join("\n"),
        )
        .schema(outputSchema)
        .asRows()
        .build();

      return { scenario: input.scenario, datasetId: input.datasetId, result };
    }

    case "rows_schema_complex_products_csv": {
      if (!input.fileId) throw new Error("rows_schema_complex_products_csv requires fileId");

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

      return { scenario: input.scenario, datasetId: input.datasetId, result };
    }

    case "rows_auto_text_csv": {
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

      return { scenario: input.scenario, datasetId: input.datasetId, result };
    }

    case "mixed_dataset_to_object": {
      if (!input.fileId) throw new Error("mixed_dataset_to_object requires fileId");
      if (!input.rowsDatasetId) throw new Error("mixed_dataset_to_object requires rowsDatasetId");

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

      return {
        scenario: input.scenario,
        datasetId: input.datasetId,
        rowsDatasetId: rowsRes.datasetId,
        rowsRes,
        objRes,
      };
    }

    case "datasets_join_object_summary": {
      if (!input.productsDatasetId) throw new Error("datasets_join_object_summary requires productsDatasetId");
      if (!input.categoriesDatasetId) throw new Error("datasets_join_object_summary requires categoriesDatasetId");

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

      return { scenario: input.scenario, datasetId: input.datasetId, summary };
    }

    case "trace_toolcalls": {
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

      return { scenario: input.scenario, datasetId: input.datasetId, result };
    }
  }
}

