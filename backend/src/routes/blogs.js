const express = require('express');

const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const blogService = require('../services/blogService');
const { success, error: respondError } = require('../lib/response');

const adminOnly = requireRole('admin');

router.get('/', async (req, res) => {
  try {
    const { status = 'published', limit = 10, page = 1 } = req.query;
    const result = await blogService.listBlogs({
      status,
      limit: parseInt(limit, 10),
      page: parseInt(page, 10),
    });
    return success(res, result);
  } catch (error) {
    return respondError(res, error.message || 'Failed to fetch blogs', error.status || 500);
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const blog = await blogService.getBlogBySlug(req.params.slug);
    return success(res, blog);
  } catch (error) {
    return respondError(res, error.message || 'Failed to fetch blog', error.status || 500);
  }
});

router.post(
  '/',
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const blog = await blogService.createBlog(req.body);
      return success(res, blog, {}, 201);
    } catch (error) {
      return respondError(res, error.message || 'Failed to create blog', error.status || 500);
    }
  },
);

router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const blog = await blogService.updateBlog(req.params.id, req.body);
    return success(res, blog);
  } catch (error) {
    return respondError(res, error.message || 'Failed to update blog', error.status || 500);
  }
});

router.post('/:id/publish', authMiddleware, adminOnly, async (req, res) => {
  try {
    const blog = await blogService.publishBlog(req.params.id);
    return success(res, blog);
  } catch (error) {
    return respondError(res, error.message || 'Failed to publish blog', error.status || 500);
  }
});

router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const result = await blogService.deleteBlog(req.params.id);
    return success(res, result);
  } catch (error) {
    return respondError(res, error.message || 'Failed to delete blog', error.status || 500);
  }
});

module.exports = router;