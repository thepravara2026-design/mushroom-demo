const XLSX = require("xlsx");
const productRepo = require("../repositories/productRepository");
const categoryRepo = require("../repositories/categoryRepository");
const db = require("../config/db");

const ENTITY_CONFIG = {
  products: {
    requiredFields: ["name", "category"],
    fieldMap: {
      name: "name", description: "description", price: "price", mrp_price: "mrp_price",
      image_url: "image_url", image_urls: "image_urls", category: "category",
      difficulty: "difficulty", gst_rate: "gst_rate", stock: "stock",
      storage_handling: "storage_handling", warranty_policy: "warranty_policy",
      return_policy: "return_policy", shipping_info: "shipping_info",
      compliance_info: "compliance_info", highlights: "highlights",
      certificates: "certificates", manufacturer_supplier: "manufacturer_supplier",
      scientific_name: "scientific_name", shelf_life: "shelf_life",
      seo_title: "seo_title", seo_slug: "seo_slug",
    },
    upsert: async (rows) => {
      const results = [];
      for (const row of rows) {
        try {
          const payload = { ...row };
          if (payload.highlights && typeof payload.highlights === "string") {
            payload.highlights = payload.highlights.split(";").map(s => s.trim()).filter(Boolean);
          }
          if (payload.certificates && typeof payload.certificates === "string") {
            payload.certificates = payload.certificates.split(";").map(s => {
              const parts = s.split(":");
              return parts.length > 1 ? { icon: `fa-solid fa-${parts[0].trim()}`, label: parts.slice(1).join(":").trim() } : { icon: "fa-solid fa-certificate", label: s.trim() };
            });
          }
          if (payload.weight_pricing && typeof payload.weight_pricing === "string") {
            try { payload.weight_pricing = JSON.parse(payload.weight_pricing); } catch { payload.weight_pricing = []; }
          }
          if (payload.image_urls && typeof payload.image_urls === "string") {
            payload.image_urls = payload.image_urls.split(";").map(s => s.trim()).filter(Boolean);
          }
          const { data: existing } = payload.id ? await productRepo.findById(payload.id) : { data: null };
          if (existing) {
            await productRepo.update(payload.id, payload);
          } else {
            if (!payload.id) {
              const { data: all } = await productRepo.findAll();
              const nums = (all || []).map(p => { const m = String(p.id).match(/prod-(\d+)$/); return m ? parseInt(m[1], 10) : 0; });
              payload.id = `prod-${(nums.length ? Math.max(...nums) + 1 : 1)}`;
            }
            await productRepo.create(payload);
          }
          results.push({ row: payload.id || payload.name, status: "success" });
        } catch (e) {
          results.push({ row: row.name || row.id || "unknown", status: "error", message: e.message });
        }
      }
      return results;
    },
  },
  categories: {
    requiredFields: ["id", "name"],
    fieldMap: {
      id: "id", name: "name", description: "description",
      category_id: "category_id", image_url: "image_url",
    },
    upsert: async (rows) => {
      const results = [];
      for (const row of rows) {
        try {
          const { data: existing } = await categoryRepo.findById(row.id);
          if (existing) {
            await categoryRepo.update(row.id, row);
          } else {
            const catId = row.category_id || `spore-${String(Math.floor(Math.random() * 900000) + 100000)}`;
            await categoryRepo.create({ ...row, category_id: catId });
          }
          results.push({ row: row.id, status: "success" });
        } catch (e) {
          results.push({ row: row.id || "unknown", status: "error", message: e.message });
        }
      }
      return results;
    },
  },
  blogs: {
    requiredFields: ["title"],
    fieldMap: {
      title: "title", content: "content", excerpt: "excerpt",
      image_url: "image_url", author: "author", tags: "tags",
      status: "status", published_at: "published_at",
    },
    upsert: async (rows) => {
      const results = [];
      for (const row of rows) {
        try {
          if (row.tags && typeof row.tags === "string") {
            row.tags = row.tags.split(";").map(s => s.trim()).filter(Boolean);
          }
          const { data: existing } = row.id ? await db.from("blogs").select("*").eq("id", row.id).single().catch(() => ({ data: null })) : { data: null };
          if (existing) {
            await db.from("blogs").update(row).eq("id", row.id);
          } else {
            await db.from("blogs").insert(row);
          }
          results.push({ row: row.title || row.id, status: "success" });
        } catch (e) {
          results.push({ row: row.title || row.id || "unknown", status: "error", message: e.message });
        }
      }
      return results;
    },
  },
  "training-batches": {
    requiredFields: ["training_id", "title"],
    fieldMap: {
      training_id: "training_id", title: "title", start_date: "start_date",
      end_date: "end_date", capacity: "capacity", price_actual: "price_actual",
      price_strikeout: "price_strikeout", instructor: "instructor",
      location: "location", meeting_link: "meeting_link", status: "status",
    },
    upsert: async (rows) => {
      const results = [];
      for (const row of rows) {
        try {
          const { data: existing } = row.id ? await db.from("training_batches").select("*").eq("id", row.id).single().catch(() => ({ data: null })) : { data: null };
          if (existing) {
            await db.from("training_batches").update(row).eq("id", row.id);
          } else {
            await db.from("training_batches").insert(row);
          }
          results.push({ row: row.title || row.id, status: "success" });
        } catch (e) {
          results.push({ row: row.title || row.id || "unknown", status: "error", message: e.message });
        }
      }
      return results;
    },
  },
  trainings: {
    requiredFields: ["title"],
    fieldMap: {
      title: "title", description: "description", category: "category",
      image_url: "image_url", content_url: "content_url",
      allowed_roles: "allowed_roles",
    },
    upsert: async (rows) => {
      const results = [];
      for (const row of rows) {
        try {
          if (row.allowed_roles && typeof row.allowed_roles === "string") {
            row.allowed_roles = row.allowed_roles.split(";").map(s => s.trim()).filter(Boolean);
          }
          const { data: existing } = row.id ? await db.from("trainings").select("*").eq("id", row.id).single().catch(() => ({ data: null })) : { data: null };
          if (existing) {
            await db.from("trainings").update(row).eq("id", row.id);
          } else {
            await db.from("trainings").insert(row);
          }
          results.push({ row: row.title || row.id, status: "success" });
        } catch (e) {
          results.push({ row: row.title || row.id || "unknown", status: "error", message: e.message });
        }
      }
      return results;
    },
  },
};

