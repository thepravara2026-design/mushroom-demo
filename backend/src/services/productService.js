const productRepo = require("../repositories/productRepository");
const categoryRepo = require("../repositories/categoryRepository");
const escapeRegExp = require("../utils/escapeRegExp");

async function listProducts() {
  const { data, error } = await productRepo.findAll();
  if (error) throw new Error(error.message);
  return data;
}

async function getProduct(id) {
  const { data, error } = await productRepo.findById(id);
  if (error || !data) {
    const err = new Error("Product not found.");
    err.status = 404;
    throw err;
  }
  // Optionally compute growthMetadata as before
  return data;
}

function derivePriceFromWeightPricing(weightPricing) {
  if (Array.isArray(weightPricing) && weightPricing.length > 0) {
    const sorted = [...weightPricing].sort((a, b) => a.weight - b.weight);
    return {
      price: sorted[0].price,
      mrp_price: sorted[0].mrp_price || null,
    };
  }
  return { price: undefined, mrp_price: undefined };
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
    weight_pricing,
  } = payload;
  if (!name || !description || !category) {
    const err = new Error(
      "Please provide name, description, and category.",
    );
    err.status = 400;
    throw err;
  }

  if (weight_pricing !== undefined && weight_pricing !== null) {
    if (!Array.isArray(weight_pricing) || weight_pricing.length === 0) {
      const err = new Error("At least one weight-based pricing variant is required.");
      err.status = 400;
      throw err;
    }

    // Check for duplicate weight variants
    const weightKeys = weight_pricing.map(w => `${w.weight}${w.unit}`);
    if (new Set(weightKeys).size !== weightKeys.length) {
      const err = new Error("Duplicate weight variants are not allowed. Each weight can only be added once per product.");
      err.status = 400;
      throw err;
    }

    // Ensure prices increase with weight
    const sorted = [...weight_pricing].sort((a, b) => {
      const aGrams = a.unit === 'kg' ? a.weight * 1000 : a.weight;
      const bGrams = b.unit === 'kg' ? b.weight * 1000 : b.weight;
      return aGrams - bGrams;
    });
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].price <= sorted[i - 1].price) {
        const err = new Error(
          `Price for ${sorted[i].weight}${sorted[i].unit} (₹${sorted[i].price}) must be higher than price for ${sorted[i - 1].weight}${sorted[i - 1].unit} (₹${sorted[i - 1].price}). Larger weights must cost more.`
        );
        err.status = 400;
        throw err;
      }
    }
  }

  // Check product name uniqueness across all categories
  const { data: allProducts } = await productRepo.findAll();
  if (Array.isArray(allProducts)) {
    const nameDup = allProducts.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (nameDup) {
      const err = new Error(`A product with the name "${name}" already exists. Product names must be unique.`);
      err.status = 400;
      throw err;
    }
  }

  // Derive display price/mrp from first weight variant, or use provided price/mrp
  let derived;
  if (Array.isArray(weight_pricing) && weight_pricing.length > 0) {
    derived = derivePriceFromWeightPricing(weight_pricing);
  } else {
    derived = { price, mrp_price };
  }
  const numericPrice = price !== undefined ? parseFloat(price) : derived.price;
  const numericMrp = mrp_price !== undefined ? parseFloat(mrp_price) : derived.mrp_price;

  const { data: categoriesList, error: categoryError } =
    await categoryRepo.findAll();
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

  // Generate a unique product ID if not provided
  let productId = id;
  if (!productId) {
    const prefix = categoryUid || "prod";
    const { data: allProds } = await productRepo.findAll();
    const numbers = (Array.isArray(allProds) ? allProds : [])
      .map(p => {
        const m = new RegExp(`^${escapeRegExp(prefix)}-pid-(\\d+)$`).exec(String(p.id));
        return m ? Number.parseInt(m[1], 10) : 0;
      });
    const nextNum = numbers.length ? Math.max(...numbers) + 1 : 1;
    productId = `${prefix}-pid-${String(nextNum).padStart(5, '0')}`;
  }

  // Validate ID format
  const expectedPrefix = categoryUid || category;
  const idPattern = new RegExp(
    `^${escapeRegExp(expectedPrefix)}-pid-\\d{5}$`,
  );
  if (!idPattern.test(productId)) {
    const err = new Error(
      `Product ID must be formatted as ${expectedPrefix}-pid-00001.`,
    );
    err.status = 400;
    throw err;
  }
  const { data: existingProduct, error: existingError } =
    await productRepo.findById(productId);
  if (existingError) {
    const err = new Error(existingError.message);
    err.status = 500;
    throw err;
  }
  if (existingProduct) {
    const err = new Error(`Product ID "${productId}" is already in use.`);
    err.status = 400;
    throw err;
  }

  const insertData = {
    id: productId,
    name,
    description,
    price: numericPrice,
    mrp_price: numericMrp || numericPrice,
    image_url:
      image_url ||
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=600",
    category,
    difficulty: difficulty || "beginner",
    gst_rate: parseInt(gst_rate, 10) || 5,
    stock: parseInt(stock, 10) || 100,
    weight_pricing,
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
    const err = new Error("Product ID cannot be modified once created.");
    err.status = 400;
    throw err;
  }

  const { data: existingProduct, error: fetchError } =
    await productRepo.findById(productId);
  if (fetchError || !existingProduct) {
    const err = new Error("Product not found.");
    err.status = 404;
    throw err;
  }

  const toUpdate = {};
  if (updates.name !== undefined) toUpdate.name = updates.name;
  if (updates.description !== undefined)
    toUpdate.description = updates.description;
  if (updates.price !== undefined) toUpdate.price = parseFloat(updates.price);
  if (updates.mrp_price !== undefined)
    toUpdate.mrp_price = parseFloat(updates.mrp_price);
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
        "Category change is not allowed because the existing product ID prefix must match the selected category UID.",
      );
      err.status = 400;
      throw err;
    }
    toUpdate.category = updates.category;
  }
  if (updates.difficulty !== undefined)
    toUpdate.difficulty = updates.difficulty;
  if (updates.gst_rate !== undefined)
    toUpdate.gst_rate = parseInt(updates.gst_rate, 10);
  if (updates.stock !== undefined) toUpdate.stock = parseInt(updates.stock, 10);
  if (updates.weight_pricing !== undefined) {
    // Check for duplicate weight variants within this product
    const weightKeys = updates.weight_pricing.map(w => `${w.weight}${w.unit}`);
    if (new Set(weightKeys).size !== weightKeys.length) {
      const err = new Error("Duplicate weight variants are not allowed. Each weight can only be added once per product.");
      err.status = 400;
      throw err;
    }

    // Ensure prices increase with weight
    const sorted = [...updates.weight_pricing].sort((a, b) => {
      const aGrams = a.unit === 'kg' ? a.weight * 1000 : a.weight;
      const bGrams = b.unit === 'kg' ? b.weight * 1000 : b.weight;
      return aGrams - bGrams;
    });
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].price <= sorted[i - 1].price) {
        const err = new Error(
          `Price for ${sorted[i].weight}${sorted[i].unit} (₹${sorted[i].price}) must be higher than price for ${sorted[i - 1].weight}${sorted[i - 1].unit} (₹${sorted[i - 1].price}). Larger weights must cost more.`
        );
        err.status = 400;
        throw err;
      }
    }

    toUpdate.weight_pricing = updates.weight_pricing;
    // Derive price/mrp from first weight variant if not explicitly provided
    const derived = derivePriceFromWeightPricing(updates.weight_pricing);
    if (updates.price === undefined) toUpdate.price = derived.price;
    if (updates.mrp_price === undefined) toUpdate.mrp_price = derived.mrp_price || derived.price;
  }

  // Check name uniqueness on update (exclude self)
  if (updates.name !== undefined && updates.name.toLowerCase() !== existingProduct.name.toLowerCase()) {
    const { data: allProducts } = await productRepo.findAll();
    if (Array.isArray(allProducts)) {
      const nameDup = allProducts.find(p =>
        p.name.toLowerCase() === updates.name.toLowerCase() &&
        p.id !== productId
      );
      if (nameDup) {
        const err = new Error(`A product with the name "${updates.name}" already exists. Product names must be unique.`);
        err.status = 400;
        throw err;
      }
    }
  }

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
