import path from 'path';
import fs from 'fs/promises';

export class WorkspaceManager {
  private basePath: string;

  constructor() {
    this.basePath = process.env.WORKSPACE_BASE_PATH || '/app/workspace';
  }

  /**
   * Get the workspace directory path for a specific email account
   */
  private getAccountPath(email: string): string {
    return path.join(this.basePath, email);
  }

  /**
   * Get the downloads directory path for a specific email account
   */
  private getDownloadsPath(email: string): string {
    return path.join(this.getAccountPath(email), 'downloads');
  }

  /**
   * Get the uploads directory path for a specific email account
   */
  private getUploadsPath(email: string): string {
    return path.join(this.getAccountPath(email), 'uploads');
  }

  /**
   * Get the shared temporary directory path
   */
  private getTempPath(): string {
    return path.join(this.basePath, 'shared', 'temp');
  }

  /**
   * Ensure all required directories exist for an email account
   */
  async initializeAccountDirectories(email: string): Promise<void> {
    const dirs = [
      this.getAccountPath(email),
      this.getDownloadsPath(email),
      this.getUploadsPath(email)
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    }
  }

  /**
   * Generate a path for a downloaded file
   */
  async getDownloadPath(email: string, filename: string): Promise<string> {
    await this.initializeAccountDirectories(email);
    return path.join(this.getDownloadsPath(email), filename);
  }

  /**
   * Generate a path for an upload file
   */
  async getUploadPath(email: string, filename: string): Promise<string> {
    await this.initializeAccountDirectories(email);
    return path.join(this.getUploadsPath(email), filename);
  }

  /**
   * Generate a temporary file path
   */
  async getTempFilePath(prefix: string): Promise<string> {
    const tempDir = this.getTempPath();
    await fs.mkdir(tempDir, { recursive: true, mode: 0o750 });
    const timestamp = new Date().getTime();
    const random = Math.random().toString(36).substring(2, 15);
    return path.join(tempDir, `${prefix}-${timestamp}-${random}`);
  }

  /**
   * Clean up old files in the temporary directory
   * @param maxAge Maximum age in milliseconds before a file is considered old
   */
  async cleanupTempFiles(maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
    const tempDir = this.getTempPath();
    try {
      const files = await fs.readdir(tempDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filePath);
        }
      }
    } catch (error: unknown) {
      // Ignore errors if temp directory doesn't exist
      if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

// Export singleton instance
export const workspaceManager = new WorkspaceManager();
