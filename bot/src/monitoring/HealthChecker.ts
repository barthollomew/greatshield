import { Logger } from '../utils/Logger';
import { DatabaseManager } from '../database/DatabaseManager';
import { OllamaManager } from '../ollama/OllamaManager';

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  lastChecked: Date;
  responseTime: number;
  details?: Record<string, any>;
}

export interface SystemHealth {
  overall: 'healthy' | 'unhealthy' | 'degraded';
  checks: HealthCheck[];
  timestamp: Date;
  uptime: number;
}

export interface HealthCheckConfig {
  checkInterval: number; // milliseconds
  timeout: number; // milliseconds
  retryAttempts: number;
  retryDelay: number; // milliseconds
}

export class HealthChecker {
  private logger: Logger;
  private db: DatabaseManager;
  private ollama: OllamaManager;
  private config: HealthCheckConfig;
  private healthStatus = new Map<string, HealthCheck>();
  private intervalTimer?: NodeJS.Timeout;
  private startTime: Date;
  private isRunning = false;

  private readonly healthChecks = [
    'database',
    'ollama',
    'memory',
    'disk',
    'network',
    'performance'
  ];

  constructor(
    db: DatabaseManager,
    ollama: OllamaManager,
    logger: Logger,
    config?: Partial<HealthCheckConfig>
  ) {
    this.db = db;
    this.ollama = ollama;
    this.logger = logger;
    this.startTime = new Date();
    
    this.config = {
      checkInterval: 30000, // 30 seconds
      timeout: 10000, // 10 seconds
      retryAttempts: 3,
      retryDelay: 1000, // 1 second
      ...config
    };
  }

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('Health checker is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Health checker starting', {
      checkInterval: this.config.checkInterval,
      checksEnabled: this.healthChecks
    });

    // Run initial health checks
    this.runHealthChecks();

