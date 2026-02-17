import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { checkShadcnConfig, ensureEkairosRegistry, getInstalledComponents, initShadcn, installComponent } from './shadcn.js';

export interface SessionState {
    sessionId: string;
    step: 'INIT' | 'MENU' | 'INSTALLING' | 'SUCCESS' | 'ERROR';
    installedComponents: string[];
    message?: string;
    error?: string;
}

const TMP_DIR = path.join(os.tmpdir(), 'ekairos-cli-sessions');

export async function createSession(): Promise<SessionState> {
    const sessionId = crypto.randomUUID();
    const state: SessionState = {
        sessionId,
        step: 'INIT',
        installedComponents: []
    };
    await saveSession(state);
    return state;
}

export async function loadSession(sessionId: string): Promise<SessionState | null> {
    const filePath = path.join(TMP_DIR, `${sessionId}.json`);
    if (!await fs.pathExists(filePath)) return null;
    return fs.readJson(filePath);
}

export async function saveSession(state: SessionState) {
    await fs.ensureDir(TMP_DIR);
    const filePath = path.join(TMP_DIR, `${state.sessionId}.json`);
    await fs.writeJson(filePath, state, { spaces: 2 });
}

export async function deleteSession(sessionId: string) {
    const filePath = path.join(TMP_DIR, `${sessionId}.json`);
    await fs.remove(filePath);
}

export interface AsyncResponse {
    sessionId: string;
    step: string;
    message?: string;
    error?: string;
    inputSchema?: object;
    context?: any;
}

export async function processAsyncStep(state: SessionState, input: any): Promise<AsyncResponse> {
    // State Machine Logic
    
    // 1. INIT -> Check Config -> MENU or ERROR_CONFIG
    if (state.step === 'INIT') {
        const hasConfig = await checkShadcnConfig();
        if (!hasConfig) {
            state.step = 'ERROR'; 
            // We treat config missing as a special state that allows input, but let's map it to MENU-like behavior
            // Or we can just handle it here.
            // Let's define a sub-step or just reuse steps.
            // Simplified: If no config, we return a state waiting for 'init' action.
            state.error = 'components.json not found';
            state.message = 'Configuration missing. Action required.';
            
            await saveSession(state);
            return {
                sessionId: state.sessionId,
                step: 'CONFIG_MISSING', // Custom step name for the output
                message: state.message,
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['init-shadcn', 'exit'] }
                    },
                    required: ['action']
                }
            };
        }

        // If config exists, ensure registry and scan
        await ensureEkairosRegistry();
        state.installedComponents = await getInstalledComponents();
        state.step = 'MENU';
        state.message = `Found ${state.installedComponents.length} components.`;
        
        await saveSession(state);
        return {
            sessionId: state.sessionId,
            step: 'MENU',
            message: state.message,
            context: { installedComponents: state.installedComponents },
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['update-all', 'install-essentials', 'exit'] }
                },
                required: ['action']
            }
        };
    }

    // 2. Handle Inputs based on current step
    if (input && input.action === 'exit') {
        await deleteSession(state.sessionId);
        return {
            sessionId: state.sessionId,
            step: 'TERMINATED',
            message: 'Session ended by user.'
        };
    }

    // Handle CONFIG_MISSING logic (simulated via state check)
    // If we are in a state where config was missing, we expect 'init-shadcn'
    // But since we persisted 'ERROR' step, let's check if input handles it.
    // To make it clean, let's rely on input action primarily if valid.

    if (input && input.action === 'init-shadcn') {
        await initShadcn();
        // Reset to INIT to re-check
        state.step = 'INIT';
        state.error = undefined;
        // Recursively call process to advance
        return processAsyncStep(state, null);
    }

    if (state.step === 'MENU' && input) {
        if (input.action === 'update-all' || input.action === 'install-essentials') {
            state.step = 'INSTALLING';
            await saveSession(state);
            
            // Perform installation
            const componentsToInstall = input.action === 'update-all' 
                ? state.installedComponents 
                : ['ekairos-agent-Agent'];

            let targets = [...new Set(componentsToInstall)].map(c => 
                c.startsWith('@ekairos/') ? c : `@ekairos/${c}`
            );

            if (targets.length === 0) targets.push('@ekairos/ekairos-agent-Agent');

            for (const component of targets) {
                await installComponent(component);
            }

            state.step = 'SUCCESS';
            state.message = 'Operations completed successfully.';
            await deleteSession(state.sessionId); // Done

            return {
                sessionId: state.sessionId,
                step: 'SUCCESS',
                message: state.message
            };
        }
    }
    
    // Default fallback if state didn't advance or input invalid
    return {
        sessionId: state.sessionId,
        step: state.step,
        message: state.message,
        error: 'Invalid state or input for current step.'
    };
}


