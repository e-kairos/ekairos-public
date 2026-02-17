import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import App from './app.js';
import { createSession, loadSession, processAsyncStep } from './lib/session.js';
import { checkShadcnConfig, ensureEkairosRegistry, installComponent } from './lib/shadcn.js';
import { runDatasetCommand } from './lib/dataset.js';

const VALID_ACTIONS = new Set(['init-shadcn', 'update-all', 'install-essentials', 'exit']);

const cli = meow(
	`
	Usage
	  $ ekairos
	  $ ekairos dataset <command> [options]

	Options
		--async    Run in async/session mode
		--session  Session ID for continuing an async session
		--input    JSON input for the session step
		--action   Convenience flag for async actions (update-all, install-essentials, init-shadcn, exit)

	Examples
	  $ ekairos --async
	  $ ekairos --session <uuid> --input '{"action": "update-all"}'
	  $ ekairos dataset create --rows-file rows.jsonl --app-id <id> --admin-token <token>
`,
	{
		importMeta: import.meta,
		flags: {
			async: {
				type: 'boolean',
			},
			session: {
				type: 'string',
			},
			input: {
				type: 'string',
			},
			action: {
				type: 'string',
			},
			dev: {
				type: 'boolean',
				default: false,
			},
		},
	},
);

const [command, ...commandArgs] = cli.input;

async function runAddCommand(componentTarget?: string) {
	if (!componentTarget) {
		console.error('Please specify a component, e.g. npx ekairos@latest add @ekairos/agent');
		process.exit(1);
	}

	const hasConfig = await checkShadcnConfig();
	if (!hasConfig) {
		console.error('components.json not found. Run "npx shadcn@latest init" first.');
		process.exit(1);
	}

	try {
		await ensureEkairosRegistry();
		await installComponent(componentTarget);
		console.log(`✔ Installed ${componentTarget}`);
		process.exit(0);
	} catch (error) {
		console.error(error instanceof Error ? error.message : 'Installation failed');
		process.exit(1);
	}
}

async function run() {
	if (cli.flags.dev) {
		process.env.EKAIROS_REGISTRY_URL = 'http://localhost:3030/';
		console.log('Using local registry: http://localhost:3030/');
	}

	if (command === 'add') {
		await runAddCommand(commandArgs[0]);
		return;
	}

	if (command === 'dataset') {
		await runDatasetCommand(commandArgs);
		return;
	}

	if (cli.flags.async || cli.flags.session) {
		try {
			let state;
			let input = null;

			const tryParseActionString = (value: string | undefined) => {
				if (!value) return null;
				const trimmed = value.trim();
				return VALID_ACTIONS.has(trimmed) ? { action: trimmed } : null;
			};

			if (cli.flags.input) {
				try {
					input = JSON.parse(cli.flags.input);
				} catch (e) {
					input = tryParseActionString(cli.flags.input);
					if (!input) {
						console.error(JSON.stringify({ error: 'Invalid JSON input' }));
						process.exit(1);
					}
				}
			}

			if (!input && cli.flags.action) {
				const parsed = tryParseActionString(cli.flags.action);
				if (!parsed) {
					console.error(JSON.stringify({ error: 'Invalid action value' }));
					process.exit(1);
				}
				input = parsed;
			}

			if (cli.flags.session) {
				state = await loadSession(cli.flags.session);
				if (!state) {
					console.error(JSON.stringify({ error: 'Session not found or expired' }));
					process.exit(1);
				}
			} else {
				// New session
				state = await createSession();
			}

			const response = await processAsyncStep(state!, input);
			console.log(JSON.stringify(response, null, 2));
			process.exit(0);

		} catch (error) {
			console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
			process.exit(1);
		}
	} else {
		// Interactive Mode
		render(<App />);
	}
}

run();
