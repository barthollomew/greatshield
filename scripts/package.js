#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const targets = [
  { platform: 'win', arch: 'x64', ext: '.exe', name: 'Windows' },
  { platform: 'macos', arch: 'x64', ext: '', name: 'macOS' },
  { platform: 'linux', arch: 'x64', ext: '', name: 'Linux' }
];

console.log(chalk.blue.bold('🛡️  Packaging Greatshield executables...'));

try {
  // Ensure build exists
  if (!fs.existsSync('dist/index.js')) {
    console.log(chalk.yellow('Build not found, building first...'));
    execSync('node scripts/build.js', { stdio: 'inherit' });
  }

  // Create packages directory
  const packagesDir = 'packages';
  if (!fs.existsSync(packagesDir)) {
    fs.mkdirSync(packagesDir, { recursive: true });
  }

  console.log(chalk.gray('Packaging for multiple platforms...'));

  for (const target of targets) {
    console.log(chalk.blue(`\n📦 Packaging for ${target.name}...`));
    
    const outputName = `greatshield-${target.platform}-${target.arch}${target.ext}`;
    const outputPath = path.join(packagesDir, outputName);
    
    try {
      execSync(
        `npx pkg dist/index.js --targets node20-${target.platform}-${target.arch} --output ${outputPath}`,
        { stdio: 'inherit' }
      );
      
      console.log(chalk.green(`✅ ${target.name} package created: ${outputName}`));
    } catch (error) {
      console.error(chalk.red(`❌ Failed to package for ${target.name}:`), error.message);
    }
  }

  // Create a zip package with schemas and templates
  console.log(chalk.blue('\n📦 Creating distribution packages...'));
  
  for (const target of targets) {
    const outputName = `greatshield-${target.platform}-${target.arch}${target.ext}`;
    const outputPath = path.join(packagesDir, outputName);
    
    if (fs.existsSync(outputPath)) {
      const distDir = path.join(packagesDir, `greatshield-${target.platform}-${target.arch}`);
      
      if (fs.existsSync(distDir)) {
        fs.rmSync(distDir, { recursive: true, force: true });
      }
      
      fs.mkdirSync(distDir, { recursive: true });
      
      // Copy executable
      fs.copyFileSync(outputPath, path.join(distDir, `greatshield${target.ext}`));
      
      // Copy schemas
      fs.cpSync('bot/schemas', path.join(distDir, 'schemas'), { recursive: true });
      
      // Copy templates if they exist
      if (fs.existsSync('bot/templates')) {
        fs.cpSync('bot/templates', path.join(distDir, 'templates'), { recursive: true });
      }
      
      // Create README for the package
      const packageReadme = `# Greatshield ${target.name} Distribution

## Quick Start

1. Run the executable: \`./greatshield${target.ext}\`
2. Follow the setup wizard to configure your bot
3. Use \`./greatshield${target.ext} start\` to begin moderating

## Commands

- \`./greatshield${target.ext} setup\` - Run interactive setup wizard
- \`./greatshield${target.ext} start\` - Start the moderation bot
- \`./greatshield${target.ext} status\` - Check system health
- \`./greatshield${target.ext} --help\` - Show all available commands

## Requirements

- ${target.name} system
- Internet connection for initial Ollama setup
- Discord bot token and server permissions

For full documentation, visit: https://github.com/your-repo/greatshield
`;

      fs.writeFileSync(path.join(distDir, 'README.md'), packageReadme);
      
      console.log(chalk.green(`✅ Distribution package created: ${distDir}`));
    }
  }

  console.log(chalk.green('\n🎉 All packages created successfully!'));
  console.log(chalk.gray('Packages available in ./packages/ directory'));

} catch (error) {
  console.error(chalk.red('❌ Packaging failed:'), error.message);
  process.exit(1);
}