const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let XLSX = null;
try {
  XLSX = require("xlsx");
} catch {
}

class ExcelExporter {
  constructor(options = {}) {
    this.compact = options.compact !== false;
  }

  async exportAll(mockStore, outputDir, checksums, ctx) {
    const files = [];
    if (!XLSX) {
      const logger = require("../services/BackupLogger").getBackupLogger();
      logger.warn("[ExcelExporter] xlsx library not available — skipping Excel export");
      return files;
    }

    const tableNames = Object.keys(mockStore).filter((key) => Array.isArray(mockStore[key]));

    for (const tableName of tableNames) {
      const rows = mockStore[tableName] || [];
      const fileInfo = await this.exportTable(tableName, rows, outputDir, checksums, ctx);
      if (fileInfo) {
        files.push(fileInfo);
      }
    }

    return files;
  }

  async exportTable(tableName, rows, outputDir, checksums, ctx) {
    if (!XLSX) return null;

    const filename = `${tableName}.xlsx`;
    const filePath = path.join(outputDir, filename);

    const data = rows || [];
    const worksheet = XLSX.utils.json_to_sheet(data);

    const colWidths = this._calculateColWidths(data);
    worksheet["!cols"] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, tableName.substring(0, 31));

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
      ...(this.compact ? { compression: true } : {}),
    });

    fs.writeFileSync(filePath, buffer);

    const fileContent = fs.readFileSync(filePath);
    const checksum = crypto.createHash("sha256").update(fileContent).digest("hex");
    checksums[filename] = checksum;

    return {
      filename,
      path: filename,
      absolutePath: filePath,
      size: fileContent.length,
      sha256: checksum,
      rowCount: data.length,
      tableName,
      format: "xlsx",
    };
  }

  _calculateColWidths(data) {
    if (!data || data.length === 0) return [];
    const keys = Object.keys(data[0] || {});
    return keys.map((key) => {
      let maxLen = key.length;
      for (const row of data) {
        const val = row[key];
        if (val !== null && val !== undefined) {
          const strLen = String(val).length;
          if (strLen > maxLen) maxLen = strLen;
        }
      }
      return { wch: Math.min(Math.max(maxLen + 2, 10), 60) };
    });
  }
}

module.exports = { ExcelExporter };
