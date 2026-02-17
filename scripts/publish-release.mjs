#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const configPath = path.join(rootDir, 'scripts', 'release-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const packages = config.publishablePackages;
const allowedTags = new Set(['latest', 'beta', 'rc', 'next']);

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

const distTag = getArgValue('--tag') ?? process.env.NPM_DIST_TAG ?? 'latest';
const dryRun = hasArg('--dry-run');
const strictMode = process.env.RELEASE_STRICT !== '0';
const useProvenance = !dryRun && process.env.GITHUB_ACTIONS === 'true' && !hasArg('--no-provenance');

if (!allowedTags.has(distTag)) {
  console.error(`Unsupported dist-tag "${distTag}". Allowed: ${Array.from(allowedTags).join(', ')}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const printable = `${command} ${args.join(' ')}`;
  console.log(`$ ${printable}`);

  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: options.cwd ?? rootDir,
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${printable}`);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    cwd: options.cwd ?? rootDir,
    shell: process.platform === 'win32',
    env: process.env,
    encoding: 'utf8',
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function readPackageVersion(packageDir) {
  const packageJsonPath = path.join(rootDir, packageDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.version || typeof packageJson.version !== 'string') {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }
  return packageJson.version;
}

function assertVersionTagCompatibility(version, tag) {
  if (tag === 'latest') {
    if (version.includes('-')) {
      throw new Error(`Tag "latest" requires stable version. Received "${version}".`);
    }
    return;
  }

  const expectedMarker = `-${tag}.`;
  if (!version.includes(expectedMarker)) {
    throw new Error(`Tag "${tag}" requires version containing "${expectedMarker}". Received "${version}".`);
  }
}

function versionExists(packageName, version) {
  const result = runCapture('npm', ['view', `${packageName}@${version}`, 'version']);

  if (result.status === 0) return true;

  const output = `${result.stdout}\n${result.stderr}`;
  const notFoundSignals = ['E404', '404 Not Found', 'No match found for version'];
  const isNotFound = notFoundSignals.some((signal) => output.includes(signal));
  if (isNotFound) return false;

  throw new Error(`Failed checking ${packageName}@${version}: ${output.trim()}`);
}

function currentDistTagVersion(packageName, tag) {
  const result = runCapture('npm', ['dist-tag', 'ls', packageName]);
  if (result.status !== 0) return null;

  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(':').map((part) => part.trim());
    if (parts.length === 2 && parts[0] === tag) {
      return parts[1];
    }
  }

  return null;
}

function ensureDistTag(packageName, version, tag) {
  if (tag === 'latest') return false;

  const currentVersion = currentDistTagVersion(packageName, tag);
  if (currentVersion === version) {
    console.log(`Tag ${tag} already points to ${packageName}@${version}.`);
    return false;
  }

  if (dryRun) {
    console.log(`[dry-run] npm dist-tag add ${packageName}@${version} ${tag}`);
    return true;
  }

  run('npm', ['dist-tag', 'add', `${packageName}@${version}`, tag], { cwd: rootDir });
  return true;
}

function publishPackage(pkg, tag) {
  const args = ['publish'];

  if (tag !== 'latest') {
    args.push('--tag', tag);
  }

  if (pkg.publicAccess) {
    args.push('--access', 'public');
  }

  if (useProvenance) {
    args.push('--provenance');
  }

  if (dryRun) {
    args.push('--dry-run');
  }

  run('npm', args, { cwd: path.join(rootDir, pkg.dir) });
}

function verifyVersionsMetadata(resolvedPackages) {
  const uniqueVersions = [...new Set(resolvedPackages.map((pkg) => pkg.version))];
  if (strictMode && uniqueVersions.length !== 1) {
    const detail = resolvedPackages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ');
    throw new Error(`Publishable packages have divergent versions in strict mode: ${detail}`);
  }

  const versionToValidate = uniqueVersions[0];
  if (strictMode && versionToValidate) {
    assertVersionTagCompatibility(versionToValidate, distTag);
  }
}

function main() {
  console.log(`Publishing packages with dist-tag "${distTag}"${dryRun ? ' (dry-run)' : ''}`);
  if (strictMode) {
    console.log('Strict mode: enabled (set RELEASE_STRICT=0 to disable).');
  }

  const resolvedPackages = packages.map((pkg) => ({
    ...pkg,
    version: readPackageVersion(pkg.dir),
  }));

  verifyVersionsMetadata(resolvedPackages);

  const summary = {
    published: [],
    skipped: [],
    retagged: [],
  };

  for (const pkg of resolvedPackages) {
    const alreadyPublished = versionExists(pkg.name, pkg.version);
    if (alreadyPublished) {
      console.log(`Skipping ${pkg.name}@${pkg.version}: version already published.`);
      summary.skipped.push(`${pkg.name}@${pkg.version}`);
      const retagged = ensureDistTag(pkg.name, pkg.version, distTag);
      if (retagged) {
        summary.retagged.push(`${pkg.name}@${pkg.version}`);
      }
      continue;
    }

    publishPackage(pkg, distTag);
    summary.published.push(`${pkg.name}@${pkg.version}`);
  }

  console.log('Release publish flow completed.');
  console.log(`Published: ${summary.published.length}`);
  console.log(`Skipped: ${summary.skipped.length}`);
  console.log(`Retagged: ${summary.retagged.length}`);
}

main();
