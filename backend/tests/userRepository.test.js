const path = require('path');

beforeEach(() => {
  // Reset modules so `db` re-initializes the mock store before each test
  jest.resetModules();
});

test('findByEmail returns seeded admin user', async () => {
  const userRepo = require('../src/repositories/userRepository');
  const { data, error } = await userRepo.findByEmail('admin@sporekart.com');
  expect(error).toBeNull();
  expect(data).toBeDefined();
  expect(data.email).toBe('admin@sporekart.com');
  expect(data.role).toBe('admin');
});

test('findById returns seeded buyer user', async () => {
  const userRepo = require('../src/repositories/userRepository');
  const { data, error } = await userRepo.findById('user-buyer');
  expect(error).toBeNull();
  expect(data).toBeDefined();
  expect(data.id).toBe('user-buyer');
  expect(data.full_name).toBe('John Buyer');
});

test('create, update, remove lifecycle', async () => {
  const userRepo = require('../src/repositories/userRepository');
  const payload = { id: 'test-user-1', email: 'test1@example.com', full_name: 'Test One' };

  const { data: created, error: createErr } = await userRepo.create(payload);
  expect(createErr).toBeNull();
  expect(created).toBeDefined();
  expect(created.email).toBe(payload.email);

  const { data: updated, error: upErr } = await userRepo.update('test-user-1', { full_name: 'Test One Updated' });
  expect(upErr).toBeNull();
  expect(updated.full_name).toBe('Test One Updated');

  const { data: removed, error: remErr } = await userRepo.remove('test-user-1');
  expect(remErr).toBeNull();
  // After removal, trying to find should yield error in mock implementation
  const { data: after, error: afterErr } = await userRepo.findById('test-user-1');
  expect(after).toBeNull();
  expect(afterErr).toBeDefined();
});
