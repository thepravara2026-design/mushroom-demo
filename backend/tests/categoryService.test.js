beforeEach(() => {
  jest.resetModules();
});

test('category create/update/delete and product reassign on delete', async () => {
  const categoryService = require('../src/services/categoryService');
  const productService = require('../src/services/productService');
  const productRepo = require('../src/repositories/productRepository');

  // Create a category (provide slug `id` and optional category_id)
  const catPayload = {
    id: 'test-category',
    name: 'Test Category',
    category_id: 'spore-999999',
  };
  const created = await categoryService.createCategory(catPayload);
  expect(created).toBeDefined();
  expect(created.category_id).toBeDefined();

  // Create a product in that category
  const prod = await productService.createProduct({
    name: 'Product In Test Cat',
    description: 'A product for category test',
    price: 10,
    category: created.id,
  });
  expect(prod).toBeDefined();
  expect(prod.category).toBe(created.id);

  // Delete the category
  const deleted = await categoryService.deleteCategory(created.id);
  expect(deleted).toBeDefined();

  // Verify product moved to uncategorized
  const { data: pAfter } = await productRepo.findById(prod.id);
  expect(pAfter).toBeDefined();
  expect(pAfter.category).toBe('uncategorized');
});
