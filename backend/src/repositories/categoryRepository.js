const db = require('../config/db');

async function findAll() {
  const { data, error } = await db.from('categories').select('*');
  return { data, error };
}

async function findById(id) {
  const { data, error } = await db
    .from('categories')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.message === 'No rows found') {
    return { data: null, error: null };
  }
  return { data, error };
}

async function create(payload) {
  const { data, error } = await db.from('categories').insert(payload).single();
  return { data, error };
}

async function update(id, updates) {
  const { data, error } = await db
    .from('categories')
    .update(updates)
    .eq('id', id)
    .single();
  return { data, error };
}

async function remove(id) {
  const result = await db
    .from('categories')
    .delete()
    .eq('id', id)
    .then((res) => res);
  const { data, error } = result;
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { data: null, error: { message: 'No rows found' } };
    }
    return { data: data[0], error: null };
  }
  return { data, error };
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  remove,
};
