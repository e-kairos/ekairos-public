// Plain build API using template literals and XML

import { create } from "xmlbuilder2"
import { FileParseStoryContext } from "./file-dataset.agent"
import { FilePreviewContext } from "./filepreview"
import { getDatasetWorkstation, getDatasetOutputPath } from "../datasetFiles"

function buildRole(): string {
    let xml = create()
        .ele("Role")
        .txt("You are a dataset creator for a SINGLE file. Your goal is to convert the file content into a validated JSONL dataset where each line represents one record.")
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildGoal(): string {
    let xml = create()
        .ele("Goal")
        .txt("Convert the source file into a validated JSONL dataset (output.jsonl) where each line is a JSON object conforming to a generated schema. The schema describes ONE data record structure. Extract ONLY data records; exclude any header sections, metadata, or summary information from the file.")
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildSourceInfo(context: FileParseStoryContext): any {
    let xml = create()
        .ele("Source")
        .ele("Type").txt("file").up()
        .ele("FileId").txt(context.fileId).up()
        .ele("DatasetId").txt(context.datasetId).up()
        .ele("FilePath").txt(context.sandboxConfig.filePath).up()
        .up()

    return xml
}

function buildFilePreviewSection(preview: FilePreviewContext): any {
    let xml = create()
        .ele("FilePreview")
        .ele("TotalRows").txt(String(preview.totalRows)).up()

    if (preview.metadata) {
        xml = xml.ele("Metadata")
            .ele("Description").txt(preview.metadata.description).up()

        if (preview.metadata.script) {
            xml = xml.ele("Script").txt(preview.metadata.script).up()
        }

        xml = xml.ele("Command").txt(preview.metadata.command).up()
            .ele("Stdout").txt(preview.metadata.stdout).up()

        if (preview.metadata.stderr && preview.metadata.stderr.trim().length > 0) {
            xml = xml.ele("Stderr").txt(preview.metadata.stderr).up()
        }

        xml = xml.up()
    }

    if (preview.head) {
        xml = xml.ele("Head")
            .ele("Description").txt(preview.head.description).up()

        if (preview.head.script) {
            xml = xml.ele("Script").txt(preview.head.script).up()
        }

        xml = xml.ele("Command").txt(preview.head.command).up()
            .ele("Stdout").txt(preview.head.stdout).up()

        if (preview.head.stderr && preview.head.stderr.trim().length > 0) {
            xml = xml.ele("Stderr").txt(preview.head.stderr).up()
        }

        xml = xml.up()
    }

    if (preview.tail) {
        xml = xml.ele("Tail")
            .ele("Description").txt(preview.tail.description).up()

        if (preview.tail.script) {
            xml = xml.ele("Script").txt(preview.tail.script).up()
        }

        xml = xml.ele("Command").txt(preview.tail.command).up()
            .ele("Stdout").txt(preview.tail.stdout).up()

        if (preview.tail.stderr && preview.tail.stderr.trim().length > 0) {
            xml = xml.ele("Stderr").txt(preview.tail.stderr).up()
        }

        xml = xml.up()
    }

    if (preview.mid) {
        xml = xml.ele("Mid")
            .ele("Description").txt(preview.mid.description).up()

        if (preview.mid.script) {
            xml = xml.ele("Script").txt(preview.mid.script).up()
        }

        xml = xml.ele("Command").txt(preview.mid.command).up()
            .ele("Stdout").txt(preview.mid.stdout).up()

        if (preview.mid.stderr && preview.mid.stderr.trim().length > 0) {
            xml = xml.ele("Stderr").txt(preview.mid.stderr).up()
        }

        xml = xml.up()
    }

    xml = xml.up()
    return xml
}

function buildErrorsSection(errors: string[]): any | null {
    if (errors.length === 0) {
        return null
    }

    let xml = create()
        .ele("PreviousErrors")

    for (const error of errors) {
        xml = xml.ele("Error").txt(error).up()
    }

    xml = xml.up()
    return xml
}

function buildContextSection(context: FileParseStoryContext): string {
    let xml = create()
        .ele("Context")

    const sourceXml = buildSourceInfo(context)
    xml = xml.import(sourceXml.first())

    if (context.filePreview) {
        const previewXml = buildFilePreviewSection(context.filePreview)
        xml = xml.import(previewXml.first())
    }

    if (context.errors.length > 0) {
        const errorsXml = buildErrorsSection(context.errors)
        if (errorsXml) {
            xml = xml.import(errorsXml.first())
        }
    }

    xml = xml.up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildSchemaSection(context: FileParseStoryContext): string {
    if (!context.schema) {
        return ""
    }

    let xml = create()
        .com("Schema section: This defines the structure of ONE RECORD (row). Each line in the JSONL output must conform to this schema.")
        .ele("Schema")
        .ele("Title").txt(context.schema.title || "").up()
        .ele("Description").txt(context.schema.description || "").up()
        .ele("JsonSchema").txt(JSON.stringify(context.schema.schema, null, 2)).up()
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

function buildInstructions(context: FileParseStoryContext): string {
    const datasetWorkstation = getDatasetWorkstation(context.datasetId)
    const outputPath = getDatasetOutputPath(context.datasetId)


    const currentTask = "Review FilePreview section to understand file structure, then generate JSON Schema for a SINGLE RECORD, then parse the file and generate the dataset"

    let xml = create()
        .ele("Instructions")
        .ele("Workflow")
        .ele("Step", { number: "1", name: "Inspect File" })
        .ele("Action").txt("Review the FilePreview section in Context to understand the file structure").up()
        .ele("Note").txt("FilePreview contains: TotalRows (total data rows), Metadata (file properties with JSON output), Head (first N raw file lines), Tail (last N lines if present), Mid (middle sample for large files). Each section shows Description, Script (full Python code), Command, Stdout (raw content), Stderr. This allows you to understand the exact file format.").up()
        .up()
        .ele("Step", { number: "2", name: "Generate JSON Schema" })
        .ele("Action").txt("Call generateSchema to create a JSON Schema for a SINGLE DATA RECORD (one row of data)").up()
        .ele("Requirements")
        .ele("Requirement").txt("Schema describes ONE DATA RECORD structure only (type: object, not array)").up()
        .ele("Requirement").txt("Schema represents data records ONLY, not header sections or metadata").up()
        .ele("Requirement").txt("All property names must be lowercaseCamelCase").up()
        .ele("Requirement").txt("Include all data columns/fields from records, exclude header fields").up()
        .ele("Requirement").txt("Define correct data types for each field").up()
        .up()
        .up()
        .ele("Step", { number: "3", name: "Generate Dataset JSONL" })
        .ele("Action").txt(`Use executeCommand to parse the file and generate output.jsonl in the dataset workstation`).up()
        .ele("Requirements")
        .ele("Requirement").txt("Parse ALL data rows/records from the file (exclude header sections and metadata)").up()
        .ele("Requirement").txt("Output JSONL format: each line is {\"type\": \"row\", \"data\": {...record...}}").up()
        .ele("Requirement").txt("Extract ONLY data records; skip any header lines, summary sections, or file metadata").up()
        .ele("Requirement").txt(`Save output to: ${outputPath}`).up()
        .ele("Requirement").txt("Use descriptive scriptName in snake_case (e.g., 'parse_csv_to_jsonl')").up()
        .up()
        .up()
        .ele("Step", { number: "4", name: "Complete and Validate" })
        .ele("Action").txt("Call completeDataset to validate the dataset").up()
        .ele("Behavior").txt("Validates that output.jsonl exists and all records conform to the schema stored in database. Returns error details if validation fails.").up()
        .up()
        .up()
        .ele("Rules")
        .ele("Rule").txt("Schema defines ONE DATA RECORD structure (not array, not header)").up()
        .ele("Rule").txt("Datasets contain ONLY data records; exclude all header sections and file metadata").up()
        .ele("Rule").txt("JSONL format: each line = separate JSON object representing one data record").up()
        .ele("Rule").txt("FilePreview shows raw file content - use Script to understand data extraction").up()
        .ele("Rule").txt("Use executeCommand for parsing and file generation").up()
        .ele("Rule").txt(`Each dataset has its own isolated workstation: ${datasetWorkstation}`).up()
        .ele("Rule").txt(`Required output: ${outputPath}`).up()
        .ele("Rule").txt("Schema is stored in database (dataset_datasets table), not in files").up()
        .up()
        .ele("CurrentTask").txt(currentTask).up()
        .up()

    return xml.end({ prettyPrint: true, headless: true })
}

export function buildFileDatasetPrompt(context: FileParseStoryContext): string {
    const sections: string[] = []

    sections.push(buildRole())
    sections.push("")
    sections.push(buildGoal())
    sections.push("")
    sections.push(buildContextSection(context))
    sections.push("")
    sections.push(buildInstructions(context))

    return sections.join("\n")
}

