# 🛡️ Greatshield

> **A local-first Discord moderation bot with AI-powered content analysis**

Greatshield is a powerful, privacy-focused Discord moderation bot that runs entirely on your own computer. It uses local AI models via Ollama to analyze messages in real-time, protecting your community while keeping all data on your machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

## ✨ Features

### 🔒 **Privacy First**
- **100% Local**: All processing happens on your machine
- **No Cloud Dependencies**: Your data never leaves your computer
- **Self-Hosted**: Complete control over your moderation system

### 🚀 **Two-Pass Moderation System**
- **Fast Pass**: Instant regex-based filtering for banned words, URLs, and spam patterns
- **AI Analysis**: Sophisticated content analysis using local LLM models with RAG (Retrieval-Augmented Generation)

### 🤖 **Flexible AI Models**
Choose the model that fits your hardware:
- **TinyLLaMA 1.1B** (~650MB RAM) - Perfect for low-end systems
- **Phi-2 2.7B** (~850MB RAM) - **Recommended** for balanced performance
- **Mistral 7B Instruct** (~4.2GB RAM) - Best accuracy for powerful systems
- **Custom Models** - Use any Ollama-compatible model

### ⚡ **Smart Moderation Actions**
- **Mask**: Hide offensive content while preserving context
- **Delete & Warn**: Remove message and notify user
- **Shadowban**: Silently prevent user interactions
- **Escalate**: Alert human moderators for review

### 📊 **Comprehensive Logging**
- Discord mod-log channel integration
- SQLite database for audit trails
- Detailed reasoning for every action
- Appeal system for users

## 🚀 Quick Start

