import { Logger } from '../utils/Logger';
import { DatabaseManager } from '../database/DatabaseManager';

export interface Metric {
  name: string;
  value: number;
  timestamp: Date;
  tags?: Record<string, string>;
  type: 'counter' | 'gauge' | 'histogram' | 'timer';
}

export interface MetricSummary {
  name: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  latest: number;
  timestamp: Date;
}

export interface SystemMetrics {
  moderation: {
    messagesProcessed: number;
    actionsTaken: number;
    averageProcessingTime: number;
    fastPassHitRate: number;
    aiAnalysisRate: number;
  };
  performance: {
    memoryUsage: number;
    cpuUsage: number;
    databaseConnections: number;
    cacheHitRate: number;
    averageResponseTime: number;
  };
  security: {
    rateLimitViolations: number;
    blockedMessages: number;
    sanitizedContent: number;
    securityThreats: number;
  };
  uptime: number;
  timestamp: Date;
}

export class MetricsCollector {
  private logger: Logger;
  private db: DatabaseManager;
  private metrics = new Map<string, Metric[]>();
  private timers = new Map<string, number>();
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  
  private maxMetricsHistory = 10000;
  private cleanupInterval = 60000; // 1 minute
  private cleanupTimer?: NodeJS.Timeout;

  constructor(db: DatabaseManager, logger: Logger) {
    this.db = db;
    this.logger = logger;
    
    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldMetrics();
    }, this.cleanupInterval);

    this.logger.info('MetricsCollector initialized');
  }

  /**
   * Record a counter metric (cumulative)
   */
  incrementCounter(name: string, value: number = 1, tags?: Record<string, string>): void {
    const currentValue = this.counters.get(name) || 0;
    this.counters.set(name, currentValue + value);
    
    this.recordMetric({
      name,
      value: currentValue + value,
      timestamp: new Date(),
      tags,
      type: 'counter'
    });
  }

  /**
   * Record a gauge metric (instantaneous value)
   */
  recordGauge(name: string, value: number, tags?: Record<string, string>): void {
    this.gauges.set(name, value);
    
    this.recordMetric({
      name,
      value,
      timestamp: new Date(),
      tags,
      type: 'gauge'
    });
  }

  /**
   * Start timing an operation
   */
  startTimer(name: string): void {
    this.timers.set(name, Date.now());
  }

  /**
   * End timing and record the duration
   */
  endTimer(name: string, tags?: Record<string, string>): number {
    const startTime = this.timers.get(name);
    if (!startTime) {
      this.logger.warn('Timer not found', { name });
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(name);

    this.recordMetric({
      name,
      value: duration,
      timestamp: new Date(),
      tags,
      type: 'timer'
    });

    return duration;
  }

  /**
   * Record a histogram value
   */
  recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
    this.recordMetric({
      name,
      value,
      timestamp: new Date(),
      tags,
      type: 'histogram'
    });
  }

  /**
   * Record moderation metrics
   */
  recordModerationMetric(
    action: 'message_processed' | 'action_taken' | 'fast_pass_hit' | 'ai_analysis',
    processingTime?: number,
    actionType?: string
  ): void {
    const tags: Record<string, string> = {};
    
    if (actionType) {
      tags.actionType = actionType;
    }

    switch (action) {
      case 'message_processed':
        this.incrementCounter('moderation.messages_processed', 1, tags);
        if (processingTime !== undefined) {
          this.recordHistogram('moderation.processing_time', processingTime, tags);
        }
        break;
        
      case 'action_taken':
        this.incrementCounter('moderation.actions_taken', 1, tags);
        break;
        
      case 'fast_pass_hit':
        this.incrementCounter('moderation.fast_pass_hits', 1, tags);
        break;
        
      case 'ai_analysis':
        this.incrementCounter('moderation.ai_analysis_count', 1, tags);
        if (processingTime !== undefined) {
          this.recordHistogram('moderation.ai_processing_time', processingTime, tags);
        }
        break;
    }
  }

  /**
   * Record security metrics
   */
  recordSecurityMetric(
    type: 'rate_limit_violation' | 'blocked_message' | 'sanitized_content' | 'security_threat',
    severity?: 'low' | 'medium' | 'high' | 'critical',
    details?: Record<string, string>
  ): void {
    const tags: Record<string, string> = { ...details };
    
    if (severity) {
      tags.severity = severity;
    }

    switch (type) {
      case 'rate_limit_violation':
        this.incrementCounter('security.rate_limit_violations', 1, tags);
        break;
        
      case 'blocked_message':
        this.incrementCounter('security.blocked_messages', 1, tags);
        break;
        
      case 'sanitized_content':
        this.incrementCounter('security.sanitized_content', 1, tags);
        break;
        
      case 'security_threat':
        this.incrementCounter('security.threats_detected', 1, tags);
        break;
    }
  }

  /**
   * Record performance metrics
   */
  recordPerformanceMetrics(): void {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Memory metrics
    this.recordGauge('performance.memory.heap_used', memoryUsage.heapUsed);
    this.recordGauge('performance.memory.heap_total', memoryUsage.heapTotal);
    this.recordGauge('performance.memory.rss', memoryUsage.rss);
    this.recordGauge('performance.memory.external', memoryUsage.external);

    // CPU metrics (convert from microseconds)
    this.recordGauge('performance.cpu.user', cpuUsage.user / 1000);
    this.recordGauge('performance.cpu.system', cpuUsage.system / 1000);

    // Database metrics
    const dbStats = this.db.getPerformanceStats();
    if (dbStats.cache) {
      this.recordGauge('performance.cache.hit_rate', dbStats.cache.hitRate || 0);
      this.recordGauge('performance.cache.size', dbStats.cache.size || 0);
      this.recordGauge('performance.cache.memory_usage', dbStats.cache.memoryUsage || 0);
    }

    if (dbStats.connectionPool) {
      this.recordGauge('performance.db.total_connections', dbStats.connectionPool.totalConnections || 0);
      this.recordGauge('performance.db.active_connections', dbStats.connectionPool.activeConnections || 0);
      this.recordGauge('performance.db.average_acquire_time', dbStats.connectionPool.averageAcquireTime || 0);
    }

    // Process metrics
    this.recordGauge('performance.process.uptime', process.uptime());
    this.recordGauge('performance.process.active_handles', process._getActiveHandles().length);
    this.recordGauge('performance.process.active_requests', process._getActiveRequests().length);
  }

  /**
   * Get metric summary for a specific metric
   */
  getMetricSummary(name: string, timeRange?: { start: Date; end: Date }): MetricSummary | null {
    const metricData = this.metrics.get(name);
    if (!metricData || metricData.length === 0) {
      return null;
    }

    let filteredData = metricData;
    if (timeRange) {
      filteredData = metricData.filter(m => 
        m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
      );
    }

    if (filteredData.length === 0) {
      return null;
    }

    const values = filteredData.map(m => m.value);
    const sum = values.reduce((a, b) => a + b, 0);
    const count = values.length;
    const avg = sum / count;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const latest = filteredData[filteredData.length - 1].value;

    return {
      name,
      count,
      sum,
      avg,
      min,
      max,
      latest,
      timestamp: new Date()
    };
  }

  /**
   * Get comprehensive system metrics
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    // Record current performance metrics
    this.recordPerformanceMetrics();

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const timeRange = { start: oneHourAgo, end: now };

    // Get moderation metrics
    const messagesProcessed = this.getMetricSummary('moderation.messages_processed', timeRange);
    const actionsTaken = this.getMetricSummary('moderation.actions_taken', timeRange);
    const processingTime = this.getMetricSummary('moderation.processing_time', timeRange);
    const fastPassHits = this.getMetricSummary('moderation.fast_pass_hits', timeRange);
    const aiAnalysis = this.getMetricSummary('moderation.ai_analysis_count', timeRange);

    // Get performance metrics
    const memoryUsage = this.getMetricSummary('performance.memory.heap_used');
    const cpuUsage = this.getMetricSummary('performance.cpu.user');
    const dbConnections = this.getMetricSummary('performance.db.active_connections');
    const cacheHitRate = this.getMetricSummary('performance.cache.hit_rate');
    const responseTime = this.getMetricSummary('moderation.processing_time', timeRange);

    // Get security metrics
    const rateLimitViolations = this.getMetricSummary('security.rate_limit_violations', timeRange);
    const blockedMessages = this.getMetricSummary('security.blocked_messages', timeRange);
    const sanitizedContent = this.getMetricSummary('security.sanitized_content', timeRange);
    const securityThreats = this.getMetricSummary('security.threats_detected', timeRange);

    return {
      moderation: {
        messagesProcessed: messagesProcessed?.latest || 0,
        actionsTaken: actionsTaken?.latest || 0,
        averageProcessingTime: processingTime?.avg || 0,
        fastPassHitRate: fastPassHits && messagesProcessed 
          ? (fastPassHits.latest / messagesProcessed.latest) 
          : 0,
        aiAnalysisRate: aiAnalysis && messagesProcessed 
          ? (aiAnalysis.latest / messagesProcessed.latest) 
          : 0
      },
      performance: {
        memoryUsage: memoryUsage?.latest || 0,
        cpuUsage: cpuUsage?.latest || 0,
        databaseConnections: dbConnections?.latest || 0,
        cacheHitRate: cacheHitRate?.latest || 0,
        averageResponseTime: responseTime?.avg || 0
      },
      security: {
        rateLimitViolations: rateLimitViolations?.latest || 0,
        blockedMessages: blockedMessages?.latest || 0,
        sanitizedContent: sanitizedContent?.latest || 0,
        securityThreats: securityThreats?.latest || 0
      },
      uptime: process.uptime(),
      timestamp: now
    };
  }

  /**
   * Get metrics for a specific time range
   */
  getMetrics(
    names?: string[],
    timeRange?: { start: Date; end: Date },
    tags?: Record<string, string>
  ): Metric[] {
    let allMetrics: Metric[] = [];

    const metricsToInclude = names || Array.from(this.metrics.keys());

    for (const name of metricsToInclude) {
      const metricData = this.metrics.get(name) || [];
      allMetrics = allMetrics.concat(metricData);
    }

    // Filter by time range
    if (timeRange) {
      allMetrics = allMetrics.filter(m => 
        m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
      );
    }

    // Filter by tags
    if (tags) {
      allMetrics = allMetrics.filter(m => {
        if (!m.tags) return false;
        return Object.entries(tags).every(([key, value]) => 
          m.tags![key] === value
        );
      });
    }

    return allMetrics.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Export metrics to JSON
   */
  exportMetrics(timeRange?: { start: Date; end: Date }): {
    metrics: Metric[];
    counters: Record<string, number>;
    gauges: Record<string, number>;
    exportTime: Date;
  } {
    return {
      metrics: this.getMetrics(undefined, timeRange),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      exportTime: new Date()
    };
  }

  /**
   * Get metric names
   */
  getMetricNames(): string[] {
    return Array.from(this.metrics.keys()).sort();
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics.clear();
    this.counters.clear();
    this.gauges.clear();
    this.timers.clear();
    
    this.logger.info('All metrics cleared');
  }

  /**
   * Record a metric
   */
  private recordMetric(metric: Metric): void {
    if (!this.metrics.has(metric.name)) {
      this.metrics.set(metric.name, []);
    }

    const metricList = this.metrics.get(metric.name)!;
    metricList.push(metric);

    // Maintain maximum history size
    if (metricList.length > this.maxMetricsHistory) {
      metricList.splice(0, metricList.length - this.maxMetricsHistory);
    }
  }

  /**
   * Clean up old metrics
   */
  private cleanupOldMetrics(): void {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    let totalRemoved = 0;

    for (const [name, metricList] of this.metrics.entries()) {
      const originalLength = metricList.length;
      
      // Keep only metrics from the last 24 hours
      const filteredMetrics = metricList.filter(m => m.timestamp > cutoffTime);
      
      if (filteredMetrics.length !== originalLength) {
        this.metrics.set(name, filteredMetrics);
        totalRemoved += originalLength - filteredMetrics.length;
      }
    }

    if (totalRemoved > 0) {
      this.logger.debug('Cleaned up old metrics', {
        removed: totalRemoved,
        remaining: Array.from(this.metrics.values()).reduce((sum, arr) => sum + arr.length, 0)
      });
    }
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.logger.info('MetricsCollector destroyed');
  }
}