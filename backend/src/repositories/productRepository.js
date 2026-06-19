const db = require("../config/db");

async function findAll() {
  const { data, error } = await db.from("products").select("*");
  return { data, error };
}

async function findById(id) {
  const { data, error } = await db
    .from("products")
    .select("*")
    .eq("id", id)
    .single();
  if (error && error.message === "No rows found") {
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
  findById,
  create,
  update,
  remove,
};
