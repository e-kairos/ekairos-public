import React, { useState, useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { createRequire } from 'module';
import { checkShadcnConfig, ensureEkairosRegistry, getInstalledComponents, installComponent, initShadcn } from './lib/shadcn.js';
import { getRegistryUrl } from './lib/config.js';

const require = createRequire(import.meta.url);
const { version: CLI_VERSION = 'dev' } = require('../package.json') as { version?: string };

const REGISTRY_URL = getRegistryUrl();

type Step = 'check-config' | 'init-shadcn' | 'check-installed' | 'prompt-action' | 'installing' | 'success' | 'error';

interface AppState {
  step: Step;
  message: string;
  installedComponents: string[];
  error?: string;
}

export default function App() {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>({
    step: 'check-config',
    message: 'Checking configuration...',
    installedComponents: []
  });

  useEffect(() => {
    const init = async () => {
      try {
        // 1. Check Shadcn Config
        const hasConfig = await checkShadcnConfig();
        if (!hasConfig) {
          // Prompt for init
           setState(s => ({ ...s, step: 'init-shadcn', message: 'components.json not found.' }));
          return;
        }

        await runScan();

      } catch (err) {
        setState(s => ({ ...s, step: 'error', error: err instanceof Error ? err.message : 'Unknown error' }));
      }
    };

    if (state.step === 'check-config') {
         init();
    }
  }, [state.step]); // Dependency on step to retry after init

  const runScan = async () => {
        // 2. Ensure Registry Config
        await ensureEkairosRegistry();

        // 3. Check Installed Components
        setState(s => ({ ...s, step: 'check-installed', message: 'Scanning installed components...' }));
        const installed = await getInstalledComponents();
        
        setState({
          step: 'prompt-action',
          message: installed.length > 0 
            ? `Found ${installed.length} Ekairos components.` 
            : 'No Ekairos components found.',
          installedComponents: installed,
          error: undefined
        });
  };

  const handleSelect = async (item: { value: string }) => {
    if (item.value === 'init-shadcn') {
        try {
            setState(s => ({ ...s, message: 'Initializing shadcn...' }));
            await initShadcn();
            // After init, check again
            setState(s => ({ ...s, step: 'check-config' }));
        } catch (err) {
             setState(s => ({ ...s, step: 'error', error: 'Failed to initialize shadcn.' }));
        }
    } else if (item.value === 'update-all' || item.value === 'install-essentials') {

      setState(s => ({ ...s, step: 'installing', message: 'Running shadcn...' }));
      
      try {
        const componentsToInstall = item.value === 'update-all' 
          ? state.installedComponents 
          : ['ekairos-agent-Agent']; // Default Ekairos agent bundle from registry

        // Dedup and ensure prefix
        const targets = [...new Set(componentsToInstall)].map(c => 
          c.startsWith('@ekairos/') ? c : `@ekairos/${c}`
        );

        if (targets.length === 0) {
             // Fallback if update-all called but nothing detected, force main agent bundle
             targets.push('@ekairos/ekairos-agent-Agent');
        }

        for (const component of targets) {
            setState(s => ({ ...s, message: `Installing ${component}...` }));
            await installComponent(component);
        }

        setState(s => ({ ...s, step: 'success', message: 'All operations completed successfully!' }));
        setTimeout(() => exit(), 2000);

      } catch (err) {
        setState(s => ({ ...s, step: 'error', error: err instanceof Error ? err.message : 'Installation failed' }));
      }
    } else if (item.value === 'exit') {
      exit();
    }
  };

  const options = state.step === 'init-shadcn'
    ? [
        { label: 'Initialize shadcn project', value: 'init-shadcn' },
        { label: 'Exit', value: 'exit' }
      ]
    : state.installedComponents.length > 0
    ? [
        { label: 'Update all components', value: 'update-all' },
        { label: 'Exit', value: 'exit' }
      ]
    : [
        { label: 'Install Ekairos Essentials (Agent)', value: 'install-essentials' },
        { label: 'Exit', value: 'exit' }
      ];

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="cyan">Ekairos CLI v{CLI_VERSION}</Text>
        <Text color="gray">using registry: {REGISTRY_URL}</Text>
      </Box>

      {(state.step === 'check-config' || state.step === 'check-installed' || state.step === 'installing') && (
        <Box>
          <Text color="green"><Spinner type="dots" /> </Text>
          <Text>{state.message}</Text>
        </Box>
      )}

      {(state.step === 'prompt-action' || state.step === 'init-shadcn') && (
        <Box flexDirection="column">
          <Text marginBottom={1}>{state.message}</Text>
          <Text>What would you like to do?</Text>
          <SelectInput items={options} onSelect={handleSelect} />
        </Box>
      )}

      {state.step === 'success' && (
        <Box>
          <Text color="green">✔ {state.message}</Text>
        </Box>
      )}

      {state.step === 'error' && (
        <Box>
           <Text color="red">✖ Error: {state.error}</Text>
        </Box>
      )}
    </Box>
  );
}

