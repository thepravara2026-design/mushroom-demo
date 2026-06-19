const express = require("express");

const router = express.Router();
const authMiddleware = require("../middleware/auth");
const { requireRole } = require("../middleware/roles");
const blogService = require("../services/blogService");
const { success, error: respondError } = require("../lib/response");
const { validateBody, Joi } = require("../middleware/validate");

const adminOnly = requireRole("admin");

const createBlogSchema = Joi.object({
  blog_id: Joi.string().optional(),
  title: Joi.string().required(),
  content: Joi.string().required(),
  featured_image: Joi.string().uri().allow("").optional(),
  image_source: Joi.string().valid("upload", "url").optional(),
  author: Joi.string().optional(),
});

const updateBlogSchema = Joi.object({
  title: Joi.string().optional(),
  content: Joi.string().optional(),
  featured_image: Joi.string().uri().allow("").optional(),
  image_source: Joi.string().valid("upload", "url").optional(),
  author: Joi.string().optional(),
  status: Joi.string().valid("published", "draft", "locked").optional(),
  locked: Joi.boolean().optional(),
});

router.get("/", async (req, res) => {
  try {
    const { status = "published", limit = 10, page = 1 } = req.query;
    const result = await blogService.listBlogs({
      status,
      limit: parseInt(limit, 10),
      page: parseInt(page, 10),
    });
    return success(res, result);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to fetch blogs",
      error.status || 500,
    );
  }
});

router.get("/:slug", async (req, res) => {
  try {
    const blog = await blogService.getBlogBySlug(req.params.slug);
    return success(res, blog);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to fetch blog",
      error.status || 500,
    );
  }
});

router.post("/", authMiddleware, adminOnly, validateBody(createBlogSchema), async (req, res) => {
  try {
    const blog = await blogService.createBlog(req.body);
    return success(res, blog, {}, 201);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to create blog",
      error.status || 500,
    );
  }
});

router.put("/:id", authMiddleware, adminOnly, validateBody(updateBlogSchema), async (req, res) => {
  try {
    const blog = await blogService.updateBlog(req.params.id, req.body);
    return success(res, blog);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to update blog",
      error.status || 500,
    );
  }
});

router.post("/:id/publish", authMiddleware, adminOnly, async (req, res) => {
  try {
    const blog = await blogService.publishBlog(req.params.id);
    return success(res, blog);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to publish blog",
      error.status || 500,
    );
  }
});

router.delete("/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await blogService.deleteBlog(req.params.id);
    return success(res, result);
  } catch (error) {
    return respondError(
      res,
      error.message || "Failed to delete blog",
      error.status || 500,
    );
  }
});

module.exports = router;
