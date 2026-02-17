import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';
import { REGISTRY_ALIAS, getRegistryUrl } from './config.js';

// Check if components.json exists in CWD
export async function checkShadcnConfig(): Promise<boolean> {
    return fs.pathExists(path.join(process.cwd(), 'components.json'));
}

// Ensure @ekairos registry is configured in components.json
export async function ensureEkairosRegistry() {
    const configPath = path.join(process.cwd(), 'components.json');
    if (!await fs.pathExists(configPath)) return;

    const config = await fs.readJson(configPath);
    
    if (!config.registries) {
        config.registries = {};
    }

    const rawRegistryUrl = getRegistryUrl();
    const sanitizedUrl = rawRegistryUrl.trim().replace(/\s+/g, '');

    let registryConfigUrl: string;
    if (sanitizedUrl.includes('{name}')) {
        registryConfigUrl = sanitizedUrl;
    } else {
        const baseUrl = sanitizedUrl
            .replace(/\/registry\.json$/i, '')
            .replace(/\/+$/, '');
        registryConfigUrl = `${baseUrl}/{name}.json`;
    }

    if (config.registries[REGISTRY_ALIAS] !== registryConfigUrl) {
        config.registries[REGISTRY_ALIAS] = registryConfigUrl;
        await fs.writeJson(configPath, config, { spaces: 2 });
    }
}

// Scan components to see what is installed
export async function getInstalledComponents(): Promise<string[]> {
    // Logic: Check src/components/ekairos folder? 
    // Or check components.json aliases? 
    // A simple robust way is checking the filesystem based on the alias.
    
    // Assuming default alias @/components
    // We can read components.json to find the resolved path for "components" alias if needed,
    // but searching for "src/components/ekairos" is a safe 80/20 bet for this project structure.
    
    const possiblePaths = [
        'src/components/ekairos',
        'components/ekairos',
        'lib/components/ekairos'
    ];

    for (const p of possiblePaths) {
        const fullPath = path.join(process.cwd(), p);
        if (await fs.pathExists(fullPath)) {
            // Read directories/files in there
            // This is a heuristic. A folder "agent" means the main Ekairos Agent bundle is likely installed
            // Ideally we track this in a manifest, but we don't have one yet.
            // So we will just return detected component names based on files.
            
            // For simplicity in v1, we just return a single canonical component name
            const files = await fs.readdir(fullPath, { recursive: true });
            
            // If we find 'agent', we assume 'ekairos-agent-Agent' as the installed Ekairos bundle
            // This maps directly to the registry component name created from components/ekairos/agent/Agent.tsx
            
            const detected: string[] = [];
            const fileList = Array.isArray(files) ? files : []; // readdir recursive returns string[] in node 20+? wait fs-extra might differ.
            
            // fs-extra readdir is standard. recursive not supported in older node with string, but let's assume standard recursive or walk.
            // Let's stick to checking specific known folders for v1.
            
            if (await fs.pathExists(path.join(fullPath, 'agent'))) detected.push('ekairos-agent-Agent');
            // Add more detections here as registry grows
            
            return detected;
        }
    }
    
    return [];
}

export async function installComponent(componentName: string) {
    // Run shadcn add
    // npx --yes shadcn@latest add @ekairos/name -y --overwrite
    
    // Ensure component has prefix if it's a known component without one
    // But for now, we assume input is correct or handled by caller.
    // However, if we are using namespaces, we should prefer the namespaced format.
    
    let target = componentName;
    if (!target.startsWith('@') && !target.startsWith('http')) {
        target = `${REGISTRY_ALIAS}/${componentName}`;
    }

    await execa('npx', [
        '--yes',
        'shadcn@latest', 
        'add', 
        target, 
        '-y', 
        '--overwrite'
    ], {
        stdio: 'inherit' // Let the user see shadcn output
    });
}

export async function initShadcn() {
    await execa('npx', ['--yes', 'shadcn@latest', 'init'], { stdio: 'inherit' });
}

