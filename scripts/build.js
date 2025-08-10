#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

console.log(chalk.blue.bold('🛡️  Building Greatshield...'));

try {
  // Clean previous build
  console.log(chalk.gray('Cleaning previous build...'));
  if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true, force: true });
  }

  // Compile TypeScript
  console.log(chalk.gray('Compiling TypeScript...'));
  execSync('npx tsc', { stdio: 'inherit' });

  // Copy schema files
  console.log(chalk.gray('Copying schema files...'));
  if (!fs.existsSync('dist/schemas')) {
    fs.mkdirSync('dist/schemas', { recursive: true });
  }
  
  fs.copyFileSync('bot/schemas/database.sql', 'dist/schemas/database.sql');
  fs.copyFileSync('bot/schemas/seed-data.sql', 'dist/schemas/seed-data.sql');

  // Copy templates if they exist
  if (fs.existsSync('bot/templates')) {
    console.log(chalk.gray('Copying template files...'));
    fs.cpSync('bot/templates', 'dist/templates', { recursive: true });
  }

  // Make the main file executable
  const mainFile = 'dist/index.js';
  if (fs.existsSync(mainFile)) {
    // Add shebang to the main file
    const content = fs.readFileSync(mainFile, 'utf8');
    if (!content.startsWith('#!')) {
      fs.writeFileSync(mainFile, '#!/usr/bin/env node\n' + content);
    }
    
    // Make executable on Unix systems
    if (process.platform !== 'win32') {
      fs.chmodSync(mainFile, 0o755);
    }
  }

  console.log(chalk.green('✅ Build completed successfully!'));
  console.log(chalk.gray('Output directory: ./dist/'));

} catch (error) {
  console.error(chalk.red('❌ Build failed:'), error.message);
  process.exit(1);
}