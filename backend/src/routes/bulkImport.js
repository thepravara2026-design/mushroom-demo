const express = require("express");
const router = express.Router();
const multer = require("multer");
const authMiddleware = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");
const { success, error } = require("../lib/response");
const { importEntities, generateTemplate } = require("../services/bulkImportService");

const adminOnly = requireRole("admin");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/csv",
    ];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith(".csv") || file.originalname.endsWith(".xlsx")) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx and .csv files are supported"));
    }
  },
});

router.post("/:entity", authMiddleware, adminOnly, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return error(res, "No file uploaded. Attach a .xlsx or .csv file.", 400);
    const result = await importEntities(req.params.entity, req.file.buffer, req.file.mimetype);
    return success(res, result);
  } catch (e) {
    return error(res, e.message || "Import failed", 400);
  }
});

router.get("/template/:entity", authMiddleware, adminOnly, async (req, res) => {
  try {
    const buffer = generateTemplate(req.params.entity);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.entity}-template.csv"`);
    return res.send(buffer);
  } catch (e) {
    return error(res, e.message || "Template generation failed", 400);
  }
});

module.exports = router;
