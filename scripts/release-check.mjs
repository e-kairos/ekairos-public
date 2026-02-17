#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const configPath = path.join(rootDir, 'scripts', 'release-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const allowedTags = new Set(['latest', 'beta', 'rc', 'next']);

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const explicitTag = getArgValue('--tag');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readJson(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function inferTagFromVersion(version) {
  if (version.includes('-beta.')) return 'beta';
  if (version.includes('-rc.')) return 'rc';
  if (version.includes('-next.')) return 'next';
  return 'latest';
}

function assertVersionTagCompatibility(version, distTag) {
  if (distTag === 'latest') {
    if (version.includes('-')) {
      fail(`latest channel requires stable version, received "${version}".`);
    }
    return;
  }

  const marker = `-${distTag}.`;
  if (!version.includes(marker)) {
    fail(`channel "${distTag}" requires version containing "${marker}", received "${version}".`);
  }
}

function main() {
  const rootPackage = readJson('package.json');
  const rootVersion = rootPackage.version;
  if (!rootVersion || typeof rootVersion !== 'string') {
    fail('Root package.json version is missing.');
  }

  const inferredTag = inferTagFromVersion(rootVersion);
  const distTag = explicitTag ?? inferredTag;

  if (!allowedTags.has(distTag)) {
    fail(`Unsupported channel "${distTag}". Allowed: ${Array.from(allowedTags).join(', ')}`);
  }

  const packageVersions = config.publishablePackages.map((pkg) => {
    const packageJson = readJson(path.join(pkg.dir, 'package.json'));
    return { name: pkg.name, version: packageJson.version };
  });

  const divergent = packageVersions.filter((item) => item.version !== rootVersion);
  if (divergent.length > 0) {
    const detail = divergent.map((item) => `${item.name}@${item.version}`).join(', ');
    fail(`Package versions are not aligned with root version ${rootVersion}: ${detail}`);
  }

  assertVersionTagCompatibility(rootVersion, distTag);

  console.log(`Release check passed. version=${rootVersion} tag=${distTag}`);
}

main();
