class CloudUploader {
  constructor(options = {}) {
    this.options = options;
    this.name = "base";
  }

  async initialize() {
    throw new Error("initialize() must be implemented by subclass");
  }

  async uploadFile(localPath, remotePath) {
    throw new Error("uploadFile() must be implemented by subclass");
  }

  async uploadBuffer(buffer, remotePath) {
    throw new Error("uploadBuffer() must be implemented by subclass");
  }

  async downloadFile(remotePath, localPath) {
    throw new Error("downloadFile() must be implemented by subclass");
  }

  async listFiles(prefix) {
    throw new Error("listFiles() must be implemented by subclass");
  }

  async deleteFile(remotePath) {
    throw new Error("deleteFile() must be implemented by subclass");
  }

  async fileExists(remotePath) {
    throw new Error("fileExists() must be implemented by subclass");
  }

  async ensureDirectory(dirPath) {
    throw new Error("ensureDirectory() must be implemented by subclass");
  }

  async verifyUpload(localPath, remotePath) {
    return true;
  }

  getProviderName() {
    return this.name;
  }

  getConfig() {
    return { provider: this.name, ...this.options };
  }
}

module.exports = { CloudUploader };
