const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class JsonExporter {
  constructor(options = {}) {
    this.pretty = options.pretty !== false;
  }

  async exportAll(mockStore, outputDir, checksums, ctx) {
    const files = [];
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
    const ext = ".json";
    const filename = `${tableName}${ext}`;
    const filePath = path.join(outputDir, filename);

    const data = rows || [];
    const jsonStr = this.pretty
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);

    fs.writeFileSync(filePath, jsonStr, "utf8");

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
      format: "json",
    };
  }
}

module.exports = { JsonExporter };
