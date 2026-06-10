beforeEach(() => {
  jest.resetModules();
});

test('listProducts and create/update/delete lifecycle', async () => {
  const productService = require('../src/services/productService');
  const productRepo = require('../src/repositories/productRepository');

  // List existing
  const allBefore = await productService.listProducts();
  expect(Array.isArray(allBefore)).toBe(true);

  // Create new product without id
  const payload = {
    name: 'Test Oyster Spawn',
    description: 'Test desc',
    price: 123.45,
    category: 'spawn',
  };

  const created = await productService.createProduct(payload);
  expect(created).toBeDefined();
  expect(created.name).toBe(payload.name);

  // Update the product
  const updated = await productService.updateProduct(created.id, {
    name: 'Updated Name',
    stock: 50,
  });
  expect(updated).toBeDefined();
  expect(updated.name).toBe('Updated Name');
  expect(updated.stock).toBe(50);

  // Delete the product
  const deleted = await productService.deleteProduct(created.id);
  expect(deleted).toBeDefined();

  // verify it's removed
  const { data: after, error: afterErr } = await productRepo.findById(
    created.id,
  );
  expect(after).toBeNull();
  expect(afterErr).toBeDefined();
});
