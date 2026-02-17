import { create } from "xmlbuilder2"

export type TransformPromptContext = {
    datasetId: string
    sourceDatasetIds: string[]
    outputSchema: any
    sandboxConfig: {
        sourcePaths: Array<{ datasetId: string; path: string }>
        outputPath: string
    }
    sourcePreviews?: Array<{
        datasetId: string
        preview: {
            totalRows: number
            metadata?: {
                description: string
                script: string
                command: string
                stdout: string
                stderr: string
            }
            head?: {
                description: string
                script: string
                command: string
                stdout: string
                stderr: string
            }
        }
    }>
    errors: string[]
}

function buildRole(): string {
    let xml = create()
        .ele("Role")
        .txt("You are a dataset transformer. Your goal is to read one or more existing JSONL datasets and produce a NEW JSONL dataset whose records conform exactly to the provided output schema.")
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildGoal(): string {
    let xml = create()
        .ele("Goal")
        .txt("Transform the source dataset(s) (JSONL with {type:'row', data:{...}} per line) into a new dataset strictly matching the output schema. Save to output.jsonl in the dataset workstation. Each line must remain a single JSON object representing one record. You may need to combine, filter, or reshape data from multiple source datasets.")
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildContextSection(context: TransformPromptContext): string {
    let xml = create()
        .ele("Context")
        .ele("DatasetId").txt(context.datasetId).up()

    let sourcesXml = create().ele("SourceDatasets")
    for (const sourceId of context.sourceDatasetIds) {
        sourcesXml = sourcesXml.ele("SourceDatasetId").txt(sourceId).up()
    }
    xml = xml.import(sourcesXml.first())

    let sandboxXml = create().ele("Sandbox")
    for (const sourcePathInfo of context.sandboxConfig.sourcePaths) {
        sandboxXml = sandboxXml.ele("SourceFile")
            .ele("DatasetId").txt(sourcePathInfo.datasetId).up()
            .ele("Path").txt(sourcePathInfo.path).up()
            .up()
    }
    sandboxXml = sandboxXml.ele("OutputPath").txt(context.sandboxConfig.outputPath).up()
    xml = xml.import(sandboxXml.first())

    if (context.sourcePreviews && context.sourcePreviews.length > 0) {
        let previewsXml = create().ele("SourcePreviews")
        for (const sourcePreviewInfo of context.sourcePreviews) {
            const sp = sourcePreviewInfo.preview
            let px = create().ele("SourcePreview")
                .ele("DatasetId").txt(sourcePreviewInfo.datasetId).up()
                .ele("TotalRows").txt(String(sp.totalRows)).up()

            if (sp.metadata) {
                const m = sp.metadata
                px = px.ele("Metadata")
                    .ele("Description").txt(m.description).up()
                    .ele("Script").txt(m.script).up()
                    .ele("Command").txt(m.command).up()
                    .ele("Stdout").txt(m.stdout).up()
                if (m.stderr && m.stderr.trim().length > 0) {
                    px = px.ele("Stderr").txt(m.stderr).up()
                }
                px = px.up()
            }

            if (sp.head) {
                const h = sp.head
                px = px.ele("Head")
                    .ele("Description").txt(h.description).up()
                    .ele("Script").txt(h.script).up()
                    .ele("Command").txt(h.command).up()
                    .ele("Stdout").txt(h.stdout).up()
                if (h.stderr && h.stderr.trim().length > 0) {
                    px = px.ele("Stderr").txt(h.stderr).up()
                }
                px = px.up()
            }

            px = px.up()
            previewsXml = previewsXml.import(px.first())
        }
        xml = xml.import(previewsXml.first())
    }

    if (Array.isArray(context.errors) && context.errors.length > 0) {
        let ex = create().ele("PreviousErrors")
        for (const e of context.errors) {
            ex = ex.ele("Error").txt(e).up()
        }
        xml = xml.import(ex.first())
    }

    xml = xml.up()
    return xml.end({ prettyPrint: true, headless: true })
}

function buildOutputSchemaSection(context: TransformPromptContext): string {
    let xml = create()
        .ele("OutputSchema")
        .ele("JsonSchema").txt(JSON.stringify(context.outputSchema?.schema ?? context.outputSchema ?? {}, null, 2)).up()
        .up()
    return xml.end({ prettyPrint: true, headless: true })
}

function buildInstructions(context: TransformPromptContext): string {
    const outputPath = context.sandboxConfig.outputPath
    const multipleSourcesNote = context.sourceDatasetIds.length > 1 
        ? "You have multiple source datasets available. You may need to read, join, filter, or combine data from them to produce the output." 
        : ""

    let xml = create()
        .ele("Instructions")
        .ele("Workflow")
        .ele("Step", { number: "1", name: "Inspect Source" })
        .ele("Action").txt(`Review SourcePreviews to understand current record structures (data fields, shapes, edge cases). ${multipleSourcesNote}`).up()
        .up()
        .ele("Step", { number: "2", name: "Plan Mapping" })
        .ele("Action").txt("Plan a deterministic mapping from source data fields to the output schema fields (normalize names, types, and formats).").up()
        .ele("Note").txt("If fields are missing, set defaults; if types differ, coerce consistently. When working with multiple sources, decide how to combine or relate them.").up()
        .up()
        .ele("Step", { number: "3", name: "Transform" })
        .ele("Action").txt("Use executeCommand to run a Python script that reads source JSONL file(s) and writes transformed records to output.jsonl. Keep line-per-record JSON objects with { 'type': 'row', 'data': { ... } }.").up()
        .ele("Requirement").txt(`Write file to: ${outputPath}`).up()
        .ele("Requirement").txt("Do not print large data to stdout; only progress and summaries.").up()
        .up()
        .ele("Step", { number: "4", name: "Validate and Complete" })
        .ele("Action").txt("Call completeDataset to validate against the output schema and mark as completed.").up()
        .up()
        .up()
        .ele("Rules")
        .ele("Rule").txt("Output must strictly match the output schema for each record in data.").up()
        .ele("Rule").txt("Each line in output.jsonl must be a standalone JSON object with {type:'row', data:{...}}.").up()
        .ele("Rule").txt("Do not include headers, summaries, or metadata as records.").up()
        .ele("Rule").txt("Be robust to malformed lines in source: skip or sanitize, but do not crash.").up()
        .up()
        .ele("CurrentTask").txt("Transform source dataset(s) to match OutputSchema and write output.jsonl, then complete.").up()
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

export function buildTransformDatasetPrompt(context: TransformPromptContext): string {
    const sections: string[] = []
    sections.push(buildRole())
    sections.push("")
    sections.push(buildGoal())
    sections.push("")
    sections.push(buildContextSection(context))
    sections.push("")
    sections.push(buildOutputSchemaSection(context))
    sections.push("")
    sections.push(buildInstructions(context))
    return sections.join("\n")
}


