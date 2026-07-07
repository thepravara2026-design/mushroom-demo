const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class StorageBackup {
  constructor(options = {}) {
    this.supabase = options.supabase || null;
    this.isMock = options.isMock !== false;
  }

  async exportAll(mockStore, outputDir, checksums, ctx) {
    const files = [];

    const mockStorageFile = await this._backupMockStoreSnapshot(mockStore, outputDir, checksums, ctx);
    if (mockStorageFile) {
      files.push(mockStorageFile);
    }

    const supabaseBuckets = await this._backupSupabaseBuckets(outputDir, checksums, ctx);
    files.push(...supabaseBuckets);

    return files;
  }

  async _backupMockStoreSnapshot(mockStore, outputDir, checksums, ctx) {
    const storageDir = path.join(outputDir, "storage");
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const snapshotPath = path.join(storageDir, "mock_store_snapshot.json");
    const snapshot = {};

    const tableNames = Object.keys(mockStore).filter((key) => Array.isArray(mockStore[key]));
    for (const tableName of tableNames) {
      snapshot[tableName] = {
        rowCount: (mockStore[tableName] || []).length,
        schema: Object.keys(mockStore[tableName][0] || {}),
      };
    }

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

    const fileContent = fs.readFileSync(snapshotPath);
    const checksum = crypto.createHash("sha256").update(fileContent).digest("hex");
    checksums["storage/mock_store_snapshot.json"] = checksum;

    return {
      filename: "mock_store_snapshot.json",
      path: "storage/mock_store_snapshot.json",
      absolutePath: snapshotPath,
      size: fileContent.length,
      sha256: checksum,
      format: "json",
      category: "storage",
    };
  }

  async _backupSupabaseBuckets(outputDir, checksums, ctx) {
    const files = [];

    if (this.isMock || !this.supabase) {
      return files;
    }

    try {
      const { data: buckets } = await this.supabase.storage.listBuckets();
      if (!buckets || buckets.length === 0) return files;

      const storageDir = path.join(outputDir, "storage", "buckets");
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }

      for (const bucket of buckets) {
        const bucketDir = path.join(storageDir, bucket.name);
        if (!fs.existsSync(bucketDir)) {
          fs.mkdirSync(bucketDir, { recursive: true });
        }

        await this._downloadBucketContents(bucket.name, "", bucketDir, files, checksums);
      }
    } catch (err) {
      const logger = require("../services/BackupLogger").getBackupLogger();
      logger.warn(`[StorageBackup] Supabase bucket backup failed: ${err.message}`);
    }

    return files;
  }

  async _downloadBucketContents(bucketName, prefix, outputDir, files, checksums) {
    if (!this.supabase) return;

    try {
      const { data: items, error } = await this.supabase.storage
        .from(bucketName)
        .list(prefix, { limit: 1000 });

      if (error) throw error;
      if (!items) return;

      for (const item of items) {
        if (item.id) {
          const filePath = prefix ? `${prefix}/${item.name}` : item.name;
          const localPath = path.join(outputDir, filePath);
          const localDir = path.dirname(localPath);

          if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
          }

          try {
            const { data, error: downloadError } = await this.supabase.storage
              .from(bucketName)
              .download(filePath);

            if (downloadError) throw downloadError;
            if (data) {
              const buffer = Buffer.from(await data.arrayBuffer());
              fs.writeFileSync(localPath, buffer);

              const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
              checksums[`storage/buckets/${bucketName}/${filePath}`] = checksum;

              files.push({
                filename: filePath,
                path: `storage/buckets/${bucketName}/${filePath}`,
                absolutePath: localPath,
                size: buffer.length,
                sha256: checksum,
                format: "binary",
                category: "storage",
                bucketName,
              });
            }
          } catch (err) {
            const logger = require("../services/BackupLogger").getBackupLogger();
            logger.warn(`[StorageBackup] Failed to download ${bucketName}/${filePath}: ${err.message}`);
          }
        } else {
          await this._downloadBucketContents(bucketName, item.name, outputDir, files, checksums);
        }
      }
    } catch (err) {
      const logger = require("../services/BackupLogger").getBackupLogger();
      logger.warn(`[StorageBackup] Failed to list ${bucketName}/${prefix}: ${err.message}`);
    }
  }
}

module.exports = { StorageBackup };
