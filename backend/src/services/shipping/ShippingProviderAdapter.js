class ShippingProviderAdapter {
  async checkServiceability({ pickupPincode, deliveryPincode, weight, cod }) {
    throw new Error('checkServiceability() must be implemented by subclass');
  }

  async createShipment(orderPayload) {
    throw new Error('createShipment() must be implemented by subclass');
  }

  async assignCourier(shipmentId, courierId) {
    throw new Error('assignCourier() must be implemented by subclass');
  }

  async schedulePickup(shipmentId) {
    throw new Error('schedulePickup() must be implemented by subclass');
  }

  async cancelShipment(shipmentId) {
    throw new Error('cancelShipment() must be implemented by subclass');
  }

  async generateLabel(shipmentId) {
    throw new Error('generateLabel() must be implemented by subclass');
  }

  async trackShipment(awbCode) {
    throw new Error('trackShipment() must be implemented by subclass');
  }

  verifyWebhookSignature(req) {
    throw new Error('verifyWebhookSignature() must be implemented by subclass');
  }

  parseWebhookPayload(body) {
    throw new Error('parseWebhookPayload() must be implemented by subclass');
  }
}

module.exports = ShippingProviderAdapter;
