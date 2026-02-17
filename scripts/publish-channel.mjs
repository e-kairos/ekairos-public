#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';

const allowedTags = new Set(['latest', 'beta', 'rc', 'next']);

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

function run(command, args) {
  const printable = `${command} ${args.join(' ')}`;
  console.log(`$ ${printable}`);

  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed (${result.status}): ${printable}`);
  }
}

const tag = getArgValue('--tag') ?? process.env.NPM_DIST_TAG ?? null;
const dryRun = hasArg('--dry-run');

if (!tag || !allowedTags.has(tag)) {
  console.error(`Unsupported or missing --tag. Allowed: ${Array.from(allowedTags).join(', ')}`);
  process.exit(1);
}

try {
  console.log(`Running publish pipeline for tag "${tag}"${dryRun ? ' (dry-run)' : ''}`);

  run('pnpm', ['run', 'build:publish-packages']);
  run('pnpm', ['run', 'prepare-publish']);
  run('node', ['scripts/release-check.mjs', '--tag', tag]);

  if (!dryRun) {
    run('node', ['scripts/check-npm-auth.js']);
  }

  const publishArgs = ['scripts/publish-release.mjs', '--tag', tag];
  if (dryRun) {
    publishArgs.push('--dry-run');
  }

  run('node', publishArgs);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
