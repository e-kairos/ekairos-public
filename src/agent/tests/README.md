# Document Parser Tests

This directory contains tests for the document parser functionality.

## Required Test Files

To run the tests, you need to provide the following PDF files in this directory:

### 1. `sample-document.pdf`
- A simple PDF document with text content
- Used for basic parsing and idempotency tests
- Should contain at least one page with readable text

### 2. `document-with-tables.pdf`
- A PDF document containing tables
- Used to test table extraction with HTML output
- Should contain structured tabular data

## Running Tests

Make sure you have the following environment variables configured in `.env.local`:

```
NEXT_PUBLIC_INSTANT_APP_ID=your_instant_app_id
INSTANT_APP_ADMIN_TOKEN=your_instant_admin_token
LLAMA_CLOUD_API_KEY=your_llama_cloud_api_key
```

Run tests with:

```bash
pnpm test src/agent/tests/document-parser.test.ts
```

## Test Coverage

The test suite covers:

1. **Basic parsing**: Uploads a PDF and verifies it's parsed correctly
2. **Idempotency**: Ensures documents aren't reprocessed if they already exist
3. **Batch processing**: Tests processing multiple documents simultaneously
4. **Table extraction**: Verifies documents with tables are handled correctly

## Notes

- Tests use a 180-second timeout (3 minutes) for individual tests
- Batch processing test uses a 360-second timeout (6 minutes)
- Files are uploaded to `/tests/documents/` in InstantDB storage
- The parser uses LlamaCloud API with these features enabled:
  - `parse_page_with_llm`: Advanced page parsing
  - `high_res_ocr`: High-resolution OCR
  - `adaptive_long_table`: Better handling of long tables
  - `outlined_table_extraction`: Table structure extraction
  - `output_tables_as_HTML`: Tables formatted as HTML

