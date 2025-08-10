# Greatshield

> **Local-first Discord moderation with AI-powered content analysis**

Greatshield is a privacy-focused Discord moderation bot that runs entirely on your own computer. It uses local AI models to analyze messages in real-time, protecting your community while keeping all data on your machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

## Features

**Privacy First**
- 100% Local processing - your data never leaves your computer
- No cloud dependencies or external API calls
- Complete control over your moderation system

**Two-Pass Moderation**
- Fast Pass: Instant regex-based filtering for banned words and spam
- AI Analysis: Sophisticated content analysis using local LLM models

**Flexible AI Models**
- TinyLLaMA 1.1B (~650MB RAM) - Perfect for low-end systems
- Phi-2 2.7B (~850MB RAM) - Recommended for balanced performance  
- Mistral 7B Instruct (~4.2GB RAM) - Best accuracy for powerful systems

**Smart Moderation Actions**
- Mask: Hide offensive content while preserving context
- Delete & Warn: Remove message and notify user
- Shadowban: Silently prevent user interactions  
- Escalate: Alert human moderators for review

## Quick Start

**Prerequisites**
- Node.js 20.x or higher
- Discord Bot Token from [Discord Developer Portal](https://discord.com/developers/applications)

**Installation & Setup**
```bash
# Install and run setup wizard
npx greatshield setup

# Start moderating
npx greatshield start
```

**Discord Bot Setup**
1. Create a Discord Application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a bot and copy the token, application ID, and public key
3. Set required permissions: `Send Messages`, `Manage Messages`, `Read Message History`, `Use Slash Commands`, `Manage Roles`
4. Invite bot to your server with proper scopes and permissions

## Commands

**CLI Commands**
```bash
greatshield setup      # Interactive setup wizard
greatshield start       # Start the bot
greatshield status      # Check system health
greatshield models      # List available AI models
greatshield pull <model> # Download new model
greatshield logs        # View logs
```

**Discord Slash Commands**
- `/status` - Check bot health and configuration
- `/policy` - View active moderation policies
- `/logs` - View recent moderation actions (admin only)

## Policy Packs

**Strict Moderation**
- Toxicity: 0.6 threshold → Delete & Warn
- Harassment: 0.5 threshold → Delete & Warn
- Spam: 0.7 threshold → Mask
- Grooming: 0.3 threshold → Escalate

**Balanced Moderation** (Recommended)
- Toxicity: 0.75 threshold → Mask  
- Harassment: 0.7 threshold → Delete & Warn
- Spam: 0.8 threshold → Mask
- Grooming: 0.4 threshold → Escalate

**Lenient Moderation**
- Toxicity: 0.9 threshold → Mask
- Harassment: 0.85 threshold → Delete & Warn  
- Spam: 0.9 threshold → Mask
- Grooming: 0.5 threshold → Escalate

## Configuration

**Environment Variables**
```env
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_APPLICATION_ID=your_application_id_here
DISCORD_PUBLIC_KEY=your_public_key_here  
DISCORD_GUILD_ID=your_guild_id_here
MOD_LOG_CHANNEL_ID=your_mod_log_channel_id_here
OLLAMA_HOST=http://localhost:11434
SELECTED_MODEL=phi:2.7b-q4_k_m
DATABASE_PATH=./greatshield.db
LOG_LEVEL=info
```

## Troubleshooting

**Bot Not Responding**
```bash
# Check system status
greatshield status

# Verify Ollama is running  
ollama serve

# Check Discord permissions in server settings
```

**High False Positives**
- Increase detection thresholds in policy settings
- Switch to a larger, more accurate model
- Review banned words list

**Missing Violations**
- Decrease detection thresholds
- Switch to stricter policy pack
- Consider using larger AI model

**Performance Issues**
- Use smaller model (TinyLLaMA) 
- Check system resources
- Review logs for errors

## Development

**Setup**
```bash
git clone https://github.com/barthollomew/greatshield.git
cd greatshield
npm install
npm run build
npm start
```

**Project Structure**
```
greatshield/
├── bot/src/
│   ├── cli/          # Setup wizard and CLI commands
│   ├── core/         # Discord bot core and SOLID architecture
│   ├── database/     # SQLite database management  
│   ├── moderation/   # Two-pass moderation system
│   ├── ollama/       # AI model integration
│   └── utils/        # Logging and utilities
├── schemas/          # Database schemas and seed data
└── website/          # Landing page
```

## Security & Privacy

**Data Protection**
- Local processing only - no external API calls for moderation
- SQLite database with sensitive data protection
- Minimal logging - only essential information stored
- Complete user control over data retention

**Security Best Practices**
- Run on dedicated server or container
- Regular database backups
- Monitor system resources and logs
- Keep Ollama and models updated
- Secure Discord bot token storage

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Built for Discord communities that value privacy and control**