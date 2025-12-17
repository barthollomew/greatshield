import { Logger } from '../utils/Logger';
import { HealthChecker, HealthCheck, SystemHealth } from './HealthChecker';
import { MetricsCollector, SystemMetrics } from './MetricsCollector';

export interface Alert {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  source: string;
  timestamp: Date;
  acknowledged: boolean;
  resolved: boolean;
  resolvedAt?: Date;
  data?: Record<string, any>;
}

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  condition: AlertCondition;
  level: Alert['level'];
  message: string;
  cooldown: number; // milliseconds
  lastTriggered?: Date;
}

export interface AlertCondition {
  type: 'threshold' | 'change' | 'absence' | 'pattern';
  metric?: string;
  operator?: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value?: number;
  timeWindow?: number; // milliseconds
  healthCheck?: string;
  pattern?: string;
}

export interface AlertChannel {
  id: string;
  name: string;
  type: 'discord' | 'webhook' | 'email' | 'console';
  config: Record<string, any>;
  enabled: boolean;
}

export class AlertManager {
  private logger: Logger;
  private healthChecker: HealthChecker;
  private metricsCollector: MetricsCollector;
  private alerts = new Map<string, Alert>();
  private alertRules = new Map<string, AlertRule>();
  private alertChannels = new Map<string, AlertChannel>();
  private checkInterval = 30000; // 30 seconds
  private intervalTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    healthChecker: HealthChecker,
    metricsCollector: MetricsCollector,
    logger: Logger
  ) {
    this.healthChecker = healthChecker;
    this.metricsCollector = metricsCollector;
    this.logger = logger;

    // Set up default alert rules
    this.setupDefaultAlertRules();
    
    // Set up default console channel
    this.addAlertChannel({
      id: 'console',
      name: 'Console Logger',
      type: 'console',
      config: {},
      enabled: true
    });
  }

  /**
   * Start alert monitoring
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('Alert manager is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Alert manager starting');

    // Run initial check
    this.checkAlerts();

    // Schedule periodic checks
    this.intervalTimer = setInterval(() => {
      this.checkAlerts();
    }, this.checkInterval);
  }

  /**
   * Stop alert monitoring
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }

    this.logger.info('Alert manager stopped');
  }

  /**
   * Add an alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    this.logger.info('Alert rule added', { id: rule.id, name: rule.name });
  }

  /**
   * Remove an alert rule
   */
  removeAlertRule(ruleId: string): boolean {
    const removed = this.alertRules.delete(ruleId);
    if (removed) {
      this.logger.info('Alert rule removed', { id: ruleId });
    }
    return removed;
  }

  /**
   * Add an alert channel
   */
  addAlertChannel(channel: AlertChannel): void {
    this.alertChannels.set(channel.id, channel);
    this.logger.info('Alert channel added', { id: channel.id, type: channel.type });
  }

  /**
   * Remove an alert channel
   */
  removeAlertChannel(channelId: string): boolean {
    const removed = this.alertChannels.delete(channelId);
    if (removed) {
      this.logger.info('Alert channel removed', { id: channelId });
    }
    return removed;
  }

  /**
   * Trigger a manual alert
   */
  async triggerAlert(
    level: Alert['level'],
    title: string,
    message: string,
    source: string = 'manual',
    data?: Record<string, any>
  ): Promise<Alert> {
    const alert: Alert = {
      id: this.generateAlertId(),
      level,
      title,
      message,
      source,
      timestamp: new Date(),
      acknowledged: false,
      resolved: false,
      data
    };

    this.alerts.set(alert.id, alert);
    await this.sendAlert(alert);

    this.logger.info('Manual alert triggered', {
      id: alert.id,
      level: alert.level,
      title: alert.title
    });

    return alert;
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.acknowledged) {
      return false;
    }

    alert.acknowledged = true;
    this.alerts.set(alertId, alert);

    this.logger.info('Alert acknowledged', { id: alertId });
    return true;
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.resolved) {
      return false;
    }

    alert.resolved = true;
    alert.resolvedAt = new Date();
    this.alerts.set(alertId, alert);

    this.logger.info('Alert resolved', { id: alertId });
    return true;
  }

  /**
   * Get all alerts
   */
  getAlerts(filters?: {
    level?: Alert['level'];
    resolved?: boolean;
    acknowledged?: boolean;
    source?: string;
    since?: Date;
  }): Alert[] {
    let alerts = Array.from(this.alerts.values());

    if (filters) {
      if (filters.level) {
        alerts = alerts.filter(a => a.level === filters.level);
      }
      if (filters.resolved !== undefined) {
        alerts = alerts.filter(a => a.resolved === filters.resolved);
      }
      if (filters.acknowledged !== undefined) {
        alerts = alerts.filter(a => a.acknowledged === filters.acknowledged);
      }
      if (filters.source) {
        alerts = alerts.filter(a => a.source === filters.source);
      }
      if (filters.since) {
        alerts = alerts.filter(a => a.timestamp >= filters.since!);
      }
    }

    return alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get alert summary
   */
  getAlertSummary(): {
    total: number;
    unresolved: number;
    unacknowledged: number;
    byLevel: Record<Alert['level'], number>;
    recent: Alert[];
  } {
    const alerts = Array.from(this.alerts.values());
    const byLevel: Record<Alert['level'], number> = {
      info: 0,
      warning: 0,
      error: 0,
      critical: 0
    };

    alerts.forEach(alert => {
      byLevel[alert.level]++;
    });

    const recent = alerts
      .filter(a => a.timestamp.getTime() > Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10);

    return {
      total: alerts.length,
      unresolved: alerts.filter(a => !a.resolved).length,
      unacknowledged: alerts.filter(a => !a.acknowledged).length,
      byLevel,
      recent
    };
  }

  /**
   * Check all alert rules
   */
  private async checkAlerts(): Promise<void> {
    try {
      const systemHealth = this.healthChecker.getSystemHealth();
      const systemMetrics = await this.metricsCollector.getSystemMetrics();

      for (const rule of this.alertRules.values()) {
        if (!rule.enabled) continue;

        // Check cooldown
        if (rule.lastTriggered && 
            Date.now() - rule.lastTriggered.getTime() < rule.cooldown) {
          continue;
        }

        const shouldTrigger = await this.evaluateAlertRule(rule, systemHealth, systemMetrics);
        
        if (shouldTrigger) {
          const alert = await this.createAlertFromRule(rule, systemHealth, systemMetrics);
          rule.lastTriggered = new Date();
          this.alertRules.set(rule.id, rule);
        }
      }

    } catch (error) {
      this.logger.error('Error checking alerts', { error: String(error) });
    }
  }

  /**
   * Evaluate if an alert rule should trigger
   */
  private async evaluateAlertRule(
    rule: AlertRule,
    systemHealth: SystemHealth,
    systemMetrics: SystemMetrics
  ): Promise<boolean> {
    const { condition } = rule;

    switch (condition.type) {
      case 'threshold':
        return this.evaluateThresholdCondition(condition, systemMetrics);
        
      case 'change':
        return this.evaluateChangeCondition(condition, systemMetrics);
        
      case 'absence':
        return this.evaluateAbsenceCondition(condition, systemHealth);
        
      case 'pattern':
        return this.evaluatePatternCondition(condition, systemHealth);
        
      default:
        this.logger.warn('Unknown alert condition type', { type: condition.type });
        return false;
    }
  }

  /**
   * Evaluate threshold-based conditions
   */
  private evaluateThresholdCondition(
    condition: AlertCondition,
    systemMetrics: SystemMetrics
  ): boolean {
    if (!condition.metric || !condition.operator || condition.value === undefined) {
      return false;
    }

    const value = this.getMetricValue(condition.metric, systemMetrics);
    if (value === null) return false;

    switch (condition.operator) {
      case '>': return value > condition.value;
      case '<': return value < condition.value;
      case '>=': return value >= condition.value;
      case '<=': return value <= condition.value;
      case '==': return value === condition.value;
      case '!=': return value !== condition.value;
      default: return false;
    }
  }

  /**
   * Evaluate change-based conditions
   */
  private evaluateChangeCondition(
    condition: AlertCondition,
    systemMetrics: SystemMetrics
  ): boolean {
    // This would require storing historical metrics for comparison
    // For now, return false
    return false;
  }

  /**
   * Evaluate absence conditions (health checks)
   */
  private evaluateAbsenceCondition(
    condition: AlertCondition,
    systemHealth: SystemHealth
  ): boolean {
    if (!condition.healthCheck) return false;

    const healthCheck = systemHealth.checks.find(c => c.name === condition.healthCheck);
    return !healthCheck || healthCheck.status === 'unhealthy';
  }

  /**
   * Evaluate pattern-based conditions
   */
  private evaluatePatternCondition(
    condition: AlertCondition,
    systemHealth: SystemHealth
  ): boolean {
    if (!condition.pattern) return false;

    // Simple pattern matching on system status
    const pattern = new RegExp(condition.pattern, 'i');
    return pattern.test(systemHealth.overall);
  }

  /**
   * Create an alert from a triggered rule
   */
  private async createAlertFromRule(
    rule: AlertRule,
    systemHealth: SystemHealth,
    systemMetrics: SystemMetrics
  ): Promise<Alert> {
    const alert: Alert = {
      id: this.generateAlertId(),
      level: rule.level,
      title: rule.name,
      message: rule.message,
      source: `rule:${rule.id}`,
      timestamp: new Date(),
      acknowledged: false,
      resolved: false,
      data: {
        rule: rule.id,
        condition: rule.condition,
        systemHealth: systemHealth.overall,
        systemMetrics: {
          memoryUsage: systemMetrics.performance.memoryUsage,
          cpuUsage: systemMetrics.performance.cpuUsage,
          uptime: systemMetrics.uptime
        }
      }
    };

    this.alerts.set(alert.id, alert);
    await this.sendAlert(alert);

    return alert;
  }

  /**
   * Send alert through all enabled channels
   */
  private async sendAlert(alert: Alert): Promise<void> {
    const enabledChannels = Array.from(this.alertChannels.values())
      .filter(channel => channel.enabled);

    const sendPromises = enabledChannels.map(channel => 
      this.sendAlertToChannel(alert, channel)
    );

    await Promise.allSettled(sendPromises);
  }

  /**
   * Send alert to a specific channel
   */
  private async sendAlertToChannel(alert: Alert, channel: AlertChannel): Promise<void> {
    try {
      switch (channel.type) {
        case 'console':
          this.sendConsoleAlert(alert);
          break;
          
        case 'discord':
          await this.sendDiscordAlert(alert, channel.config);
          break;
          
        case 'webhook':
          await this.sendWebhookAlert(alert, channel.config);
          break;
          
        case 'email':
          await this.sendEmailAlert(alert, channel.config);
          break;
          
        default:
          this.logger.warn('Unknown alert channel type', { 
            type: channel.type,
            channelId: channel.id 
          });
      }

    } catch (error) {
      this.logger.error('Failed to send alert to channel', {
        alertId: alert.id,
        channelId: channel.id,
        error: String(error)
      });
    }
  }

  /**
   * Send console alert
   */
  private sendConsoleAlert(alert: Alert): void {
    const levelEmoji = {
      info: '[info]',
      warning: '[warn]',
      error: '[error]',
      critical: '[critical]'
    };

    const message = `${levelEmoji[alert.level]} [${alert.level.toUpperCase()}] ${alert.title}: ${alert.message}`;
    
    switch (alert.level) {
      case 'critical':
      case 'error':
        this.logger.error(message, { alertId: alert.id, data: alert.data });
        break;
      case 'warning':
        this.logger.warn(message, { alertId: alert.id, data: alert.data });
        break;
      default:
        this.logger.info(message, { alertId: alert.id, data: alert.data });
    }
  }

  /**
   * Send Discord alert (placeholder)
   */
  private async sendDiscordAlert(alert: Alert, config: Record<string, any>): Promise<void> {
    // This would integrate with Discord webhook or bot
    this.logger.info('Discord alert sent', { alertId: alert.id });
  }

  /**
   * Send webhook alert (placeholder)
   */
  private async sendWebhookAlert(alert: Alert, config: Record<string, any>): Promise<void> {
    // This would make HTTP request to webhook URL
    this.logger.info('Webhook alert sent', { alertId: alert.id });
  }

  /**
   * Send email alert (placeholder)
   */
  private async sendEmailAlert(alert: Alert, config: Record<string, any>): Promise<void> {
    // This would send email via SMTP
    this.logger.info('Email alert sent', { alertId: alert.id });
  }

  /**
   * Get metric value from system metrics
   */
  private getMetricValue(metricPath: string, systemMetrics: SystemMetrics): number | null {
    const parts = metricPath.split('.');
    let current: any = systemMetrics;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return null;
      }
    }

    return typeof current === 'number' ? current : null;
  }

  /**
   * Setup default alert rules
   */
  private setupDefaultAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high_memory_usage',
        name: 'High Memory Usage',
        enabled: true,
        condition: {
          type: 'threshold',
          metric: 'performance.memoryUsage',
          operator: '>',
          value: 500 * 1024 * 1024 // 500MB
        },
        level: 'warning',
        message: 'Memory usage is high',
        cooldown: 5 * 60 * 1000 // 5 minutes
      },
      {
        id: 'critical_memory_usage',
        name: 'Critical Memory Usage',
        enabled: true,
        condition: {
          type: 'threshold',
          metric: 'performance.memoryUsage',
          operator: '>',
          value: 1024 * 1024 * 1024 // 1GB
        },
        level: 'critical',
        message: 'Memory usage is critically high',
        cooldown: 2 * 60 * 1000 // 2 minutes
      },
      {
        id: 'database_unhealthy',
        name: 'Database Unhealthy',
        enabled: true,
        condition: {
          type: 'absence',
          healthCheck: 'database'
        },
        level: 'critical',
        message: 'Database health check failed',
        cooldown: 1 * 60 * 1000 // 1 minute
      },
      {
        id: 'ollama_unhealthy',
        name: 'Ollama Service Unhealthy',
        enabled: true,
        condition: {
          type: 'absence',
          healthCheck: 'ollama'
        },
        level: 'error',
        message: 'Ollama service health check failed',
        cooldown: 2 * 60 * 1000 // 2 minutes
      },
      {
        id: 'high_security_threats',
        name: 'High Security Threat Activity',
        enabled: true,
        condition: {
          type: 'threshold',
          metric: 'security.securityThreats',
          operator: '>',
          value: 10
        },
        level: 'warning',
        message: 'Unusually high security threat activity detected',
        cooldown: 10 * 60 * 1000 // 10 minutes
      }
    ];

    defaultRules.forEach(rule => this.addAlertRule(rule));
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop();
    this.logger.info('AlertManager destroyed');
  }
}