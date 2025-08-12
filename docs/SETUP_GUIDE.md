# Greatshield Discord Moderation Bot - Setup Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Installation Methods](#installation-methods)
3. [Initial Configuration](#initial-configuration)
4. [Discord Bot Setup](#discord-bot-setup)
5. [Ollama Configuration](#ollama-configuration)
6. [Policy Configuration](#policy-configuration)
7. [Testing and Verification](#testing-and-verification)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements
- **Node.js**: Version 20.0.0 or higher
- **RAM**: Minimum 2GB, recommended 4GB+
- **Storage**: 1GB free space for application and logs
- **OS**: Windows 10+, macOS 10.15+, or Linux (Ubuntu 18.04+)

### Required Services
- **Discord Application**: Bot token and application ID
- **Ollama**: Local LLM service for AI moderation
- **Internet Connection**: For Discord API and initial setup

## Installation Methods

### Method 1: Pre-built Executables (Recommended)

1. **Download the latest release** from [GitHub Releases](https://github.com/greatshield/greatshield-bot/releases)
   - Windows: `greatshield-win.exe`
   - macOS: `greatshield-mac`
   - Linux: `greatshield-linux`

2. **Create a working directory**:
   ```bash
   mkdir greatshield-bot
   cd greatshield-bot
   ```

3. **Move the executable** to your working directory

4. **Make executable** (Linux/macOS only):
   ```bash
   chmod +x greatshield-linux
   # or
   chmod +x greatshield-mac
   ```

### Method 2: Docker (Server Deployment)

1. **Create docker-compose.yml**:
   ```yaml
   version: '3.8'
   services:
     greatshield:
       image: ghcr.io/greatshield/greatshield-bot:latest
       environment:
         - DISCORD_TOKEN=${DISCORD_TOKEN}
         - GUILD_ID=${GUILD_ID}
         - CLIENT_ID=${CLIENT_ID}
         - OLLAMA_BASE_URL=http://ollama:11434
       volumes:
         - ./data:/app/data
         - ./config:/app/config
         - ./logs:/app/logs
         - ./backups:/app/backups
       ports:
         - "3000:3000"
       depends_on:
         - ollama
       restart: unless-stopped

     ollama:
       image: ollama/ollama:latest
       volumes:
         - ./ollama:/root/.ollama
       ports:
         - "11434:11434"
       restart: unless-stopped
   ```

2. **Create environment file** (`.env`):
   ```env
   DISCORD_TOKEN=your_bot_token_here
   GUILD_ID=your_guild_id_here
   CLIENT_ID=your_client_id_here
   ```

3. **Start the services**:
   ```bash
   docker-compose up -d
   ```

### Method 3: From Source (Development)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/greatshield/greatshield-bot.git
   cd greatshield-bot
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the application**:
   ```bash
   npm run build
   ```

4. **Start the application**:
   ```bash
   npm start
   ```

## Initial Configuration

### Setup Wizard

1. **Run the setup wizard** on first launch:
   ```bash
   # For executables
   ./greatshield-win.exe setup
   
   # For source installation
   npm run setup
   ```

2. **Follow the interactive prompts**:
   - Discord bot token
   - Guild (server) ID
   - Client ID
   - Ollama configuration
   - Initial policy settings

### Manual Configuration

If you prefer manual configuration, create `config/environment.json`:

```json
{
  "discordToken": "YOUR_BOT_TOKEN",
  "guildId": "YOUR_GUILD_ID",
  "clientId": "YOUR_CLIENT_ID",
  "database": {
    "path": "./data/greatshield.db",
    "maxConnections": 10,
    "timeout": 10000,
    "retryAttempts": 3,
    "enableWAL": true
  },
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "timeout": 30000,
    "maxRetries": 3,
    "defaultModel": "llama2"
  },
  "logging": {
    "level": 1,
    "enableConsole": true,
    "enableFile": true,
    "filePath": "./logs/greatshield.log",
    "maxFileSize": 10485760,
    "maxFiles": 5,
    "enableJSON": false
  },
  "security": {
    "rateLimiting": {
      "enabled": true,
      "maxMessages": 10,
      "timeWindow": 60000,
      "burstLimit": 3
    },
    "inputValidation": {
      "enabled": true,
      "maxLength": 2000,
      "allowedFileTypes": ["jpg", "jpeg", "png", "gif", "webp", "txt", "md"]
    },
    "contentSanitization": {
      "enabled": true,
      "blockMaliciousUrls": true,
      "stripHtml": true
    }
  },
  "monitoring": {
    "enabled": true,
    "healthCheck": {
      "interval": 30000,
      "timeout": 10000,
      "retryAttempts": 3
    },
    "metrics": {
      "collectionInterval": 15000,
      "maxHistory": 10000
    },
    "alerts": {
      "enabled": true,
      "checkInterval": 30000
    }
  }
}
```

## Discord Bot Setup

### Creating a Discord Application

1. **Go to Discord Developer Portal**:
   - Visit [https://discord.com/developers/applications](https://discord.com/developers/applications)
   - Click "New Application"
   - Give your bot a name (e.g., "Greatshield Moderator")

2. **Configure the Bot**:
   - Go to the "Bot" section
   - Click "Add Bot"
   - Copy the bot token (keep this secure!)
   - Enable necessary intents:
     - ✅ Server Members Intent
     - ✅ Message Content Intent
     - ✅ Presence Intent

3. **Set Bot Permissions**:
   - Go to "OAuth2" > "URL Generator"
   - Select "bot" scope
   - Select permissions:
     - ✅ Manage Messages
     - ✅ Manage Members
     - ✅ Ban Members
     - ✅ Kick Members
     - ✅ Moderate Members
     - ✅ Read Messages
     - ✅ Send Messages
     - ✅ Manage Roles (if using role-based moderation)

4. **Invite Bot to Server**:
   - Use the generated URL to invite the bot
   - Make sure the bot role is positioned correctly in the hierarchy

### Finding Required IDs

1. **Enable Developer Mode** in Discord:
   - User Settings > Advanced > Developer Mode

2. **Get Guild ID**:
   - Right-click your server name
   - Click "Copy Server ID"

3. **Get Client ID**:
   - In Discord Developer Portal
   - Go to "General Information"
   - Copy "Application ID"

## Ollama Configuration

### Installing Ollama

1. **Download and install Ollama**:
   - Visit [https://ollama.com](https://ollama.com)
   - Download for your operating system
   - Follow installation instructions

2. **Verify Ollama installation**:
   ```bash
   ollama --version
   ```

### Setting up AI Models

1. **Download recommended models**:
   ```bash
   # Primary model for content moderation
   ollama pull llama2
   
   # Alternative models
   ollama pull mistral
   ollama pull codellama
   ```

2. **Test model functionality**:
   ```bash
   ollama run llama2 "Test message for moderation capabilities"
   ```

3. **Configure Ollama service**:
   - Ensure Ollama is running on `http://localhost:11434`
   - For remote Ollama, update the `baseUrl` in configuration

## Policy Configuration

### Default Policy Packs

Greatshield comes with several pre-configured policy packs:

1. **Standard Community** (Recommended for most servers)
2. **Gaming Community** (Optimized for gaming discussions)
3. **Educational** (Suitable for educational/professional servers)
4. **Strict Moderation** (Zero-tolerance policies)

### Customizing Policies

1. **Access the web dashboard**:
   ```bash
   # Start the bot
   ./greatshield-win.exe
   
   # Open browser to http://localhost:3000
   ```

2. **Create custom policies**:
   - Navigate to "Policy Management"
   - Click "Create New Policy Pack"
   - Define rules for different content types:
     - Toxicity thresholds
     - Spam detection sensitivity
     - Content filtering rules
     - Action escalation paths

3. **Policy rule examples**:
   ```json
   {
     "name": "Custom Gaming Policy",
     "rules": [
       {
         "type": "toxicity",
         "threshold": 0.7,
         "action": "warn",
         "escalation": {
           "repeat_offenses": 3,
           "escalated_action": "timeout"
         }
       },
       {
         "type": "spam",
         "threshold": 0.8,
         "action": "delete",
         "cooldown": 300000
       }
     ]
   }
   ```

### Testing Policies

1. **Use test mode** to validate policies:
   ```bash
   ./greatshield-win.exe test --policy-id 1 --message "Test message content"
   ```

2. **Monitor policy effectiveness**:
   - Check moderation logs
   - Review false positive/negative rates
   - Adjust thresholds as needed

## Testing and Verification

### Initial Testing

1. **Verify bot connectivity**:
   ```bash
   ./greatshield-win.exe health
   ```

2. **Test basic commands**:
   - `/guardian status` - Check bot status
   - `/guardian policies` - List available policies
   - `/guardian test` - Run diagnostic tests

3. **Test moderation functionality**:
   - Send test messages in a private channel
   - Verify AI analysis and action taking
   - Check logging and reporting

### Performance Testing

1. **Load testing** (optional):
   ```bash
   ./greatshield-win.exe benchmark --messages 100 --concurrent 10
   ```

2. **Monitor resource usage**:
   - Check CPU and memory consumption
   - Monitor database performance
   - Verify log file rotation

## Troubleshooting

### Common Issues

1. **Bot not responding**:
   - ✅ Check bot token validity
   - ✅ Verify bot permissions in Discord
   - ✅ Ensure bot is online in server member list
   - ✅ Check network connectivity

2. **AI moderation not working**:
   - ✅ Verify Ollama service is running
   - ✅ Check Ollama model availability
   - ✅ Test Ollama API connectivity
   - ✅ Review policy configuration

3. **Database errors**:
   - ✅ Check file permissions for database directory
   - ✅ Ensure sufficient disk space
   - ✅ Verify SQLite installation

4. **High resource usage**:
   - ✅ Adjust AI model settings
   - ✅ Configure caching parameters
   - ✅ Review log levels and retention
   - ✅ Optimize policy complexity

### Debug Mode

Enable debug logging for troubleshooting:

```json
{
  "logging": {
    "level": 0,
    "enableConsole": true,
    "enableFile": true
  }
}
```

### Getting Help

1. **Check logs**:
   - Application logs: `./logs/greatshield.log`
   - Error logs: `./logs/error.log`
   - Security logs: `./logs/security.log`

2. **Community support**:
   - GitHub Issues: [Report bugs or request features](https://github.com/greatshield/greatshield-bot/issues)
   - Discord Server: [Join our community](https://discord.gg/greatshield)
   - Documentation: [Full documentation](https://docs.greatshield.bot)

3. **Professional support**:
   - Enterprise support available
   - Custom policy development
   - Integration assistance

## Next Steps

After successful setup:

1. **Configure backup schedules** - See [Backup Guide](./BACKUP_GUIDE.md)
2. **Set up monitoring** - See [Monitoring Guide](./MONITORING_GUIDE.md)
3. **Customize policies** - See [Policy Guide](./POLICY_GUIDE.md)
4. **API integration** - See [API Documentation](./API_GUIDE.md)

---

**Need help?** Check our [FAQ](./FAQ.md) or [contact support](./SUPPORT.md).