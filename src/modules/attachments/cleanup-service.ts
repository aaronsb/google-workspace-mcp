import { AttachmentIndexService } from './index-service.js';

/**
 * Service for managing attachment cleanup with intelligent scheduling
 */
export class AttachmentCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly baseIntervalMs = 300000; // 5 minutes
  private readonly maxIntervalMs = 3600000; // 1 hour
  private currentIntervalMs: number;
  private lastCleanupTime: number = 0;
  private lastIndexSize: number = 0;

  constructor(private indexService: AttachmentIndexService) {
    this.currentIntervalMs = this.baseIntervalMs;
  }

  /**
   * Start the cleanup service with adaptive scheduling
   */
  start(): void {
    if (this.cleanupInterval) {
      return; // Already running
    }

    // Initial state
    this.lastIndexSize = this.indexService.size;
    this.lastCleanupTime = Date.now();

    // Schedule first cleanup
    this.scheduleNextCleanup();
  }

  /**
   * Schedule next cleanup based on system activity
   */
  private scheduleNextCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setTimeout(() => {
      this.cleanup();
      this.scheduleNextCleanup();
    }, this.currentIntervalMs);
  }

  /**
   * Notify the cleanup service of system activity
   * Call this when attachments are added or accessed
   */
  notifyActivity(): void {
    const currentSize = this.indexService.size;
    const sizeIncreased = currentSize > this.lastIndexSize;
    
    // Decrease interval if we're seeing increased activity
    if (sizeIncreased) {
      this.currentIntervalMs = Math.max(
        this.baseIntervalMs,
        this.currentIntervalMs * 0.75
      );
      
      // Force immediate cleanup if we're near capacity
      if (currentSize >= this.indexService.maxEntries * 0.9) {
        this.cleanup();
        this.scheduleNextCleanup();
      }
    } else {
      // Gradually increase interval during low activity
      this.currentIntervalMs = Math.min(
        this.maxIntervalMs,
        this.currentIntervalMs * 1.25
      );
    }

    this.lastIndexSize = currentSize;
  }

  /**
   * Stop the cleanup service
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Run cleanup with performance monitoring
   */
  private cleanup(): void {
    try {
      const startTime = process.hrtime();
      
      // Only run if enough time has passed since last cleanup
      const timeSinceLastCleanup = Date.now() - this.lastCleanupTime;
      if (timeSinceLastCleanup < this.baseIntervalMs / 2) {
        return;
      }

      // Run cleanup
      this.indexService.cleanExpiredEntries();
      this.lastCleanupTime = Date.now();

      // Monitor performance
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const milliseconds = seconds * 1000 + nanoseconds / 1000000;
      
      // Adjust interval based on cleanup duration
      if (milliseconds > 100) { // If cleanup takes >100ms
        this.currentIntervalMs = Math.min(
          this.maxIntervalMs,
          this.currentIntervalMs * 1.5
        );
      }
    } catch (error) {
      console.error('Error during attachment cleanup:', error);
    }
  }
}
