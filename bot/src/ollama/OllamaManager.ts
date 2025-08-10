import axios from 'axios';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const execAsync = promisify(exec);

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export interface OllamaResponse {
  models: OllamaModel[];
}

export interface GenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  context?: number[];
  stream?: boolean;
  format?: 'json';
  options?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
  };
}

export interface GenerateResponse {
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaManager {
  private host: string;
  private timeout: number;

  constructor(host: string = 'http://localhost:11434', timeout: number = 60000) {
    this.host = host.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = timeout;
  }

  async checkInstallation(): Promise<boolean> {
    try {
      // Check if Ollama is in PATH
      await execAsync('ollama --version');
      return true;
    } catch {
      // Try alternative locations
      const possiblePaths = this.getOllamaPaths();
      
      for (const ollamaPath of possiblePaths) {
        try {
          if (fs.existsSync(ollamaPath)) {
            await execAsync(`"${ollamaPath}" --version`);
            return true;
          }
        } catch {
          continue;
        }
      }
      
      return false;
    }
  }

  private getOllamaPaths(): string[] {
    const platform = os.platform();
    const homeDir = os.homedir();
    
    switch (platform) {
      case 'win32':
        return [
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
          path.join(process.env.PROGRAMFILES || '', 'Ollama', 'ollama.exe'),
          'C:\\Program Files\\Ollama\\ollama.exe',
          'C:\\Users\\' + os.userInfo().username + '\\AppData\\Local\\Programs\\Ollama\\ollama.exe'
        ];
      case 'darwin':
        return [
          '/usr/local/bin/ollama',
          '/opt/homebrew/bin/ollama',
          path.join(homeDir, '.local', 'bin', 'ollama'),
          '/Applications/Ollama.app/Contents/Resources/ollama'
        ];
      case 'linux':
        return [
          '/usr/local/bin/ollama',
          '/usr/bin/ollama',
          path.join(homeDir, '.local', 'bin', 'ollama'),
          '/opt/ollama/bin/ollama'
        ];
      default:
        return ['/usr/local/bin/ollama', '/usr/bin/ollama'];
    }
  }

  async installOllama(): Promise<void> {
    const platform = os.platform();
    
    console.log(chalk.blue('🔄 Installing Ollama...'));
    
    try {
      switch (platform) {
        case 'win32':
          await this.installOllamaWindows();
          break;
        case 'darwin':
          await this.installOllamaMacOS();
          break;
        case 'linux':
          await this.installOllamaLinux();
          break;
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }
      
      // Wait a bit for installation to complete
      await this.sleep(3000);
      
      // Verify installation
      const isInstalled = await this.checkInstallation();
      if (!isInstalled) {
        throw new Error('Installation verification failed');
      }
      
      // Start Ollama service
      await this.startOllamaService();
      
    } catch (error) {
      throw new Error(`Failed to install Ollama: ${error}`);
    }
  }

  private async installOllamaWindows(): Promise<void> {
    // Download and install Ollama for Windows
    const downloadUrl = 'https://ollama.ai/download/windows';
    const tempPath = path.join(os.tmpdir(), 'OllamaSetup.exe');
    
    console.log(chalk.gray('Downloading Ollama installer...'));
    
    try {
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream',
        timeout: 300000 // 5 minutes
      });
      
      const writer = fs.createWriteStream(tempPath);
      response.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      
      console.log(chalk.gray('Running installer...'));
      await execAsync(`"${tempPath}" /S`); // Silent installation
      
      // Clean up
      fs.unlinkSync(tempPath);
      
    } catch (error) {
      throw new Error(`Windows installation failed: ${error}`);
    }
  }

  private async installOllamaMacOS(): Promise<void> {
    // Try Homebrew first, then direct download
    try {
      console.log(chalk.gray('Installing via Homebrew...'));
      await execAsync('brew install ollama');
    } catch {
      console.log(chalk.gray('Homebrew not available, downloading directly...'));
      
      const downloadUrl = 'https://ollama.ai/download/mac';
      const tempPath = path.join(os.tmpdir(), 'Ollama.dmg');
      
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream',
        timeout: 300000
      });
      
      const writer = fs.createWriteStream(tempPath);
      response.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      
      // Mount and install
      await execAsync(`hdiutil attach "${tempPath}"`);
      await execAsync('cp -R "/Volumes/Ollama/Ollama.app" "/Applications/"');
      await execAsync('hdiutil detach "/Volumes/Ollama"');
      
      // Clean up
      fs.unlinkSync(tempPath);
    }
  }

  private async installOllamaLinux(): Promise<void> {
    console.log(chalk.gray('Installing Ollama for Linux...'));
    
    try {
      // Use the official install script
      await execAsync('curl -fsSL https://ollama.ai/install.sh | sh');
    } catch (error) {
      throw new Error(`Linux installation failed: ${error}`);
    }
  }

  private async startOllamaService(): Promise<void> {
    try {
      console.log(chalk.blue('🚀 Starting Ollama service...'));
      
      const platform = os.platform();
      
      if (platform === 'win32') {
        // On Windows, Ollama typically runs as a service
        spawn('ollama', ['serve'], {
          detached: true,
          stdio: 'ignore'
        });
      } else {
        // On Unix systems
        spawn('ollama', ['serve'], {
          detached: true,
          stdio: 'ignore'
        });
      }
      
      // Wait for service to start
      await this.sleep(5000);
      
      // Verify service is running
      await this.checkConnection();
      
    } catch (error) {
      console.log(chalk.yellow('⚠️  Could not start Ollama service automatically. Please start it manually: ollama serve'));
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.host}/api/tags`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get<OllamaResponse>(`${this.host}/api/tags`, {
        timeout: 10000
      });
      
      return response.data.models.map(model => model.name);
    } catch (error) {
      throw new Error(`Failed to list models: ${error}`);
    }
  }

  async pullModel(modelName: string): Promise<void> {
    try {
      console.log(chalk.blue(`📥 Downloading model: ${modelName}`));
      
      // Use streaming to show progress
      const response = await axios.post(
        `${this.host}/api/pull`,
        { name: modelName, stream: true },
        {
          responseType: 'stream',
          timeout: 1800000 // 30 minutes for large models
        }
      );

      let lastProgress = 0;
      
      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              
              if (data.status && data.status.includes('pulling')) {
                const progress = Math.round((data.completed || 0) / (data.total || 1) * 100);
                if (progress > lastProgress && progress % 10 === 0) {
                  console.log(chalk.gray(`Progress: ${progress}%`));
                  lastProgress = progress;
                }
              }
              
              if (data.status === 'success') {
                console.log(chalk.green(`✅ Model ${modelName} downloaded successfully`));
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      });

      await new Promise((resolve, reject) => {
        response.data.on('end', resolve);
        response.data.on('error', reject);
      });
      
    } catch (error) {
      throw new Error(`Failed to pull model ${modelName}: ${error}`);
    }
  }

  async generateText(request: GenerateRequest): Promise<GenerateResponse> {
    try {
      const response = await axios.post<GenerateResponse>(
        `${this.host}/api/generate`,
        {
          ...request,
          stream: false // We want a single response
        },
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Ollama service is not running. Please start it with "ollama serve"');
        }
        if (error.response?.status === 404) {
          throw new Error(`Model not found: ${request.model}. Please pull the model first.`);
        }
      }
      throw new Error(`Failed to generate text: ${error}`);
    }
  }

  async isModelAvailable(modelName: string): Promise<boolean> {
    try {
      const models = await this.listModels();
      return models.includes(modelName);
    } catch {
      return false;
    }
  }

  async getModelInfo(modelName: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.host}/api/show`,
        { name: modelName },
        { timeout: 10000 }
      );
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get model info for ${modelName}: ${error}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Health check method
  async healthCheck(): Promise<{
    isRunning: boolean;
    modelsAvailable: number;
    host: string;
    error?: string;
  }> {
    try {
      const isRunning = await this.checkConnection();
      
      if (!isRunning) {
        return {
          isRunning: false,
          modelsAvailable: 0,
          host: this.host,
          error: 'Ollama service is not running'
        };
      }

      const models = await this.listModels();
      
      return {
        isRunning: true,
        modelsAvailable: models.length,
        host: this.host
      };
      
    } catch (error) {
      return {
        isRunning: false,
        modelsAvailable: 0,
        host: this.host,
        error: String(error)
      };
    }
  }
}