const ShippingProviderAdapter = require('../ShippingProviderAdapter');
const db = require('../../../config/db');
const logger = require('../../../utils/logger');

const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external';

class ShiprocketAdapter extends ShippingProviderAdapter {
  constructor(config = {}) {
    super();
    this.baseUrl = config.base_url || SHIPROCKET_BASE;
    this.email = process.env.SHIPROCKET_EMAIL || '';
    this.password = process.env.SHIPROCKET_PASSWORD || '';
    this.webhookSecret = process.env.SHIPROCKET_WEBHOOK_SECRET || '';
  }

  async _getToken() {
    if (db.isMock) return 'mock-token';

    const { data: setting } = await db
      .from('settings')
      .select('value')
      .eq('key', 'shiprocket_token')
      .single();

    if (setting && setting.value) {
      const { token, expires_at } = setting.value;
      if (token && expires_at && Date.now() < new Date(expires_at).getTime()) {
        return token;
      }
    }

    const token = await this._login();
    await db.from('settings').upsert({
      key: 'shiprocket_token',
      value: { token, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
    }, { onConflict: 'key' });
    return token;
  }

  async _login() {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Shiprocket login failed: ${err}`);
    }
    const data = await res.json();
    return data.token;
  }

  async _request(method, path, body) {
    if (db.isMock) return this._mockResponse(method, path, body);

    const token = await this._getToken();
    const url = `${this.baseUrl}${path}`;
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Shiprocket API error: ${data.message || res.statusText}`);
    }
    return data;
  }

  _mockResponse(method, path, body) {
    if (path.startsWith('/courier/serviceability/')) {
      return {
        data: {
          available_courier: [
            {
              courier_name: 'Mock Courier',
              rate: 50,
              estimated_delivery_days: '3-5',
              cod: body?.cod || false,
            },
          ],
        },
      };
    }
    if (path === '/orders/create/adhoc') {
      return {
        order_id: `mock-shipment-${Date.now()}`,
        shipment_id: `mock-shipment-${Date.now()}`,
        status: 'NEW',
      };
    }
    if (path.startsWith('/courier/assign/awb')) {
      return {
        awb_code: `mock-awb-${Date.now()}`,
        courier_name: 'Mock Courier',
      };
    }
    if (path.startsWith('/courier/generate/pickup')) {
      return {
        pickup_scheduled: true,
        pickup_token_number: `pick-${Date.now()}`,
      };
    }
    if (path.startsWith('/orders/cancel')) {
      return { status: 'CANCELLED' };
    }
    if (path.startsWith('/courier/generate/label')) {
      return {
        label_url: 'https://mock.shiprocket.in/label.pdf',
        manifest_url: 'https://mock.shiprocket.in/manifest.pdf',
      };
    }
    if (path.includes('/courier/track/awb/')) {
      return {
        tracking_data: {
          shipment_status: 'Delivered',
          track_status: 6,
          etd: '2026-07-01',
          timeline: [
            { status: 'Pickup Scheduled', location: 'Warehouse', activity: 'Pickup scheduled', date: new Date(Date.now() - 86400000).toISOString() },
            { status: 'Picked Up', location: 'Warehouse', activity: 'Item picked up', date: new Date(Date.now() - 43200000).toISOString() },
            { status: 'Delivered', location: 'Customer', activity: 'Package delivered', date: new Date().toISOString() },
          ],
        },
      };
    }
    return {};
  }

  async checkServiceability({ pickupPincode, deliveryPincode, weight, cod }) {
    return this._request('GET', `/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weight}&cod=${cod ? 1 : 0}`);
  }

  async createShipment(orderPayload) {
    return this._request('POST', '/orders/create/adhoc', orderPayload);
  }

  async assignCourier(shipmentId, courierId) {
    return this._request('POST', '/courier/assign/awb', {
      shipment_id: parseInt(shipmentId, 10),
      courier_id: courierId || undefined,
    });
  }

  async schedulePickup(shipmentId) {
    return this._request('POST', '/courier/generate/pickup', {
      shipment_id: [parseInt(shipmentId, 10)],
    });
  }

  async cancelShipment(shipmentId) {
    return this._request('POST', '/orders/cancel', {
      ids: [parseInt(shipmentId, 10)],
    });
  }

  async generateLabel(shipmentId) {
    return this._request('POST', '/courier/generate/label', {
      shipment_id: parseInt(shipmentId, 10),
    });
  }

  async trackShipment(awbCode) {
    return this._request('GET', `/courier/track/awb/${awbCode}`);
  }

  verifyWebhookSignature(req) {
    if (db.isMock) return true;
    const signature = req.headers['x-shiprocket-signature'];
    return signature === this.webhookSecret;
  }

  parseWebhookPayload(body) {
    const { current_status, awb_code, order_id, shipment_id, location, updated_at } = body || {};
    return {
      awbCode: awb_code,
      externalOrderId: order_id,
      externalShipmentId: shipment_id,
      status: current_status,
      location: location || '',
      description: current_status || '',
      occurredAt: updated_at || new Date().toISOString(),
    };
  }
}

module.exports = ShiprocketAdapter;
