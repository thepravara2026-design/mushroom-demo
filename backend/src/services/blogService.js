const db = require("../config/db");
const { AppError } = require("../errors/AppError");
const logger = require("../utils/logger");

function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function listBlogs({ status = "published", limit = 10, page = 1 } = {}) {
  const offset = (page - 1) * limit;

  const ALLOWED_STATUSES = ["published", "draft", "locked", "all"];
  if (status && !ALLOWED_STATUSES.includes(status)) {
    throw AppError.badRequest(`Invalid status "${status}". Must be one of: ${ALLOWED_STATUSES.join(", ")}`);
  }

  let query = db.from("blogs").select("*", { count: "exact" });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  query = query
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw AppError.internal("Failed to fetch blogs");
  }

  return {
    blogs: data || [],
    total: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
  };
}

async function getBlogBySlug(slug) {
  const { data, error } = await db
    .from("blogs")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw AppError.notFound("Blog not found");
    }
    throw AppError.internal("Failed to fetch blog");
  }

  return data;
}

async function getBlogById(id) {
  const { data, error } = await db
    .from("blogs")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw AppError.notFound("Blog not found");
    }
    throw AppError.internal("Failed to fetch blog");
  }

  return data;
}

async function createBlog(blogData) {
  const {
    blog_id,
    title,
    content,
    featured_image,
    image_source = "upload",
    author = "Admin",
  } = blogData;

  const slug = generateSlug(title);
  const existing = await db
    .from("blogs")
    .select("id")
    .eq("slug", slug)
    .single();
  if (existing.data) {
    throw AppError.conflict("A blog with this title already exists");
  }

  const newBlog = {
    id:
      blog_id ||
      `blog-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title,
    slug,
    author,
    content,
    featured_image: featured_image || null,
    image_source,
    status: "draft",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    locked: false,
  };

  const { data, error } = await db
    .from("blogs")
    .insert(newBlog)
    .select()
    .single();

  if (error) {
    throw AppError.internal("Failed to create blog");
  }

  return data;
}

async function publishBlog(id) {
  const { data, error } = await db
    .from("blogs")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw AppError.internal("Failed to publish blog");
  }

  return data;
}

async function updateBlog(id, updates) {
  const blog = await getBlogById(id);

  if (blog.locked) {
    throw AppError.forbidden("This blog is locked and cannot be edited");
  }

  const updateData = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  if (updates.title && updates.title !== blog.title) {
    const newSlug = generateSlug(updates.title);
    const existing = await db
      .from("blogs")
      .select("id")
      .eq("slug", newSlug)
      .neq("id", id)
      .single();
    if (existing.data) {
      throw AppError.conflict("A blog with this title already exists");
    }
    updateData.slug = newSlug;
  }

  const { data, error } = await db
    .from("blogs")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw AppError.internal("Failed to update blog");
  }

  return data;
}

async function deleteBlog(id) {
  const { error } = await db.from("blogs").delete().eq("id", id);

  if (error) {
    throw AppError.internal("Failed to delete blog");
  }

  return { message: "Blog deleted successfully" };
}

const BLOG_AUTO_LOCK_MS = parseInt(process.env.BLOG_AUTO_LOCK_MS, 10) || 12 * 60 * 60 * 1000;

async function checkAndUpdateLockStatus() {
  const twelveHoursAgo = new Date(
    Date.now() - BLOG_AUTO_LOCK_MS,
  ).toISOString();

  const { data, error } = await db
    .from("blogs")
    .update({
      locked: true,
      status: "locked",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "published")
    .lt("published_at", twelveHoursAgo)
    .eq("locked", false)
    .select();

  if (error) {
    logger.error("Failed to update blog lock status:", error);
  }

  return data || [];
}

const LOCK_CHECK_INTERVAL_MS = 15 * 60 * 1000;

function startBlogLockScheduler() {
  if (db.isMock) return;
  logger.info(
    `🔒 Blog auto-lock scheduler started (every ${LOCK_CHECK_INTERVAL_MS / 60000} min)`,
  );
  checkAndUpdateLockStatus();
  return setInterval(checkAndUpdateLockStatus, LOCK_CHECK_INTERVAL_MS);
}

module.exports = {
  listBlogs,
  getBlogBySlug,
  getBlogById,
  createBlog,
  publishBlog,
  updateBlog,
  deleteBlog,
  checkAndUpdateLockStatus,
  generateSlug,
  startBlogLockScheduler,
};
