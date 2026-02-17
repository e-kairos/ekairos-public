#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const channelDefaults = {
  latest: { bump: 'patch', preid: null },
  beta: { bump: 'prepatch', preid: 'beta' },
  rc: { bump: 'prerelease', preid: 'rc' },
  next: { bump: 'prepatch', preid: 'next' },
};

const allowedChannels = new Set(Object.keys(channelDefaults));

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

function run(command, args, options = {}) {
  const printable = `${command} ${args.join(' ')}`;
  console.log(`$ ${printable}`);

  const result = spawnSync(command, args, {
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: true,
    env: process.env,
    encoding: options.capture ? 'utf8' : undefined,
  });

  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed (${result.status}): ${printable}`);
  }

  if (options.capture) {
    return (result.stdout ?? '').trim();
  }

  return '';
}

function readRootVersion() {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
}

function releaseManifestPaths() {
  const configPath = path.join(process.cwd(), 'scripts', 'release-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const packagePaths = (config.preparePackages ?? []).map((pkgPath) =>
    path.join(pkgPath, 'package.json').replace(/\\/g, '/')
  );
  return ['package.json', 'pnpm-lock.yaml', ...packagePaths];
}

function currentBranch() {
  return run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true });
}

const channel = getArgValue('--channel') ?? 'beta';
const bump = getArgValue('--bump');
const preid = getArgValue('--preid');
const skipBuild = !hasArg('--with-build');
const skipCheck = hasArg('--skip-check');
const push = !hasArg('--no-push');
const commit = !hasArg('--no-commit');
const allowNonMain = hasArg('--allow-non-main');

if (!allowedChannels.has(channel)) {
  console.error(`Unsupported channel "${channel}". Allowed: ${Array.from(allowedChannels).join(', ')}`);
  process.exit(1);
}

try {
  const branch = currentBranch();
  if (branch !== 'main' && !allowNonMain) {
    throw new Error(`Release must run from main. Current branch: ${branch}. Use --allow-non-main to override.`);
  }

  const defaults = channelDefaults[channel];
  const resolvedBump = bump ?? defaults.bump;
  const resolvedPreid = preid ?? defaults.preid;

  const versionArgs = ['version', resolvedBump, '--no-git-tag-version'];
  if (resolvedPreid) {
    versionArgs.push('--preid', resolvedPreid);
  }
  run('npm', versionArgs);

  if (!skipBuild) {
    run('pnpm', ['run', 'build:publish-packages']);
  }

  run('pnpm', ['run', 'prepare-publish']);
  run('pnpm', ['install', '--lockfile-only', '--link-workspace-packages']);

  if (!skipCheck) {
    run('node', ['scripts/release-check.mjs', '--tag', channel]);
  }

  const version = readRootVersion();

  if (commit) {
    run('git', ['add', ...releaseManifestPaths()]);
    run('git', ['commit', '-m', `chore:release-${version}-${channel}`]);
  }

  if (push) {
    run('git', ['push', 'origin', branch]);
  }

  console.log(`Release flow completed. branch=${branch} channel=${channel} version=${version}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
