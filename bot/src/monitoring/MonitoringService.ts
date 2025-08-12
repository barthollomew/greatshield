import { Logger } from '../utils/Logger';
import { DatabaseManager } from '../database/DatabaseManager';
import { OllamaManager } from '../ollama/OllamaManager';
import { HealthChecker, SystemHealth } from './HealthChecker';
import { MetricsCollector, SystemMetrics } from './MetricsCollector';
import { AlertManager, Alert } from './AlertManager';

export interface MonitoringConfig {
  healthCheck: {
    enabled: boolean;
    interval: number;
    timeout: number;
    retryAttempts: number;
  };
  metrics: {
    enabled: boolean;
    collectionInterval: number;
    maxHistory: number;
  };
  alerts: {
    enabled: boolean;
    checkInterval: number;
  };
  reporting: {
    enabled: boolean;
    interval: number;
    includeMetrics: boolean;
    includeHealth: boolean;
  };
}

export interface MonitoringReport {
  timestamp: Date;
  uptime: number;
  systemHealth: SystemHealth;
  systemMetrics: SystemMetrics;
  alertSummary: any;
  performance: {
    avgResponseTime: number;
    requestsPerMinute: number;
    errorRate: number;
  };
  recommendations: string[];
}

export class MonitoringService {
  private logger: Logger;
  private db: DatabaseManager;
  private ollama: OllamaManager;
  private healthChecker: HealthChecker;
  private metricsCollector: MetricsCollector;
  private alertManager: AlertManager;
  private config: MonitoringConfig;
  private reportingTimer?: NodeJS.Timeout;
  private metricsTimer?: NodeJS.Timeout;
  private startTime: Date;
  private isRunning = false;

  constructor(
    db: DatabaseManager,
    ollama: OllamaManager,
    logger: Logger,
    config?: Partial<MonitoringConfig>
  ) {
    this.db = db;
    this.ollama = ollama;
    this.logger = logger;
    this.startTime = new Date();

    this.config = {
      healthCheck: {
        enabled: true,
        interval: 30000, // 30 seconds
        timeout: 10000, // 10 seconds
        retryAttempts: 3
      },
      metrics: {
        enabled: true,
        collectionInterval: 15000, // 15 seconds
        maxHistory: 10000
      },
      alerts: {
        enabled: true,
        checkInterval: 30000 // 30 seconds
      },
      reporting: {
        enabled: true,
        interval: 5 * 60 * 1000, // 5 minutes
        includeMetrics: true,
        includeHealth: true
      },
      ...config
    };

    // Initialize monitoring components
    this.healthChecker = new HealthChecker(
      this.db,
      this.ollama,
      this.logger,
      {
        checkInterval: this.config.healthCheck.interval,
        timeout: this.config.healthCheck.timeout,
        retryAttempts: this.config.healthCheck.retryAttempts
      }
    );

    this.metricsCollector = new MetricsCollector(this.db, this.logger);

    this.alertManager = new AlertManager(
      this.healthChecker,
      this.metricsCollector,
      this.logger
    );
  }

  /**
   * Start monitoring service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Monitoring service is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting monitoring service', this.config);

    try {
      // Start health checking
      if (this.config.healthCheck.enabled) {
        this.healthChecker.start();
      }

      // Start alert monitoring
      if (this.config.alerts.enabled) {
        this.alertManager.start();
      }

      // Start metrics collection
      if (this.config.metrics.enabled) {
        this.startMetricsCollection();
      }

      // Start periodic reporting
      if (this.config.reporting.enabled) {
        this.startPeriodicReporting();
      }

      // Initial metrics collection
      this.collectSystemMetrics();

      this.logger.info('Monitoring service started successfully');

    } catch (error) {
      this.logger.error('Failed to start monitoring service', { error: String(error) });
      throw error;
    }
  }

  /**
   * Stop monitoring service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    this.logger.info('Stopping monitoring service');

    try {
      // Stop all timers
      if (this.reportingTimer) {
        clearInterval(this.reportingTimer);
        this.reportingTimer = undefined;
      }

      if (this.metricsTimer) {
        clearInterval(this.metricsTimer);
        this.metricsTimer = undefined;
      }

      // Stop monitoring components
      this.healthChecker.stop();
      this.alertManager.stop();

      this.logger.info('Monitoring service stopped');

    } catch (error) {
      this.logger.error('Error stopping monitoring service', { error: String(error) });
    }
  }

  /**
   * Record moderation event
   */
  recordModerationEvent(
    type: 'message_processed' | 'action_taken' | 'fast_pass_hit' | 'ai_analysis',
    processingTime?: number,
    actionType?: string
  ): void {
    if (!this.config.metrics.enabled) return;

    this.metricsCollector.recordModerationMetric(type, processingTime, actionType);
  }

  /**
   * Record security event
   */
  recordSecurityEvent(
    type: 'rate_limit_violation' | 'blocked_message' | 'sanitized_content' | 'security_threat',
    severity?: 'low' | 'medium' | 'high' | 'critical',
    details?: Record<string, string>
  ): void {
    if (!this.config.metrics.enabled) return;

    this.metricsCollector.recordSecurityMetric(type, severity, details);

    // Trigger immediate alert for high-severity security events
    if (severity === 'critical' || severity === 'high') {
      this.alertManager.triggerAlert(
        severity === 'critical' ? 'critical' : 'warning',
        `Security Event: ${type}`,
        `High-severity security event detected: ${type}`,
        'security',
        { type, severity, ...details }
      );
    }
  }

  /**
   * Start performance timer
   */
  startPerformanceTimer(operation: string): void {
    if (!this.config.metrics.enabled) return;
    this.metricsCollector.startTimer(`performance.${operation}`);
  }

