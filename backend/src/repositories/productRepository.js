const db = require('../config/db')

async function findById(id) {
  const { data, error } = await db.from('products').select('*').eq('id', id).single()
  if (error && (error.message === 'No rows found' || error.code === 'PGRST116')) {
    return { data: null, error: null }
  }
  return { data, error }
}

async function findAll({ sort, category, search, page, limit } = {}) {
  let builder = db.from('products').select('*')
  if (category) builder = builder.eq('category', category)
  if (search) builder = builder.ilike('name', `%${search}%`)
  if (sort === 'price_asc') builder = builder.order('price', { ascending: true })
  else if (sort === 'price_desc') builder = builder.order('price', { ascending: false })
  else if (sort === 'name') builder = builder.order('name', { ascending: true })
  else builder = builder.order('created_at', { ascending: false })
  if (page !== undefined && limit !== undefined) {
    const safePage = Math.max(1, parseInt(page, 10) || 1)
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10))
    const from = (safePage - 1) * safeLimit
    const to = from + safeLimit - 1
    builder = builder.range(from, to)
  }
  const { data, error } = await builder
  return { data, error }
}

async function countAll({ category, search } = {}) {
  let builder = db.from('products').select('*', { count: 'exact', head: true })
  if (category) builder = builder.eq('category', category)
  if (search) builder = builder.ilike('name', `%${search}%`)
  const { count, error } = await builder
  return { count: count || 0, error }
}

async function create(payload) {
  const { data, error } = await db.from('products').insert(payload).single()
  return { data, error }
}

async function update(id, updates) {
  const { data, error } = await db.from('products').update(updates).eq('id', id).single()
  return { data, error }
}

async function remove(id) {
  const { data: existing } = await findById(id)
  if (!existing) return { data: null, error: { message: 'No rows found' } }
  await db.from('products').delete().eq('id', id)
  return { data: existing, error: null }
}

async function findByCategory(category) {
  return findAll({ category })
}

async function search(query) {
  return findAll({ search: query })
}

async function getLowStock(threshold = 5) {
  const { data, error } = await db.from('products').select('*').lte('stock', threshold)
  return { data, error }
}

module.exports = {
  findById,
  findAll,
  countAll,
  create,
  update,
  remove,
  findByCategory,
  search,
  getLowStock,
}