### Prerequisites
- **Node.js 20.x** or higher
- **Windows, macOS, or Linux**
- **Discord Bot Token** (create at [Discord Developer Portal](https://discord.com/developers/applications))

### Installation

#### Option 1: NPX (Recommended)
```bash
npx greatshield
```

#### Option 2: Download Binary
1. Download the latest release for your platform from [Releases](https://github.com/your-repo/greatshield/releases)
2. Extract and run the executable

#### Option 3: Build from Source
```bash
git clone https://github.com/your-repo/greatshield.git
cd greatshield
npm install
npm run build
npm start
```

### Initial Setup

1. **Run the Setup Wizard**:
   ```bash
   npx greatshield setup
   ```
   
2. **Follow the Interactive Prompts**:
   - Enter your Discord bot token, application ID, and public key
   - Select a moderation policy pack (Strict, Balanced, or Lenient)
   - Choose your AI model based on your system capabilities
   - Configure mod-log channel

3. **Start Moderating**:
   ```bash
   npx greatshield start
   ```

## 🔧 Configuration

### Discord Bot Setup

1. **Create a Discord Application**:
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Go to "Bot" section and create a bot
   - Copy the token, application ID, and public key

2. **Set Bot Permissions**:
   Required permissions:
   - `Send Messages`
   - `Manage Messages`
   - `Read Message History`
   - `Use Slash Commands`
   - `Manage Roles` (for shadowban)

3. **Invite Bot to Server**:
   Use the generated OAuth2 URL with proper scopes and permissions.

### Environment Variables

Create a `.env` file or use the setup wizard:

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

## 📝 Commands

### CLI Commands

```bash
# Run interactive setup
greatshield setup

# Start the bot
greatshield start

# Check system status
greatshield status

# List available models
greatshield models

# Download a new model
greatshield pull phi:2.7b-q4_k_m

# View logs
greatshield logs
greatshield logs --follow  # Follow real-time logs
```

### Discord Slash Commands

- `/guardian status` - Check bot health and configuration
- `/guardian appeal <message-link> <reason>` - Appeal a moderation action

## 🛠️ Policy Packs

Greatshield comes with three pre-configured policy packs:

### 🔒 **Strict Moderation**
- **Toxicity**: 0.6 threshold → Delete & Warn
- **Harassment**: 0.5 threshold → Delete & Warn  
- **Spam**: 0.7 threshold → Mask
- **Grooming**: 0.3 threshold → Escalate

### ⚖️ **Balanced Moderation** (Recommended)
- **Toxicity**: 0.75 threshold → Mask
- **Harassment**: 0.7 threshold → Delete & Warn
- **Spam**: 0.8 threshold → Mask  
- **Grooming**: 0.4 threshold → Escalate

### 🕊️ **Lenient Moderation**
- **Toxicity**: 0.9 threshold → Mask
- **Harassment**: 0.85 threshold → Delete & Warn
- **Spam**: 0.9 threshold → Mask
- **Grooming**: 0.5 threshold → Escalate

## 🧠 AI Models Guide

### System Requirements

| Model | RAM Usage | CPU | Best For |
|-------|-----------|-----|----------|
| TinyLLaMA 1.1B | ~650MB | Low-end | Basic filtering |
| Phi-2 2.7B | ~850MB | Mid-range | **Recommended** |
| Mistral 7B | ~4.2GB | High-end | Maximum accuracy |

### Model Performance

- **Response Time**: 100-500ms per analysis
- **Accuracy**: 85-95% depending on model size
- **Context**: Up to 10 recent messages for analysis

## 📊 Analytics & Logging

### Moderation Logs Include:
- **Message Content**: Original text (masked in logs)
- **AI Scores**: Toxicity, harassment, spam, grooming confidence
- **Action Taken**: Mask, delete, shadowban, or escalate
- **Reasoning**: AI explanation for the decision
- **User Appeals**: Track appeals and resolutions

### Log Files:
- `logs/greatshield.log` - General application logs
- `logs/error.log` - Error-specific logs
- `greatshield.db` - SQLite database with full history

## 🔧 Advanced Configuration

### Custom Policy Packs

You can create custom moderation rules by modifying the database directly or through the CLI wizard. Example:

```sql
INSERT INTO moderation_rules (policy_pack_id, rule_type, threshold, action) VALUES 
(1, 'toxicity', 0.8, 'mask'),
(1, 'harassment', 0.6, 'delete_warn');
```

### Custom Models

Use any Ollama-compatible model:

```bash
greatshield pull your-custom-model:latest
# Then update your configuration to use the new model
```

### Performance Tuning

- **Lower thresholds** = More sensitive (catches more violations)
- **Higher thresholds** = Less sensitive (fewer false positives)
- **Adjust based on your community** culture and needs

## 🚨 Troubleshooting

### Common Issues

#### Bot Not Responding
```bash
# Check if Ollama is running
greatshield status

# Restart Ollama service
ollama serve

# Check Discord permissions
# Ensure bot has required permissions in your server
```

#### High False Positives
- Increase detection thresholds in policy settings
- Switch to a larger, more accurate model
- Review and adjust banned words list

#### Missing Violations
- Decrease detection thresholds
- Add more context to AI prompts
- Consider switching policy packs

#### Performance Issues
- Use a smaller model (TinyLLaMA)
- Reduce message context window
- Check system resources

### Getting Help

1. Check the logs: `greatshield logs`
2. Verify configuration: `greatshield status`
3. Review [GitHub Issues](https://github.com/your-repo/greatshield/issues)
4. Join our [Discord Community](https://discord.gg/your-server)

## 🛡️ Security & Privacy

### Data Protection
- **Local Processing**: No external API calls for moderation
- **Encrypted Storage**: SQLite database with sensitive data protection
- **Minimal Logging**: Only essential information is stored
- **User Control**: Complete control over data retention

### Recommended Security Practices
- Run on a dedicated server or container
- Regular database backups
- Monitor system resources and logs
- Keep Ollama and models updated
- Use strong Discord bot token security

## 🧪 Development

### Prerequisites
- Node.js 20.x+
- TypeScript 5.x+
- Ollama installed locally

### Setup
```bash
git clone https://github.com/your-repo/greatshield.git
cd greatshield
npm install
npm run dev  # Development mode with hot reload
```

### Building
```bash
npm run build          # Compile TypeScript
npm run package        # Create cross-platform executables
npm run lint          # Check code quality
npm run test          # Run tests
```

### Project Structure
```
greatshield/
├── bot/
│   ├── src/
│   │   ├── cli/           # Setup wizard and CLI commands
│   │   ├── core/          # Discord bot core and commands
│   │   ├── database/      # SQLite database management
│   │   ├── moderation/    # Two-pass moderation system
│   │   ├── ollama/        # AI model integration
│   │   └── utils/         # Logging and utilities
│   ├── schemas/           # Database schemas and seed data
│   └── templates/         # AI prompt templates
├── scripts/               # Build and packaging scripts
└── packages/              # Distribution packages
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Workflow
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Ollama](https://ollama.ai/) - For providing excellent local LLM hosting
- [Discord.js](https://discord.js.org/) - For the robust Discord API library
- [sqlite3](https://www.npmjs.com/package/sqlite3) - For reliable local database storage
- The open-source community for various libraries and tools

## 📞 Support

- **Documentation**: [GitHub Wiki](https://github.com/your-repo/greatshield/wiki)
- **Bug Reports**: [GitHub Issues](https://github.com/your-repo/greatshield/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/your-repo/greatshield/discussions)
- **Community**: [Discord Server](https://discord.gg/your-server)

---

<div align="center">

**Built with ❤️ for Discord communities that value privacy and control**

[⭐ Star us on GitHub](https://github.com/your-repo/greatshield) | [📖 Read the Docs](https://github.com/your-repo/greatshield/wiki) | [💬 Join Discord](https://discord.gg/your-server)

</div>