function parseFile(buffer, mimeType) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("No sheets found in file");
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return raw.map(row => {
      const cleaned = {};
      for (const [key, val] of Object.entries(row)) {
        const trimmed = key.trim();
        if (val instanceof Date) {
          cleaned[trimmed] = val.toISOString().split("T")[0];
        } else if (typeof val === "string") {
          cleaned[trimmed] = val.trim();
        } else {
          cleaned[trimmed] = val;
        }
      }
      return cleaned;
    });
  } catch (e) {
    throw new Error(`Failed to parse file: ${e.message}`);
  }
}

function validateRows(rows, config) {
  const results = { valid: [], errors: [] };
  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const missing = config.requiredFields.filter(f => {
      const v = row[f];
      return v === undefined || v === null || String(v).trim() === "";
    });
    if (missing.length) {
      results.errors.push({ row: rowNum, data: row, message: `Missing required field(s): ${missing.join(", ")}` });
    } else {
      results.valid.push(row);
    }
  });
  return results;
}

async function importEntities(entityType, buffer, mimeType) {
  const config = ENTITY_CONFIG[entityType];
  if (!config) throw new Error(`Unknown entity type: "${entityType}". Valid: ${Object.keys(ENTITY_CONFIG).join(", ")}`);

  const rows = parseFile(buffer, mimeType);
  if (!rows.length) throw new Error("File is empty — no data rows found");

  const { valid, errors } = validateRows(rows, config);
  if (!valid.length) {
    return { entity: entityType, total: rows.length, success: 0, failed: errors.length, errors, results: [] };
  }

  const upsertResults = await config.upsert(valid);
  const successCount = upsertResults.filter(r => r.status === "success").length;
  const failCount = upsertResults.filter(r => r.status === "error").length;

  const allErrors = [
    ...errors.map(e => ({ row: e.row, message: e.message })),
    ...upsertResults.filter(r => r.status === "error").map(r => ({ row: r.row, message: r.message })),
  ];

  return {
    entity: entityType,
    total: rows.length,
    success: successCount,
    failed: allErrors.length,
    errors: allErrors,
    results: upsertResults,
  };
}

function generateTemplate(entityType) {
  const config = ENTITY_CONFIG[entityType];
  if (!config) throw new Error(`Unknown entity type: "${entityType}"`);
  const headers = Object.keys(config.fieldMap);
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, entityType);
  return XLSX.write(wb, { type: "buffer", bookType: "csv" });
}

module.exports = { importEntities, generateTemplate, ENTITY_CONFIG };
