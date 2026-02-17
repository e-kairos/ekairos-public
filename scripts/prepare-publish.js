const fs = require('fs');
const path = require('path');

const releaseConfigPath = path.join(__dirname, 'release-config.json');
const releaseConfig = JSON.parse(fs.readFileSync(releaseConfigPath, 'utf8'));
const packages = releaseConfig.preparePackages;
const linkedPackages = releaseConfig.linkedPackages;

// Get the root version
const rootPackageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const rootVersion = rootPackageJson.version;

function updatePackageJson(packagePath) {
  const packageJsonPath = path.join(packagePath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  let changed = false;

  // Update version to match root
  if (packageJson.version !== rootVersion) {
    packageJson.version = rootVersion;
    changed = true;
  }

  // Update dependencies
  if (packageJson.dependencies) {
    for (const [dep, version] of Object.entries(packageJson.dependencies)) {
      let nextVersion = version;

      if (typeof version === 'string' && version.startsWith('workspace:')) {
        const spec = version.replace(/^workspace:/, '').trim();
        nextVersion = spec === '' || spec === '*' ? `^${rootVersion}` : spec;
      } else if (linkedPackages[dep]) {
        const depPackageJsonPath = path.join(linkedPackages[dep], 'package.json');
        if (fs.existsSync(depPackageJsonPath)) {
          const depPackageJson = JSON.parse(fs.readFileSync(depPackageJsonPath, 'utf8'));
          if (dep === 'ekairos-cli') {
            nextVersion = `^${depPackageJson.version}`;
          } else {
            nextVersion = `^${rootVersion}`;
          }
        }
      }

      if (nextVersion !== version) {
        packageJson.dependencies[dep] = nextVersion;
        changed = true;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    console.log(`Updated ${packageJsonPath}`);
  }
}

console.log('Preparing packages for publication...');

for (const pkg of packages) {
  updatePackageJson(pkg);
}

console.log('Done preparing packages for publication.');
