const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CloudUploader } = require("../CloudUploader");

class LocalUploader extends CloudUploader {
  constructor(options = {}) {
    super(options);
    this.name = "local";
    this.basePath = options.basePath || process.env.BACKUP_STORAGE_PATH || path.join(process.cwd(), "backups");
    this.maxRetries = options.maxRetries || 3;
    this.validatePath();
  }

  validatePath() {
    if (!this.basePath || typeof this.basePath !== "string") {
      throw new Error("BACKUP_STORAGE_PATH must be a valid string");
    }

    const resolved = path.resolve(this.basePath);
    if (!resolved.startsWith(path.resolve("/")) && !resolved.match(/^[a-zA-Z]:\\/)) {
      throw new Error(`Invalid backup path: ${this.basePath}`);
    }

    const normalized = path.normalize(this.basePath);
    if (normalized !== this.basePath && !normalized.startsWith(this.basePath)) {
      throw new Error(`Path traversal detected in BACKUP_STORAGE_PATH: ${this.basePath}`);
    }

    this.basePath = resolved;
  }

  async initialize() {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }

    try {
      fs.accessSync(this.basePath, fs.constants.W_OK);
    } catch {
      throw new Error(`Backup directory is not writable: ${this.basePath}`);
    }

    return true;
  }

  async uploadFile(localPath, remotePath) {
    const destPath = path.join(this.basePath, remotePath);
    const destDir = path.dirname(destPath);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    await this._copyWithRetry(localPath, destPath, 0);

    return {
      provider: this.name,
      fileId: remotePath,
      path: destPath,
      remotePath,
      size: fs.statSync(destPath).size,
    };
  }

  async uploadBuffer(buffer, remotePath) {
    const destPath = path.join(this.basePath, remotePath);
    const destDir = path.dirname(destPath);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.writeFileSync(destPath, buffer);

    return {
      provider: this.name,
      fileId: remotePath,
      path: destPath,
      remotePath,
      size: buffer.length,
    };
  }

  async downloadFile(remotePath, localPath) {
    const sourcePath = path.join(this.basePath, remotePath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`File not found: ${remotePath}`);
    }

    const destDir = path.dirname(localPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(sourcePath, localPath);
  }

  async listFiles(prefix) {
    const searchPath = path.join(this.basePath, prefix || "");
    const results = [];

    if (!fs.existsSync(searchPath)) return results;

    const entries = fs.readdirSync(searchPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(searchPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...await this.listFiles(path.join(prefix || "", entry.name)));
      } else {
        const stat = fs.statSync(fullPath);
        results.push({
          name: entry.name,
          path: path.join(prefix || "", entry.name),
          fullPath,
          size: stat.size,
          lastModified: stat.mtime.toISOString(),
        });
      }
    }

    return results;
  }

  async deleteFile(remotePath) {
    const filePath = path.join(this.basePath, remotePath);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });

      let dir = path.dirname(filePath);
      while (dir.startsWith(this.basePath)) {
        const contents = fs.readdirSync(dir);
        if (contents.length === 0) {
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        } else {
          break;
        }
      }

      return true;
    }
    return false;
  }

  async fileExists(remotePath) {
    return fs.existsSync(path.join(this.basePath, remotePath));
  }

  async ensureDirectory(dirPath) {
    const fullPath = path.join(this.basePath, dirPath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    return fullPath;
  }

  async verifyUpload(localPath, remotePath) {
    const destPath = path.join(this.basePath, remotePath);
    if (!fs.existsSync(destPath)) return false;

    const localHash = crypto.createHash("sha256");
    localHash.update(fs.readFileSync(localPath));
    const localDigest = localHash.digest("hex");

    const remoteHash = crypto.createHash("sha256");
    remoteHash.update(fs.readFileSync(destPath));
    const remoteDigest = remoteHash.digest("hex");

    return localDigest === remoteDigest;
  }

  async _copyWithRetry(src, dest, attempt) {
    try {
      fs.copyFileSync(src, dest);
    } catch (err) {
      if (attempt < this.maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        return this._copyWithRetry(src, dest, attempt + 1);
      }
      throw err;
    }
  }
}

module.exports = { LocalUploader };