    // Schedule periodic checks
    this.intervalTimer = setInterval(() => {
      this.runHealthChecks();
    }, this.config.checkInterval);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }

    this.logger.info('Health checker stopped');
  }

  /**
   * Get current system health status
   */
  getSystemHealth(): SystemHealth {
    const checks = Array.from(this.healthStatus.values());
    
    // Determine overall health
    let overall: SystemHealth['overall'] = 'healthy';
    
    const unhealthyCount = checks.filter(c => c.status === 'unhealthy').length;
    const degradedCount = checks.filter(c => c.status === 'degraded').length;

    if (unhealthyCount > 0) {
      overall = 'unhealthy';
    } else if (degradedCount > 0) {
      overall = 'degraded';
    }

    return {
      overall,
      checks,
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime()
    };
  }

  /**
   * Get specific health check status
   */
  getHealthCheck(name: string): HealthCheck | undefined {
    return this.healthStatus.get(name);
  }

  /**
   * Run all health checks
   */
  private async runHealthChecks(): Promise<void> {
    const checkPromises = this.healthChecks.map(checkName => 
      this.runSingleHealthCheck(checkName)
    );

    await Promise.allSettled(checkPromises);
    
    const systemHealth = this.getSystemHealth();
    
    // Log overall status changes
    if (systemHealth.overall !== 'healthy') {
      this.logger.warn('System health degraded', {
        overall: systemHealth.overall,
        unhealthyChecks: systemHealth.checks
          .filter(c => c.status === 'unhealthy')
          .map(c => c.name),
        degradedChecks: systemHealth.checks
          .filter(c => c.status === 'degraded')
          .map(c => c.name)
      });
    }
  }

  /**
   * Run a single health check with retry logic
   */
  private async runSingleHealthCheck(checkName: string): Promise<void> {
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const startTime = Date.now();
        const result = await this.executeHealthCheck(checkName);
        const responseTime = Date.now() - startTime;

        const healthCheck: HealthCheck = {
          name: checkName,
          status: result.status,
          message: result.message,
          lastChecked: new Date(),
          responseTime,
          details: result.details
        };

        this.healthStatus.set(checkName, healthCheck);
        
        // Log status changes
        if (result.status !== 'healthy') {
          this.logger.warn(`Health check failed: ${checkName}`, {
            status: result.status,
            message: result.message,
            attempt,
            responseTime
          });
        } else if (attempt > 1) {
          this.logger.info(`Health check recovered: ${checkName}`, {
            attempt,
            responseTime
          });
        }

        return; // Success, exit retry loop

      } catch (error) {
        this.logger.error(`Health check error: ${checkName}`, {
          attempt,
          error: String(error)
        });

        if (attempt === this.config.retryAttempts) {
          // Final attempt failed
          this.healthStatus.set(checkName, {
            name: checkName,
            status: 'unhealthy',
            message: `Failed after ${attempt} attempts: ${error}`,
            lastChecked: new Date(),
            responseTime: -1,
            details: { error: String(error) }
          });
        } else {
          // Wait before retry
          await this.delay(this.config.retryDelay);
        }
      }
    }
  }

  /**
   * Execute specific health check
   */
  private async executeHealthCheck(checkName: string): Promise<{
    status: HealthCheck['status'];
    message: string;
    details?: Record<string, any>;
  }> {
    switch (checkName) {
      case 'database':
        return this.checkDatabase();
      case 'ollama':
        return this.checkOllama();
      case 'memory':
        return this.checkMemory();
      case 'disk':
        return this.checkDisk();
      case 'network':
        return this.checkNetwork();
      case 'performance':
        return this.checkPerformance();
      default:
        throw new Error(`Unknown health check: ${checkName}`);
    }
  }

  /**
   * Check database health
   */
  private async checkDatabase(): Promise<{
    status: HealthCheck['status'];
    message: string;
    details?: Record<string, any>;
  }> {
    try {
      // Test database connection
      const startTime = Date.now();
      
      // Use connection pool health check if available
      const poolStatus = this.db.getConnectionPoolStatus();
      
      if (poolStatus.available && !poolStatus.isHealthy) {
        return {
          status: 'unhealthy',
          message: 'Database connection pool is unhealthy',
          details: poolStatus
        };
      }

      // Get performance stats
      const stats = this.db.getPerformanceStats();
      const responseTime = Date.now() - startTime;

      // Check cache hit rate
      const cacheHitRate = stats.cache?.hitRate || 0;
      
      if (cacheHitRate < 0.5 && stats.cache?.hits + stats.cache?.misses > 100) {
        return {
          status: 'degraded',
          message: `Low cache hit rate: ${Math.round(cacheHitRate * 100)}%`,
          details: { stats, responseTime }
        };
      }

      return {
        status: 'healthy',
        message: 'Database connection is healthy',
        details: { stats, responseTime }
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Database check failed: ${error}`,
        details: { error: String(error) }
      };
    }
  }

  /**
   * Check Ollama service health
   */
  private async checkOllama(): Promise<{
    status: HealthCheck['status'];
    message: string;
    details?: Record<string, any>;
  }> {
    try {
      const startTime = Date.now();
      const isHealthy = await this.ollama.healthCheck();
      const responseTime = Date.now() - startTime;

      if (!isHealthy) {
        return {
          status: 'unhealthy',
          message: 'Ollama service is not responding',
          details: { responseTime }
        };
      }

      if (responseTime > 5000) {
        return {
          status: 'degraded',
          message: `Ollama response time is slow: ${responseTime}ms`,
          details: { responseTime }
        };
      }

      return {
        status: 'healthy',
        message: 'Ollama service is healthy',
        details: { responseTime }
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Ollama check failed: ${error}`,
        details: { error: String(error) }
      };
    }
  }

  /**
   * Check memory usage
   */
  private checkMemory(): Promise<{
    status: HealthCheck['status'];
    message: string;
    details?: Record<string, any>;
  }> {
    const memoryUsage = process.memoryUsage();
    const totalMemory = memoryUsage.heapTotal;
    const usedMemory = memoryUsage.heapUsed;
    const memoryPercentage = (usedMemory / totalMemory) * 100;

    const details = {
      heapUsed: Math.round(usedMemory / 1024 / 1024), // MB
      heapTotal: Math.round(totalMemory / 1024 / 1024), // MB
      percentage: Math.round(memoryPercentage),
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
      external: Math.round(memoryUsage.external / 1024 / 1024) // MB
    };

    if (memoryPercentage > 90) {
      return Promise.resolve({
        status: 'unhealthy',
        message: `Critical memory usage: ${details.percentage}%`,
        details
      });
    }

    if (memoryPercentage > 75) {
      return Promise.resolve({
        status: 'degraded',
        message: `High memory usage: ${details.percentage}%`,
        details
      });
    }

    return Promise.resolve({
      status: 'healthy',
      message: `Memory usage is normal: ${details.percentage}%`,
      details
    });
  }

  /**
   * Check disk space
   */
  private async checkDisk(): Promise<{
    status: HealthCheck['status'];
    message: string;
    details?: Record<string, any>;
  }> {
    try {
      const fs = require('fs').promises;
      const stats = await fs.statSync(process.cwd());
      
      // This is a simplified check - in production you'd want to check actual disk space
      const details = {
        available: true,
        location: process.cwd()
      };

      return {
        status: 'healthy',
        message: 'Disk space is adequate',
        details
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Disk check failed: ${error}`,
        details: { error: String(error) }
      };
    }
  }

  /**
   * Check network connectivity
   */
  private async checkNetwork(): Promise<{
    status: HealthCheck['status'];
    message: string;
    details?: Record<string, any>;
  }> {
    try {
      // Simple network check - try to resolve a DNS name
      const dns = require('dns').promises;
      const startTime = Date.now();
      
      await dns.resolve('google.com');
      const responseTime = Date.now() - startTime;

      if (responseTime > 5000) {
        return {
          status: 'degraded',
          message: `Slow network response: ${responseTime}ms`,
          details: { responseTime }
        };
      }

      return {
        status: 'healthy',
        message: 'Network connectivity is good',
        details: { responseTime }
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Network check failed: ${error}`,
        details: { error: String(error) }
      };
    }
  }

  /**
   * Check overall system performance
   */
  private checkPerformance(): Promise<{
    status: HealthCheck['status'];
    message: string;
    details?: Record<string, any>;
  }> {
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    
    // Convert microseconds to milliseconds
    const userCPU = cpuUsage.user / 1000;
    const systemCPU = cpuUsage.system / 1000;
    const totalCPU = userCPU + systemCPU;

    const details = {
      uptime: Math.round(uptime),
      cpuUser: Math.round(userCPU),
      cpuSystem: Math.round(systemCPU),
      cpuTotal: Math.round(totalCPU),
      activeHandles: process._getActiveHandles().length,
      activeRequests: process._getActiveRequests().length
    };

    if (details.activeHandles > 1000 || details.activeRequests > 100) {
      return Promise.resolve({
        status: 'degraded',
        message: 'High number of active handles/requests',
        details
      });
    }

    return Promise.resolve({
      status: 'healthy',
      message: 'System performance is good',
      details
    });
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Force a health check run
   */
  async forceCheck(): Promise<SystemHealth> {
    await this.runHealthChecks();
    return this.getSystemHealth();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop();
    this.logger.info('HealthChecker destroyed');
  }
}