  /**
   * End performance timer
   */
  endPerformanceTimer(operation: string): number {
    if (!this.config.metrics.enabled) return 0;
    return this.metricsCollector.endTimer(`performance.${operation}`);
  }

  /**
   * Get current system status
   */
  async getSystemStatus(): Promise<{
    health: SystemHealth;
    metrics: SystemMetrics;
    alerts: any;
    uptime: number;
  }> {
    const health = this.healthChecker.getSystemHealth();
    const metrics = await this.metricsCollector.getSystemMetrics();
    const alerts = this.alertManager.getAlertSummary();

    return {
      health,
      metrics,
      alerts,
      uptime: Date.now() - this.startTime.getTime()
    };
  }

  /**
   * Generate comprehensive monitoring report
   */
  async generateReport(): Promise<MonitoringReport> {
    const systemHealth = this.healthChecker.getSystemHealth();
    const systemMetrics = await this.metricsCollector.getSystemMetrics();
    const alertSummary = this.alertManager.getAlertSummary();

    // Calculate performance metrics
    const avgResponseTime = systemMetrics.performance.averageResponseTime || 0;
    const requestsPerMinute = systemMetrics.moderation.messagesProcessed || 0;
    const errorRate = this.calculateErrorRate(systemHealth);

    // Generate recommendations
    const recommendations = this.generateRecommendations(systemHealth, systemMetrics);

    return {
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime(),
      systemHealth,
      systemMetrics,
      alertSummary,
      performance: {
        avgResponseTime,
        requestsPerMinute,
        errorRate
      },
      recommendations
    };
  }

  /**
   * Get alert manager instance
   */
  getAlertManager(): AlertManager {
    return this.alertManager;
  }

  /**
   * Get metrics collector instance
   */
  getMetricsCollector(): MetricsCollector {
    return this.metricsCollector;
  }

  /**
   * Get health checker instance
   */
  getHealthChecker(): HealthChecker {
    return this.healthChecker;
  }

  /**
   * Force health check
   */
  async forceHealthCheck(): Promise<SystemHealth> {
    return await this.healthChecker.forceCheck();
  }

  /**
   * Get monitoring configuration
   */
  getConfig(): MonitoringConfig {
    return { ...this.config };
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(newConfig: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Monitoring configuration updated', this.config);

    // Restart if running to apply new config
    if (this.isRunning) {
      this.stop().then(() => this.start());
    }
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    // Collect metrics immediately
    this.collectSystemMetrics();

    // Schedule periodic collection
    this.metricsTimer = setInterval(() => {
      this.collectSystemMetrics();
    }, this.config.metrics.collectionInterval);
  }

  /**
   * Collect system metrics
   */
  private collectSystemMetrics(): void {
    try {
      this.metricsCollector.recordPerformanceMetrics();
    } catch (error) {
      this.logger.error('Error collecting system metrics', { error: String(error) });
    }
  }

  /**
   * Start periodic reporting
   */
  private startPeriodicReporting(): void {
    this.reportingTimer = setInterval(async () => {
      try {
        const report = await this.generateReport();
        this.logger.info('Periodic monitoring report', {
          health: report.systemHealth.overall,
          uptime: Math.round(report.uptime / 1000),
          memoryUsage: Math.round(report.systemMetrics.performance.memoryUsage / 1024 / 1024),
          activeAlerts: report.alertSummary.unresolved,
          recommendations: report.recommendations.length
        });
      } catch (error) {
        this.logger.error('Error generating periodic report', { error: String(error) });
      }
    }, this.config.reporting.interval);
  }

  /**
   * Calculate error rate from health status
   */
  private calculateErrorRate(systemHealth: SystemHealth): number {
    const totalChecks = systemHealth.checks.length;
    if (totalChecks === 0) return 0;

    const failedChecks = systemHealth.checks.filter(
      check => check.status === 'unhealthy'
    ).length;

    return (failedChecks / totalChecks) * 100;
  }

  /**
   * Generate system recommendations
   */
  private generateRecommendations(
    systemHealth: SystemHealth,
    systemMetrics: SystemMetrics
  ): string[] {
    const recommendations: string[] = [];

    // Memory recommendations
    const memoryUsageMB = systemMetrics.performance.memoryUsage / 1024 / 1024;
    if (memoryUsageMB > 500) {
      recommendations.push('Consider increasing memory allocation or optimizing memory usage');
    }

    // Performance recommendations
    if (systemMetrics.performance.averageResponseTime > 1000) {
      recommendations.push('High response times detected - consider performance optimization');
    }

    // Cache recommendations
    if (systemMetrics.performance.cacheHitRate < 0.8) {
      recommendations.push('Low cache hit rate - consider adjusting cache settings');
    }

    // Health recommendations
    const unhealthyChecks = systemHealth.checks.filter(c => c.status === 'unhealthy');
    if (unhealthyChecks.length > 0) {
      recommendations.push(`Address unhealthy components: ${unhealthyChecks.map(c => c.name).join(', ')}`);
    }

    // Database recommendations
    if (systemMetrics.performance.databaseConnections > 8) {
      recommendations.push('High database connection usage - consider connection pool optimization');
    }

    // Security recommendations
    if (systemMetrics.security.securityThreats > 5) {
      recommendations.push('High security threat activity - review security policies');
    }

    return recommendations;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    await this.stop();
    
    this.healthChecker?.destroy?.();
    this.metricsCollector?.destroy?.();
    this.alertManager?.destroy?.();

    this.logger.info('Monitoring service destroyed');
  }
}