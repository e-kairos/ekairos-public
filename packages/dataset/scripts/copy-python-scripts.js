const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'src', 'file', 'scripts');
const destDir = path.join(__dirname, '..', 'dist', 'file', 'scripts');

// Create destination directory if it doesn't exist
fs.mkdirSync(destDir, { recursive: true });

// Copy all .py files
const files = fs.readdirSync(sourceDir);
let copiedCount = 0;

files.forEach(file => {
    if (file.endsWith('.py')) {
        const sourcePath = path.join(sourceDir, file);
        const destPath = path.join(destDir, file);
        fs.copyFileSync(sourcePath, destPath);
        copiedCount++;
        console.log(`Copied: ${file}`);
    }
});

console.log(`✓ Copied ${copiedCount} Python script(s) to dist/`);




