const db = require('../../config/db');
const logger = require('../../utils/logger');

const adapterCache = new Map();

async function getProvider(providerKey) {
  if (adapterCache.has(providerKey)) {
    return adapterCache.get(providerKey);
  }

  const { data: provider } = await db
    .from('shipping_providers')
    .select('*')
    .eq('provider_key', providerKey)
    .single();

  if (!provider || !provider.is_active) {
    return null;
  }

  let AdapterClass;
  try {
    AdapterClass = require(`./adapters/${providerKey.charAt(0).toUpperCase() + providerKey.slice(1)}Adapter`);
  } catch {
    logger.warn(`[ProviderRegistry] No adapter found for provider: ${providerKey}`);
    return null;
  }

  const instance = new AdapterClass(provider.config || {});
  adapterCache.set(providerKey, instance);
  return instance;
}

async function getActiveProviders() {
  const { data: providers } = await db
    .from('shipping_providers')
    .select('*')
    .eq('is_active', true);

  if (!providers) return [];

  const instances = [];
  for (const p of providers) {
    const instance = await getProvider(p.provider_key);
    if (instance) instances.push({ provider: p, adapter: instance });
  }
  return instances;
}

async function getDefaultProvider() {
  const { data: provider } = await db
    .from('shipping_providers')
    .select('*')
    .eq('is_default', true)
    .single();

  if (!provider) return null;
  const adapter = await getProvider(provider.provider_key);
  if (!adapter) return null;
  return { provider, adapter };
}

function clearCache() {
  adapterCache.clear();
}

module.exports = { getProvider, getActiveProviders, getDefaultProvider, clearCache };
