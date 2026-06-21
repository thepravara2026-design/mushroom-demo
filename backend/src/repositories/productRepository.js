const db = require("../config/db");

async function findAll(filters = {}) {
  const { sort, category, search, page, limit } = filters;

  let query = db.from("products").select("*");

  if (category && category !== "all") {
    query = query.eq("category", category);
  }

  if (search) {
    const pattern = `%${search}%`;
    query = query.or(`name.ilike.${pattern},description.ilike.${pattern}`);
  }

  if (sort) {
    const validSorts = ["name", "price", "stock", "category"];
    const parts = sort.split("_");
    const field = parts[0];
    const dir = parts[1];
    if (validSorts.includes(field)) {
      query = query.order(field, { ascending: dir !== "desc" });
    }
  }

  if (page && limit) {
    const p = parseInt(page, 10) || 1;
    const l = parseInt(limit, 10) || 10;
    const start = (p - 1) * l;
    query = query.range(start, start + l - 1);
  }

  const { data, error } = await query;
  return { data, error };
}

async function countAll(filters = {}) {
  const { category, search } = filters;
  let query = db.from("products").select("*", { count: "exact", head: true });

  if (category && category !== "all") {
    query = query.eq("category", category);
  }

  if (search) {
    const pattern = `%${search}%`;
    query = query.or(`name.ilike.${pattern},description.ilike.${pattern}`);
  }

  const { count, error } = await query;
  return { count, error };
}

async function findById(id) {
  const { data, error } = await db
    .from("products")
    .select("*")
    .eq("id", id)
    .single();
  if (error && (error.message === "No rows found" || error.code === "PGRST116")) {
    return { data: null, error: null };
  }
  return { data, error };
}

async function create(payload) {
  const { data, error } = await db.from("products").insert(payload).single();
  return { data, error };
}

async function update(id, updates) {
  const { data, error } = await db
    .from("products")
    .update(updates)
    .eq("id", id)
    .single();
  return { data, error };
}

async function remove(id) {
  const { data, error } = await db
    .from("products")
    .delete()
    .eq("id", id)
    .single();
  return { data, error };
}

module.exports = {
  findAll,
  countAll,
  findById,
  create,
  update,
  remove,
};
