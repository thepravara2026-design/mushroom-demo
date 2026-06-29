const { getActiveProviders, getDefaultProvider } = require('./ProviderRegistry');
const logger = require('../../utils/logger');

async function selectBestProvider({ pickupPincode, deliveryPincode, weight, cod }) {
  const providers = await getActiveProviders();
  if (providers.length === 0) {
    return getDefaultProvider();
  }

  const results = [];
  for (const { provider, adapter } of providers) {
    try {
      const result = await adapter.checkServiceability({ pickupPincode, deliveryPincode, weight, cod });
      results.push({ provider, adapter, result });
    } catch (err) {
      logger.warn(`[selectBestProvider] ${provider.provider_key} serviceability check failed: ${err.message}`);
    }
  }

  if (results.length === 0) {
    return getDefaultProvider();
  }

  results.sort((a, b) => {
    const rateA = a.result?.data?.available_courier?.[0]?.rate ?? Infinity;
    const rateB = b.result?.data?.available_courier?.[0]?.rate ?? Infinity;
    return rateA - rateB;
  });

  return { provider: results[0].provider, adapter: results[0].adapter, serviceability: results[0].result };
}

module.exports = selectBestProvider;
