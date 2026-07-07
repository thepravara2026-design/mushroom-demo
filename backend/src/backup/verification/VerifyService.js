const crypto = require("crypto");
const fs = require("fs");
const { Transform } = require("stream");

class HashStream extends Transform {
  constructor() {
    super();
    this.hash = crypto.createHash("sha256");
    this.digest = null;
  }

  _transform(chunk, encoding, callback) {
    this.hash.update(chunk);
    this.push(chunk);
    callback();
  }

  _flush(callback) {
    this.digest = this.hash.digest("hex");
    callback();
  }
}

function computeChecksum(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function computeFileChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function createHashStream() {
  return new HashStream();
}

async function verifyChecksum(filePath, expectedChecksum) {
  const actual = await computeFileChecksum(filePath);
  return actual === expectedChecksum;
}

async function verifyAllFiles(manifest) {
  const results = [];
  const baseDir = path.dirname(manifest.manifestPath || "");

  for (const file of manifest.files || []) {
    const filePath = file.absolutePath || path.join(baseDir, file.path || "");
    let verified = false;
    let error = null;

    try {
      if (fs.existsSync(filePath)) {
        verified = await verifyChecksum(filePath, file.sha256);
      } else {
        error = "File not found";
      }
    } catch (err) {
      error = err.message;
    }

    results.push({
      file: file.path || file.filename,
      expectedChecksum: file.sha256,
      verified,
      error,
    });
  }

  const allVerified = results.every((r) => r.verified);
  return { allVerified, results };
}

const path = require("path");

module.exports = {
  HashStream,
  computeChecksum,
  computeFileChecksum,
  createHashStream,
  verifyChecksum,
  verifyAllFiles,
};
