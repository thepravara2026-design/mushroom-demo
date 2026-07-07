const crypto = require("crypto");
const { Transform } = require("stream");
const zlib = require("zlib");
const fs = require("fs");

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const KEY_ROTATION_PREFIX_LENGTH = 8;

function getEncryptionKey() {
  const keyHex = process.env.BACKUP_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length < 64) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY environment variable is missing or invalid. " +
      "Must be at least 64 hex characters (32 bytes)."
    );
  }
  const raw = keyHex.substring(0, 64);
  const key = Buffer.from(raw, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes. Got ${key.length} bytes.`
    );
  }
  return key;
}

function generateEncryptionKey() {
  return crypto.randomBytes(KEY_LENGTH).toString("hex");
}

class EncryptStream extends Transform {
  constructor(key, iv) {
    super();
    this.key = key;
    this.iv = iv || crypto.randomBytes(IV_LENGTH);
    this.cipher = crypto.createCipheriv(ALGORITHM, this.key, this.iv);
    this.tag = null;
  }

  _transform(chunk, encoding, callback) {
    try {
      const encrypted = this.cipher.update(chunk);
      this.push(encrypted);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  _flush(callback) {
    try {
      const final = this.cipher.final();
      this.tag = this.cipher.getAuthTag();
      this.push(final);
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

class DecryptStream extends Transform {
  constructor(key, iv, authTag) {
    super();
    this.decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    this.decipher.setAuthTag(authTag);
  }

  _transform(chunk, encoding, callback) {
    try {
      const decrypted = this.decipher.update(chunk);
      this.push(decrypted);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  _flush(callback) {
    try {
      const final = this.decipher.final();
      this.push(final);
      callback();
    } catch (err) {
      callback(err);
    }
  }
}

function createKeyId(encryptionKey) {
  return crypto.createHash("sha256").update(encryptionKey).digest("hex").substring(0, KEY_ROTATION_PREFIX_LENGTH);
}

function buildHeader(key, iv, authTag, compressed) {
  return {
    version: 1,
    algorithm: ALGORITHM,
    keyId: createKeyId(key),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    compressed,
    createdAt: new Date().toISOString(),
  };
}

function parseHeader(encryptedBuffer) {
  const newlineIdx = encryptedBuffer.indexOf(10);
  if (newlineIdx === -1) {
    throw new Error("Invalid encrypted file format: no header found");
  }
  const header = JSON.parse(encryptedBuffer.slice(0, newlineIdx).toString());
  if (header.version !== 1) {
    throw new Error(`Unsupported encryption version: ${header.version}`);
  }
  if (!header.iv || !header.authTag) {
    throw new Error("Invalid encrypted file header: missing iv or authTag");
  }
  return {
    header,
    headerSize: newlineIdx + 1,
    iv: Buffer.from(header.iv, "hex"),
    authTag: Buffer.from(header.authTag, "hex"),
    compressed: header.compressed !== false,
  };
}

async function encryptStream(inputStream, options = {}) {
  const key = options.key || getEncryptionKey();
  const compress = options.compress !== false;

  return new Promise((resolve, reject) => {
    const chunks = [];
    let currentStream = inputStream;

    if (compress) {
      currentStream = currentStream.pipe(zlib.createGzip());
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const encryptTransform = new EncryptStream(key, iv);
    const outputStream = currentStream.pipe(encryptTransform);

    outputStream.on("data", (chunk) => chunks.push(chunk));
    outputStream.on("end", () => {
      try {
        const authTag = encryptTransform.tag || Buffer.alloc(0);
        const header = buildHeader(key, iv, authTag, compress);
        const headerBuf = Buffer.from(JSON.stringify(header) + "\n");
        resolve(Buffer.concat([headerBuf, ...chunks]));
      } catch (err) {
        reject(err);
      }
    });
    outputStream.on("error", reject);
  });
}

async function decryptBuffer(encryptedBuffer) {
  const key = getEncryptionKey();
  const parsed = parseHeader(encryptedBuffer);
  const data = encryptedBuffer.slice(parsed.headerSize);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, parsed.iv);
  decipher.setAuthTag(parsed.authTag);

  let decrypted;
  try {
    decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  } catch (err) {
    throw new Error(`Decryption failed - data may be tampered: ${err.message}`);
  }

  if (parsed.compressed) {
    return new Promise((resolve, reject) => {
      zlib.gunzip(decrypted, (err, result) => {
        if (err) reject(new Error(`Decompression failed: ${err.message}`));
        else resolve(result);
      });
    });
  }

  return decrypted;
}

async function encryptFile(inputPath, outputPath, options = {}) {
  const key = options.key || getEncryptionKey();
  const compress = options.compress !== false;

  const inputBuffer = fs.readFileSync(inputPath);
  let data = inputBuffer;

  if (compress) {
    data = zlib.gzipSync(data);
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const metadata = buildHeader(key, iv, authTag, compress);
  const header = Buffer.from(JSON.stringify(metadata) + "\n");
  fs.writeFileSync(outputPath, Buffer.concat([header, encrypted]));

  return metadata;
}

async function decryptFile(inputPath, outputPath) {
  const key = getEncryptionKey();
  const fileBuffer = fs.readFileSync(inputPath);
  const parsed = parseHeader(fileBuffer);
  const data = fileBuffer.slice(parsed.headerSize);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, parsed.iv);
  decipher.setAuthTag(parsed.authTag);

  let decrypted;
  try {
    decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  } catch (err) {
    throw new Error(`Decryption failed - data may be tampered: ${err.message}`);
  }

  let output = decrypted;
  if (parsed.compressed) {
    output = zlib.gunzipSync(decrypted);
  }

  fs.writeFileSync(outputPath, output);
}

function validateEncryptionKey() {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ALGORITHM,
  KEY_LENGTH,
  IV_LENGTH,
  AUTH_TAG_LENGTH: 16,
  getEncryptionKey,
  generateEncryptionKey,
  createKeyId,
  EncryptStream,
  DecryptStream,
  encryptStream,
  decryptBuffer,
  encryptFile,
  decryptFile,
  validateEncryptionKey,
};
