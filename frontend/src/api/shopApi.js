import { fetchWithAuth } from './client.js';

export const shopApi = {
  getProducts: () => fetchWithAuth('/products'),
  addProduct: (productData) => fetchWithAuth('/products', {
    method: 'POST',
    body: JSON.stringify(productData),
  }),
  getMyOrders: () => fetchWithAuth('/orders/my-orders'),
  checkout: (cart, totalAmount) => fetchWithAuth('/orders/checkout', {
    method: 'POST',
    body: JSON.stringify({ cart, totalAmount }),
  }),
  verifyPayment: (paymentDetails) => fetchWithAuth('/orders/verify-payment', {
    method: 'POST',
    body: JSON.stringify(paymentDetails),
  }),
};
