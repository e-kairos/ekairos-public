#!/usr/bin/env node

const { execSync } = require('child_process');

function checkAuth() {
  try {
    const result = execSync('npm whoami', { encoding: 'utf8', stdio: 'pipe' });
    const username = result.trim();
    console.log(`✓ Autenticado en npm como: ${username}`);
    return true;
  } catch (error) {
    console.error('✗ Error: No estás autenticado en npm');
    console.error('\nPara autenticarte, ejecuta uno de los siguientes comandos:');
    console.error('  1. npm login');
    console.error('  2. npm config set //registry.npmjs.org/:_authToken TU_TOKEN');
    console.error('\nObtén un token en: https://www.npmjs.com/settings/TU_USUARIO/tokens');
    process.exit(1);
  }
}

checkAuth();












