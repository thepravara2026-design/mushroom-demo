const db = require("../config/db");

async function findByEmail(email) {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("email", email)
    .single();
  if (error && error.message === "No rows found") {
    return { data: null, error: null };
  }
  return { data, error };
}

async function findByPhone(phone) {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("whatsapp_number", phone.replace(/^\+91/, "").replace(/\s/g, "").trim())
    .single();
  if (error && error.message === "No rows found") {
    return { data: null, error: null };
  }
  return { data, error };
}

async function findById(id) {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("id", id)
    .single();
  if (error && error.message === "No rows found") {
    return { data: null, error: null };
  }
  return { data, error };
}

async function create(payload) {
  const { data, error } = await db.from("users").insert(payload).single();
  return { data, error };
}

async function update(id, updates) {
  const { data, error } = await db
    .from("users")
    .update(updates)
    .eq("id", id)
    .single();
  return { data, error };
}

async function remove(id) {
  const { data: existing, error: getErr } = await findById(id);
  if (getErr || !existing) {
    return { data: null, error: { message: "No rows found" } };
  }

  await db.from("users").delete().eq("id", id);
  return { data: existing, error: null };
}

module.exports = {
  findByEmail,
  findByPhone,
  findById,
  create,
  update,
  remove,
};
