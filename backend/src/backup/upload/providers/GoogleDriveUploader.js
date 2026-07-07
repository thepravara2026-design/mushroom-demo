const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CloudUploader } = require("../CloudUploader");

let google = null;
try {
  google = require("googleapis");
} catch {
}

class GoogleDriveUploader extends CloudUploader {
  constructor(options = {}) {
    super(options);
    this.name = "google_drive";
    this.drive = null;
    this.auth = null;
    this.rootFolderId = null;
    this.folderCache = {};
    this.maxRetries = options.maxRetries || 5;
    this.baseBackupPath = options.baseBackupPath || process.env.GOOGLE_DRIVE_BACKUP_FOLDER || "Sporekart Backups";
  }

  async initialize() {
    if (!google) {
      throw new Error(
        "googleapis package is not installed. Run: npm install googleapis"
      );
    }

    const credentialsPath =
      this.options.credentialsPath ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!credentialsPath) {
      throw new Error(
        "GOOGLE_APPLICATION_CREDENTIALS environment variable must be set to the path of a service account JSON file"
      );
    }

    if (!fs.existsSync(credentialsPath)) {
      throw new Error(
        `Google service account credentials file not found: ${credentialsPath}`
      );
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));

    this.auth = new google.google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    this.drive = google.google.drive({ version: "v3", auth: this.auth });

    await this.auth.authorize();

    this.rootFolderId = await this._ensureFolderTree(this.baseBackupPath);

    return true;
  }

  async uploadFile(localPath, remotePath) {
    const remoteDir = path.dirname(remotePath);
    const fileName = path.basename(remotePath);
    const parentFolderId = await this._ensureFolderTree(
      path.join(this.baseBackupPath, remoteDir)
    );

    const fileSize = fs.statSync(localPath).size;

    const media = {
      mimeType: this._getMimeType(fileName),
      body: fs.createReadStream(localPath),
    };

    const resource = {
      name: fileName,
      parents: [parentFolderId],
      description: `Sporekart Backup — ${fileName}`,
    };

    let lastError = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.drive.files.create({
          resource,
          media,
          fields: "id, name, size, mimeType, createdTime",
          supportsAllDrives: true,
        });

        const fileId = response.data.id;

        await this.drive.permissions.create({
          fileId,
          requestBody: {
            role: "reader",
            type: "user",
            emailAddress: this.options.adminEmail || process.env.GOOGLE_DRIVE_ADMIN_EMAIL,
          },
        });

        return {
          provider: this.name,
          fileId,
          path: remotePath,
          remotePath,
          size: fileSize,
          mimeType: response.data.mimeType,
          createdTime: response.data.createdTime,
        };
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries - 1) {
          await new Promise((r) =>
            setTimeout(r, Math.min(Math.pow(2, attempt) * 2000, 30000))
          );
        }
      }
    }

    throw new Error(
      `Google Drive upload failed after ${this.maxRetries} retries: ${lastError.message}`
    );
  }

  async uploadBuffer(buffer, remotePath) {
    const remoteDir = path.dirname(remotePath);
    const fileName = path.basename(remotePath);
    const parentFolderId = await this._ensureFolderTree(
      path.join(this.baseBackupPath, remoteDir)
    );

    const media = {
      mimeType: this._getMimeType(fileName),
      body: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
    };

    const resource = {
      name: fileName,
      parents: [parentFolderId],
    };

    const response = await this.drive.files.create({
      resource,
      media,
      fields: "id, name, size, mimeType, createdTime",
      supportsAllDrives: true,
    });

    return {
      provider: this.name,
      fileId: response.data.id,
      path: remotePath,
      remotePath,
      size: buffer.length,
      mimeType: response.data.mimeType,
      createdTime: response.data.createdTime,
    };
  }

  async downloadFile(remotePath, localPath) {
    const fileId = await this._resolvePathToId(remotePath);
    if (!fileId) {
      throw new Error(`File not found on Google Drive: ${remotePath}`);
    }

    const destDir = path.dirname(localPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const response = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    const writer = fs.createWriteStream(localPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  async listFiles(prefix) {
    const folderId = await this._resolvePathToId(prefix || "");
    if (!folderId) return [];

    const results = [];
    let pageToken = null;

    do {
      const response = await this.drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "files(id, name, size, mimeType, createdTime, modifiedTime)",
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
      });

      for (const file of response.data.files || []) {
        results.push({
          id: file.id,
          name: file.name,
          size: parseInt(file.size || "0", 10),
          mimeType: file.mimeType,
          createdTime: file.createdTime,
          modifiedTime: file.modifiedTime,
          path: prefix ? `${prefix}/${file.name}` : file.name,
        });
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return results;
  }

  async deleteFile(remotePath) {
    const fileId = await this._resolvePathToId(remotePath);
    if (!fileId) return false;

    await this.drive.files.delete({
      fileId,
      supportsAllDrives: true,
    });

    return true;
  }

  async fileExists(remotePath) {
    const fileId = await this._resolvePathToId(remotePath);
    return fileId !== null;
  }

  async ensureDirectory(dirPath) {
    const fullPath = path.join(this.baseBackupPath, dirPath);
    return await this._ensureFolderTree(fullPath);
  }

  async verifyUpload(localPath, remotePath) {
    const fileId = await this._resolvePathToId(remotePath);
    if (!fileId) return false;

    try {
      const response = await this.drive.files.get(
        { fileId, alt: "media" },
        { responseType: "arraybuffer" }
      );

      const hash = crypto.createHash("sha256");
      hash.update(Buffer.from(response.data));
      const remoteDigest = hash.digest("hex");

      const localHash = crypto.createHash("sha256");
      localHash.update(fs.readFileSync(localPath));
      const localDigest = localHash.digest("hex");

      return localDigest === remoteDigest;
    } catch {
      return false;
    }
  }

  async _ensureFolderTree(folderPath) {
    if (this.folderCache[folderPath]) {
      return this.folderCache[folderPath];
    }

    const parts = folderPath.split("/").filter(Boolean);
    let parentId = "root";
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (this.folderCache[currentPath]) {
        parentId = this.folderCache[currentPath];
        continue;
      }

      const folderId = await this._findOrCreateFolder(part, parentId);
      this.folderCache[currentPath] = folderId;
      parentId = folderId;
    }

    if (!this.folderCache[folderPath]) {
      this.folderCache[folderPath] = parentId;
    }

    return parentId;
  }

  async _findOrCreateFolder(name, parentId) {
    const response = await this.drive.files.list({
      q: `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
      pageSize: 1,
      supportsAllDrives: true,
    });

    if (response.data.files && response.data.files.length > 0) {
      return response.data.files[0].id;
    }

    const folder = await this.drive.files.create({
      resource: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      },
      fields: "id",
      supportsAllDrives: true,
    });

    return folder.data.id;
  }

  async _resolvePathToId(remotePath) {
    const fullPath = path.join(this.baseBackupPath, remotePath);
    const normalized = fullPath.replace(/\\/g, "/");

    if (this.folderCache[normalized]) {
      return this.folderCache[normalized];
    }

    const parts = normalized.split("/").filter(Boolean);
    let parentId = "root";
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (this.folderCache[currentPath]) {
        parentId = this.folderCache[currentPath];
        continue;
      }

      const response = await this.drive.files.list({
        q: `name='${part.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`,
        fields: "files(id, name, mimeType)",
        pageSize: 1,
        supportsAllDrives: true,
      });

      if (!response.data.files || response.data.files.length === 0) {
        return null;
      }

      parentId = response.data.files[0].id;
      this.folderCache[currentPath] = parentId;
    }

    return parentId;
  }

  _getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      ".sql": "application/sql",
      ".json": "application/json",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".zip": "application/zip",
      ".gz": "application/gzip",
      ".enc": "application/octet-stream",
      ".log": "text/plain",
      ".txt": "text/plain",
      ".csv": "text/csv",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }
}

module.exports = { GoogleDriveUploader };
