const productRepo = require('../repositories/productRepository');
const categoryRepo = require('../repositories/categoryRepository');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listProducts() {
  const { data, error } = await productRepo.findAll();
  if (error) throw new Error(error.message);
  return data;
}

async function getProduct(id) {
  const { data, error } = await productRepo.findById(id);
  if (error || !data) {
    const err = new Error('Product not found.');
    err.status = 404;
    throw err;
  }
  // Optionally compute growthMetadata as before
  return data;
}

async function createProduct(payload) {
  const {
    name,
    description,
    price,
    mrp_price,
    image_url,
    category,
    difficulty,
    gst_rate,
    stock,
    id,
  } = payload;
  if (!name || !description || price === undefined || !category) {
    const err = new Error(
      'Please provide name, description, price, and category.',
    );
    err.status = 400;
    throw err;
  }

  const numericPrice = parseFloat(price);
  const numericMrp = mrp_price !== undefined ? parseFloat(mrp_price) : undefined;
  if (numericMrp !== undefined && numericMrp < numericPrice) {
    const err = new Error('MRP must be greater than or equal to actual price.');
    err.status = 400;
    throw err;
  }

  const { data: categoriesList, error: categoryError } = await categoryRepo.findAll();
  if (categoryError) {
    const err = new Error(categoryError.message);
    err.status = 500;
    throw err;
  }

  const validCategoryIds = categoriesList
    ? categoriesList.map((c) => c.id)
    : [];
  if (!validCategoryIds.includes(category)) {
    const err = new Error(`Invalid category "${category}".`);
    err.status = 400;
    throw err;
  }

  let categoryUid = null;
  if (Array.isArray(categoriesList)) {
    const categoryRow = categoriesList.find((c) => c.id === category);
    categoryUid = categoryRow
      ? categoryRow.category_id || categoryRow.categoryId
      : null;
  }

  if (id) {
    const expectedPrefix = categoryUid || category;
    const idPattern = new RegExp(
      `^${escapeRegExp(expectedPrefix)}-pid-\\d{5}$`,
    );
    if (!idPattern.test(id)) {
      const err = new Error(
        `Product ID must be formatted as ${expectedPrefix}-pid-00001.`,
      );
      err.status = 400;
      throw err;
    }
    const { data: existingProduct, error: existingError } = await productRepo.findById(id);
    if (existingError) {
      const err = new Error(existingError.message);
      err.status = 500;
      throw err;
    }
    if (existingProduct) {
      const err = new Error(`Product ID "${id}" is already in use.`);
      err.status = 400;
      throw err;
    }
  }

  const insertData = {
    ...(id ? { id } : {}),
    name,
    description,
    price: parseFloat(price),
    mrp_price: mrp_price ? parseFloat(mrp_price) : parseFloat(price) * 1.4,
    image_url:
      image_url
      || 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600',
    category,
    difficulty: difficulty || 'beginner',
    gst_rate: parseInt(gst_rate, 10) || 5,
    stock: parseInt(stock, 10) || 100,
  };

  const { data: newProduct, error } = await productRepo.create(insertData);
  if (error) {
    const err = new Error(error.message);
    err.status = 500;
    throw err;
  }
  return newProduct;
}

async function updateProduct(productId, updates) {
  // Prevent id modification
  if (updates.id !== undefined) {
    const err = new Error('Product ID cannot be modified once created.');
    err.status = 400;
    throw err;
  }

  const { data: existingProduct, error: fetchError } = await productRepo.findById(productId);
  if (fetchError || !existingProduct) {
    const err = new Error('Product not found.');
    err.status = 404;
    throw err;
  }

  const toUpdate = {};
  if (updates.name !== undefined) toUpdate.name = updates.name;
  if (updates.description !== undefined) toUpdate.description = updates.description;
  if (updates.price !== undefined) toUpdate.price = parseFloat(updates.price);
  if (updates.mrp_price !== undefined) toUpdate.mrp_price = parseFloat(updates.mrp_price);
  if (updates.image_url !== undefined) toUpdate.image_url = updates.image_url;
  if (updates.category !== undefined) {
    const { data: categoriesList } = await categoryRepo.findAll();
    const validCategoryIds = categoriesList
      ? categoriesList.map((c) => c.id)
      : [];
    if (!validCategoryIds.includes(updates.category)) {
      const err = new Error(`Invalid category "${updates.category}".`);
      err.status = 400;
      throw err;
    }
    const categoryRow = categoriesList.find((c) => c.id === updates.category);
    const expectedPrefix = categoryRow
      ? categoryRow.category_id || categoryRow.categoryId
      : updates.category;
    const newPattern = new RegExp(
      `^${escapeRegExp(expectedPrefix)}-pid-\\d{5}$`,
    );
    if (!newPattern.test(existingProduct.id)) {
      const err = new Error(
        'Category change is not allowed because the existing product ID prefix must match the selected category UID.',
      );
      err.status = 400;
      throw err;
    }
    toUpdate.category = updates.category;
  }
  if (updates.difficulty !== undefined) toUpdate.difficulty = updates.difficulty;
  if (updates.gst_rate !== undefined) toUpdate.gst_rate = parseInt(updates.gst_rate, 10);
  if (updates.stock !== undefined) toUpdate.stock = parseInt(updates.stock, 10);

  const { data: updatedProduct, error } = await productRepo.update(
    productId,
    toUpdate,
  );
  if (error) {
    const err = new Error(error.message);
    err.status = 500;
    throw err;
  }
  return updatedProduct;
}

async function deleteProduct(productId) {
  const { data, error } = await productRepo.remove(productId);
  if (error) {
    const err = new Error(error.message);
    err.status = 500;
    throw err;
  }
  return data;
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
};
