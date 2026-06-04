const Razorpay = require('razorpay');
const crypto = require('crypto');

const keyId = process.env.RAZORPAY_KEY_ID || '';
const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

const isMock = !keyId || keyId.includes('your-') || !keySecret;

let razorpayInstance = null;
if (!isMock) {
  razorpayInstance = new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
}

const razorpayMock = {
  isMock: true,
  orders: {
    create: async (options) => {
      console.warn("⚠️ Razorpay Mock Order Creation: ", options);
      // Simulate order creation
      return {
        id: `rzp_order_${Math.random().toString(36).substr(2, 9)}`,
        entity: "order",
        amount: options.amount,
        amount_paid: 0,
        amount_due: options.amount,
        currency: options.currency || "INR",
        receipt: options.receipt,
        status: "created",
        attempts: 0,
        notes: options.notes || {},
        created_at: Math.floor(Date.now() / 1000)
      };
    }
  },
  payments: {
    verifySignature: (paymentDetails) => {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentDetails;
      if (isMock) {
        // In mock mode, we accept mock payment signatures
        console.warn("⚠️ Razorpay Mock Signature Verification Successful");
        return true;
      }
      
      const generated_signature = crypto
        .createHmac('sha256', keySecret)
        .update(razorpay_order_id + "|" + razorpay_payment_id)
        .digest('hex');
      
      return generated_signature === razorpay_signature;
    }
  }
};

module.exports = isMock ? razorpayMock : {
  isMock: false,
  orders: {
    create: (options) => razorpayInstance.orders.create(options)
  },
  payments: {
    verifySignature: (paymentDetails) => {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentDetails;
      const generated_signature = crypto
        .createHmac('sha256', keySecret)
        .update(razorpay_order_id + "|" + razorpay_payment_id)
        .digest('hex');
      return generated_signature === razorpay_signature;
    }
  }
};
