const PROMO_CODES = {
  SPORE10: { discountPercent: 0.1, description: "10% Off" },
  SHROOM20: { discountPercent: 0.2, description: "20% Off" },
};

function validatePromoCode(code) {
  if (!code || typeof code !== "string") {
    return { valid: false, error: "Promo code is required." };
  }

  const normalized = code.toUpperCase().trim();
  const promo = PROMO_CODES[normalized];

  if (!promo) {
    return { valid: false, error: "Invalid promo code." };
  }

  return {
    valid: true,
    code: normalized,
    discountPercent: promo.discountPercent,
    description: promo.description,
  };
}

module.exports = { validatePromoCode };
