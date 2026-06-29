const db = require("../config/db");

async function findByEmail(email) {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("email", email)
    .single();
  if (error && (error.message === "No rows found" || error.code === "PGRST116")) {
    return { data: null, error: null };
  }
  return { data, error };
}

async function findByPhone(phone) {
  const cleaned = phone.replace(/^\+91/, "").replace(/\s/g, "").trim();
  // Try without +91 prefix (normalized storage)
  let { data, error } = await db
    .from("users")
    .select("*")
    .eq("whatsapp_number", cleaned)
    .single();
  if (data) return { data, error: null };
  if (error && error.message !== "No rows found" && error.code !== "PGRST116") {
    return { data: null, error };
  }
  // Fallback: try with +91 prefix (legacy storage from OTP-created users)
  return db
    .from("users")
    .select("*")
    .eq("whatsapp_number", `+91${cleaned}`)
    .single();
}

async function findById(id) {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("id", id)
    .single();
  if (error && (error.message === "No rows found" || error.code === "PGRST116")) {
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
