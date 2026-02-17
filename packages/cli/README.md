# Ekairos CLI

The official CLI for managing Ekairos UI components and agents.

## Features

- **Interactive UI**: Built with Ink (React for CLI).
- **Auto-Configuration**: Automatically configures `components.json` for the Ekairos registry.
- **Component Management**: Detects installed components and offers bulk updates.
- **Seamless Integration**: Wraps `shadcn` CLI to ensure consistent installations.
- **Async/Session Mode**: Designed for AI agents and automation.

## Usage

Run the CLI in your project root:

```bash
npx ekairos@latest
```

### AI / Automation Mode

For automated interactions, use the `--async` flag. The CLI will output JSON state and exit, allowing you to resume the session with inputs.

1. **Start Session**:
   ```bash
   npx ekairos --async
   ```
   Output:
   ```json
   {
     "sessionId": "uuid...",
     "step": "MENU",
     "inputSchema": { ... }
   }
   ```

2. **Continue Session**:
   ```bash
   npx ekairos --session <uuid> --input '{"action": "update-all"}'
   ```

## Development

To run locally against a local registry:

1. Start the registry server (`packages/registry`).
2. Build the CLI:
   ```bash
   pnpm --filter ekairos build
   ```
3. Run with override:
   ```bash
   EKAIROS_REGISTRY_URL="http://localhost:3001" node packages/cli/dist/index.mjs
   ```
