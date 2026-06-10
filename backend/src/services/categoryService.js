const categoryRepo = require('../repositories/categoryRepository');
const productRepo = require('../repositories/productRepository');

async function listCategories() {
  const { data, error } = await categoryRepo.findAll();
  if (error) {
    const err = new Error(error.message);
    err.status = 500;
    throw err;
  }
  return data;
}

function escapeSlug(slug) {
  return String(slug).toLowerCase().replace(/\s+/g, '-');
}

async function generateNextCategoryUid() {
  const { data: categories, error } = await categoryRepo.findAll();
  if (error) {
    const err = new Error(error.message);
    err.status = 500;
    throw err;
  }
  const next = (categories || [])
    .map((c) => c.category_id)
    .filter(Boolean)
    .map((uid) => {
      const match = String(uid).match(/^spore-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .reduce((max, n) => Math.max(max, n), 0) + 1;
  return `spore-${String(next).padStart(6, '0')}`;
}

async function createCategory(payload) {
  const {
    category_id, id, name, description, image_url,
  } = payload;
  if (!id || !name) {
    const err = new Error('Please provide category slug and name.');
    err.status = 400;
    throw err;
  }
  const normalizedSlug = escapeSlug(id);
  const normalizedCid = category_id ? String(category_id).toLowerCase() : null;

  // Check slug uniqueness
  const { data: existingSlug } = await categoryRepo.findById(normalizedSlug);
  if (existingSlug) {
    const err = new Error(
      `Category with slug "${normalizedSlug}" already exists.`,
    );
    err.status = 400;
    throw err;
  }

  // Check category_id uniqueness
  if (normalizedCid) {
    const { data: all } = await categoryRepo.findAll();
    const found = (all || []).find((c) => c.category_id === normalizedCid);
    if (found) {
      const err = new Error(
        `Category with UID "${normalizedCid}" already exists.`,
      );
      err.status = 400;
      throw err;
    }
  }

  const cid = normalizedCid || (await generateNextCategoryUid());

  const insert = {
    category_id: cid,
    id: normalizedSlug,
    name,
    description: description || '',
    image_url: image_url || '',
  };

  const { data: newCategory, error } = await categoryRepo.create(insert);
  if (error) {
    const err = new Error(error.message);
    err.status = 500;
    throw err;
  }
  return newCategory;
}

async function updateCategory(slug, updates) {
  const allowed = {};
  if (updates.name !== undefined) allowed.name = updates.name;
  if (updates.description !== undefined) allowed.description = updates.description;
  if (updates.image_url !== undefined) allowed.image_url = updates.image_url;

  const { data: updated, error } = await categoryRepo.update(slug, allowed);
  if (error) {
    const err = new Error(error.message);
    err.status = 500;
    throw err;
  }
  return updated;
}

async function deleteCategory(slug) {
  // Delete category
  const { data, error } = await categoryRepo.remove(slug);
  if (error) {
    const err = new Error(error.message);
    err.status = 500;
    throw err;
  }

  // Update products belonging to this category
  const { data: products } = await productRepo.findAll();
  if (products && products.length > 0) {
    for (const p of products.filter((p) => p.category === slug)) {
      await productRepo.update(p.id, { category: 'uncategorized' });
    }
  }

  return data;
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  generateNextCategoryUid,
};
