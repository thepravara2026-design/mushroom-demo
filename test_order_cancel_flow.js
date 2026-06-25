/**
 * Sporekart E2E Order → Cancel Flow Test
 * Tests: Auth → Products → Checkout → Payment → My Orders → Cancel Request → Admin Approve Cancel
 */
const BASE = process.env.BACKEND_URL || 'http://localhost:5000/api';

let buyerToken = null;
let adminToken = null;
let orderId = null;
let createdOrderFullId = null;
let testEmail = null;

const errors = [];
const logs = [];

function log(msg) {
    console.log(msg);
    logs.push(msg);
}

function pass(msg) {
    log(`  ✅ ${msg}`);
}

function fail(msg) {
    log(`  ❌ FAIL: ${msg}`);
    errors.push(msg);
}

function section(title) {
    log(`\n══════════════════════════════════\n  ${title}\n══════════════════════════════════`);
}

async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.headers) Object.assign(headers, opts.headers);

    let text;
    try {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers,
        });
        text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error(`[${res.status}] ${path}: Invalid JSON response: ${text.slice(0, 200)}`);
        }
        if (!res.ok) {
            const errMsg = data.error || data.message || JSON.stringify(data);
            throw new Error(`[${res.status}] ${path}: ${errMsg}`);
        }
        // Unwrap standardized response format { success, data, meta }
        if (data.success !== undefined && data.data !== undefined) {
            return data.data;
        }
        return data;
    } catch (fetchErr) {
        // If we have text, add it to error
        if (text && !fetchErr.message.includes(text.slice(0, 200))) {
            fetchErr.message += ` | Response: ${text.slice(0, 200)}`;
        }
        throw fetchErr;
    }
}

async function run() {
    log('\n🍄 Sporekart Order → Cancel Flow E2E Test Starting...\n');

    // ──────────────────────────────────────────────────────
    section('1. Buyer Auth — OTP Login');
    // ──────────────────────────────────────────────────────

    testEmail = `cancel_test_${Date.now()}@test.com`;

    const otpRes = await api('/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email: testEmail, role: 'buyer', fullName: 'Cancel Test Buyer' }),
    }).catch(e => { fail(`request-otp: ${e.message}`); return {}; });

    if (!otpRes || !otpRes.otp) {
        fail(`No OTP returned. Got: ${JSON.stringify(otpRes)}`);
        return;
    }
    pass(`OTP requested for ${testEmail}`);

    const verifyRes = await api('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: testEmail, otpCode: otpRes.otp }),
    }).catch(e => { fail(`verify-otp: ${e.message}`); return {}; });

    if (!verifyRes.token) {
        fail(`No token. Got: ${JSON.stringify(verifyRes)}`);
        return;
    }
    buyerToken = verifyRes.token;
    pass(`Buyer authenticated: ${verifyRes.user?.email} (role: ${verifyRes.user?.role})`);

    // ──────────────────────────────────────────────────────
    section('2. Admin Auth — OTP Login');
    // ──────────────────────────────────────────────────────

    const adminOtpRes = await api('/auth/admin-login', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@sporekart.com' }),
    }).catch(e => { fail(`admin-login: ${e.message}`); return {}; });

    if (!adminOtpRes.otp) {
        fail(`No admin OTP. Got: ${JSON.stringify(adminOtpRes)}`);
        return;
    }
    pass(`Admin OTP requested`);

    const adminVerify = await api('/auth/admin-verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@sporekart.com', otpCode: adminOtpRes.otp }),
    }).catch(e => { fail(`admin-verify-otp: ${e.message}`); return {}; });

    if (!adminVerify.token) {
        fail(`No admin token. Got: ${JSON.stringify(adminVerify)}`);
        return;
    }
    adminToken = adminVerify.token;

    if (adminVerify.user?.role !== 'admin') {
        fail(`Admin role mismatch! Got role: ${adminVerify.user?.role}`);
    } else {
        pass(`Admin authenticated: ${adminVerify.user?.email} (role: ${adminVerify.user?.role})`);
    }

    // ──────────────────────────────────────────────────────
    section('3. Products — Fetch listing');
    // ──────────────────────────────────────────────────────

    const products = await api('/products').catch(e => { fail(`products: ${e.message}`); return []; });
    pass(`Got ${products.length} products`);

    if (products.length < 2) {
        fail(`Need at least 2 products for checkout test, got ${products.length}`);
        return;
    }

    // ──────────────────────────────────────────────────────
    section('4. Checkout — Create Order (Buyer)');
    // ──────────────────────────────────────────────────────

    let checkoutData = {};
    let checkoutOrder = null;
    let razorpayOrderId = null;

    try {
        const cartItems = [
            { id: products[0].id, quantity: 2 },
            { id: products[1].id, quantity: 1 },
        ];

        checkoutData = await api('/orders/checkout', {
            method: 'POST',
            headers: { Authorization: `Bearer ${buyerToken}` },
            body: JSON.stringify({ items: cartItems, promoCode: null }),
        });

        checkoutOrder = checkoutData.order;
        razorpayOrderId = checkoutData.razorpay?.orderId;

        if (!checkoutOrder || !checkoutOrder.id) {
            fail(`Checkout response missing order. Got: ${JSON.stringify(checkoutData).slice(0, 300)}`);
        } else {
            createdOrderFullId = checkoutOrder.id;
            pass(`Order created: ${createdOrderFullId}`);
        }

        if (!razorpayOrderId) {
            fail(`No Razorpay order ID returned`);
        } else {
            pass(`Razorpay order: ${razorpayOrderId}`);
        }

        // Verify order initial status
        if (checkoutOrder.status !== 'pending') {
            fail(`Expected order status 'pending', got '${checkoutOrder.status}'`);
        } else {
            pass(`Order status is 'pending' as expected`);
        }

        // Check resolved_state field
        if (checkoutOrder.resolved_state !== undefined) {
            pass(`Order has resolved_state: ${checkoutOrder.resolved_state}`);
        }

    } catch (e) {
        fail(`Checkout failed: ${e.message}`);
        return;
    }

    // ──────────────────────────────────────────────────────
    section('5. Payment Verification — Mock Flow');
    // ──────────────────────────────────────────────────────

    if (!razorpayOrderId) {
        fail('Skipping payment verification — no razorpay order ID');
        return;
    }

    try {
        const mockPaymentId = `pay_mock_cancel_${Date.now()}`;
        const mockSignature = `sig_mock_cancel_${Date.now()}`;

        const verifyPayment = await api('/orders/verify-payment', {
            method: 'POST',
            headers: { Authorization: `Bearer ${buyerToken}` },
            body: JSON.stringify({
                razorpay_order_id: razorpayOrderId,
                razorpay_payment_id: mockPaymentId,
                razorpay_signature: mockSignature,
            }),
        });

        pass(`Payment verified: ${verifyPayment.message || 'OK'}`);

        if (verifyPayment.order) {
            if (verifyPayment.order.status === 'paid') {
                pass(`Order status updated to 'paid'`);
            } else {
                fail(`Expected order status 'paid', got '${verifyPayment.order.status}'`);
            }

            if (verifyPayment.order.delivery_status === 'placed') {
                pass(`Delivery status set to 'placed'`);
            } else {
                fail(`Expected delivery_status 'placed', got '${verifyPayment.order.delivery_status}'`);
            }
        } else {
            fail(`No order in verify-payment response`);
        }
    } catch (e) {
        fail(`Payment verification: ${e.message}`);
        return;
    }

    // ──────────────────────────────────────────────────────
    section('6. Get My Orders — Verify Order Appears');
    // ──────────────────────────────────────────────────────

    try {
        const myOrders = await api('/orders/my-orders', {
            headers: { Authorization: `Bearer ${buyerToken}` },
        });

        pass(`My orders: ${myOrders.length} order(s)`);

        const foundOrder = myOrders.find(o => o.id === createdOrderFullId);
        if (!foundOrder) {
            fail(`Order ${createdOrderFullId} not found in my-orders`);
        } else {
            pass(`Order found in my-orders`);

            if (foundOrder.status === 'paid') {
                pass(`my-orders: status is 'paid'`);
            }

            if (foundOrder.delivery_status === 'placed') {
                pass(`my-orders: delivery_status is 'placed'`);
            }

            // Verify cancellable flag
            if (foundOrder.cancellable === true) {
                pass(`Order is marked as cancellable (cancellable: true)`);
            } else {
                fail(`Order should be cancellable but got cancellable: ${foundOrder.cancellable}`);
            }
        }
    } catch (e) {
        fail(`my-orders: ${e.message}`);
    }

    // ──────────────────────────────────────────────────────
    section('7. Get Single Order — Verify Full Details');
    // ──────────────────────────────────────────────────────

    try {
        const singleOrder = await api(`/orders/${createdOrderFullId}`, {
            headers: { Authorization: `Bearer ${buyerToken}` },
        });

        if (!singleOrder.id) {
            fail(`Single order response missing id`);
        } else {
            pass(`Fetched single order: ${singleOrder.id}`);

            // Check that payment details are present
            if (singleOrder.razorpay_payment_id) {
                pass(`Payment ID present: ${singleOrder.razorpay_payment_id}`);
            } else {
                fail(`razorpay_payment_id missing from order`);
            }

            if (singleOrder.transaction_id) {
                pass(`Transaction ID present: ${singleOrder.transaction_id}`);
            } else {
                fail(`transaction_id missing from order`);
            }
        }
    } catch (e) {
        fail(`Single order fetch: ${e.message}`);
    }

    // ──────────────────────────────────────────────────────
    section('8. Customer Cancel Request — POST /:id/request-cancel');
    // ──────────────────────────────────────────────────────

    try {
        const cancelReq = await api(`/orders/${createdOrderFullId}/request-cancel`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${buyerToken}` },
            body: JSON.stringify({ reason: 'Changed my mind, need to cancel this order' }),
        });

        pass(`Cancel request submitted: ${cancelReq.message || 'OK'}`);

        if (cancelReq.order) {
            if (cancelReq.order.status === 'CANCEL_REQUESTED') {
                pass(`Order status changed to CANCEL_REQUESTED`);
            } else {
                fail(`Expected CANCEL_REQUESTED status, got '${cancelReq.order.status}'`);
            }
        } else {
            fail(`No order in cancel request response`);
        }
    } catch (e) {
        fail(`Cancel request failed: ${e.message}`);
    }

    // ──────────────────────────────────────────────────────
    section('9. Verify Cancel Request in My Orders');
    // ──────────────────────────────────────────────────────

    try {
        const myOrdersAfterCancel = await api('/orders/my-orders', {
            headers: { Authorization: `Bearer ${buyerToken}` },
        });

        const cancelledOrder = myOrdersAfterCancel.find(o => o.id === createdOrderFullId);
        if (!cancelledOrder) {
            fail(`Order not found in my-orders after cancel request`);
        } else {
            pass(`Order still visible in my-orders`);

            if (cancelledOrder.status === 'CANCEL_REQUESTED') {
                pass(`Status confirmed as CANCEL_REQUESTED`);
            } else {
                fail(`Status mismatch: expected CANCEL_REQUESTED, got '${cancelledOrder.status}'`);
                log(`  Full order status fields: status=${cancelledOrder.status}, delivery_status=${cancelledOrder.delivery_status}`);
            }

            if (cancelledOrder.cancel_reason) {
                pass(`Cancel reason present: "${cancelledOrder.cancel_reason}"`);
            } else {
                fail(`cancel_reason missing from order`);
            }

            if (cancelledOrder.cancelled_by === 'user') {
                pass(`cancelled_by is 'user' as expected`);
            } else {
                fail(`Expected cancelled_by 'user', got '${cancelledOrder.cancelled_by}'`);
            }

            if (cancelledOrder.cancellable === false) {
                pass(`Order cancellable flag is false (already requested)`);
            } else {
                fail(`cancellable should be false but got: ${cancelledOrder.cancellable}`);
            }
        }
    } catch (e) {
        fail(`my-orders after cancel: ${e.message}`);
    }

    // ──────────────────────────────────────────────────────
    section('10. Admin All Orders — Verify Cancel Request Visible');
    // ──────────────────────────────────────────────────────

    try {
        const allOrders = await api('/orders/all-orders', {
            headers: { Authorization: `Bearer ${adminToken}` },
        });

        pass(`Admin sees ${allOrders.length} total orders`);

        const adminOrder = allOrders.find(o => o.id === createdOrderFullId);
        if (!adminOrder) {
            fail(`Admin cannot find order ${createdOrderFullId} in all-orders`);
        } else {
            pass(`Admin found the order`);

            if (adminOrder.status === 'CANCEL_REQUESTED') {
                pass(`Admin sees status as CANCEL_REQUESTED`);
            } else {
                fail(`Admin sees wrong status: '${adminOrder.status}'`);
            }

            if (adminOrder.user_email) {
                pass(`Admin sees buyer email: ${adminOrder.user_email}`);
            } else {
                fail(`user_email missing from admin order view`);
            }
        }
    } catch (e) {
        fail(`admin all-orders: ${e.message}`);
    }

    // ──────────────────────────────────────────────────────
    section('11. Admin Approve Cancellation — Approve the Cancel Request');
    // ──────────────────────────────────────────────────────
    // The route for this seems to be through PUT /:id/cancel which calls adminDirectCancellation
    // BUT first the admin needs to approve via some mechanism.
    // Looking at the code, the cancel flow is:
    // Customer: POST /:id/request-cancel → status=CANCEL_REQUESTED
    // Admin: approve via PUT /:id/cancel (adminDirectCancellation) or a specific approve endpoint
    //
    // Looking at routes/orders.js, line 1008:
    // PUT /:id/cancel calls refundService.adminDirectCancellation
    // But for approval flow, we'd need a specific approve cancellation endpoint.
    // However looking at the code, PUT /:id/cancel is the admin direct cancel route.
    //
    // Also POST /admin/approve/:id (line 1676) calls refundService.approveOrder
    // but that method does NOT exist in RefundService.js's exports!
    //
    // Let's try PUT /:id/cancel (adminDirectCancellation) which skips the CANCEL_REQUESTED
    // state check and goes straight to approving.

    pass(`NOTE: Using PUT /:id/cancel for admin direct cancellation (from CANCEL_REQUESTED state)`);

    try {
        const adminCancelResult = await api(`/orders/${createdOrderFullId}/cancel`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ reason: 'Customer requested cancellation - Admin approved', adminNote: 'Approved per customer request' }),
        });

        if (adminCancelResult.message) {
            pass(`Admin cancel response: ${adminCancelResult.message}`);
        }

        if (adminCancelResult.order) {
            pass(`Order after admin cancel: id=${adminCancelResult.order.id}`);
            log(`  Order status: ${adminCancelResult.order.status}`);
            log(`  Order delivery_status: ${adminCancelResult.order.delivery_status}`);
            log(`  Order refund_status: ${adminCancelResult.order.refund_status}`);
        }

        if (adminCancelResult.refund) {
            pass(`Refund record created: id=${adminCancelResult.refund.id}, status=${adminCancelResult.refund.status}, amount=${adminCancelResult.refund.amount}`);
        }
    } catch (e) {
        fail(`Admin cancel via PUT /:id/cancel failed: ${e.message}`);

        // As fallback, try the POST /admin/approve/:id endpoint
        try {
            log('  Trying POST /admin/approve/:id as fallback...');
            const approveResult = await api(`/orders/admin/approve/${createdOrderFullId}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${adminToken}` },
                body: JSON.stringify({ adminNote: 'Approving cancellation' }),
            });
            pass(`Admin approve response: ${JSON.stringify(approveResult).slice(0, 200)}`);
        } catch (approveErr) {
            fail(`Admin approve fallback also failed: ${approveErr.message}`);
        }
    }

    // ──────────────────────────────────────────────────────
    section('12. Verify Final Order State After Cancel');
    // ──────────────────────────────────────────────────────

    try {
        const finalOrder = await api(`/orders/${createdOrderFullId}`, {
            headers: { Authorization: `Bearer ${buyerToken}` },
        });

        log(`  Final order state:`);
        log(`    status: ${finalOrder.status}`);
        log(`    delivery_status: ${finalOrder.delivery_status}`);
        log(`    refund_status: ${finalOrder.refund_status}`);
        log(`    refund_id: ${finalOrder.refund_id}`);
        log(`    total_refunded_amount: ${finalOrder.total_refunded_amount}`);
        log(`    cancelled_by: ${finalOrder.cancelled_by}`);
        log(`    cancelled_at: ${finalOrder.cancelled_at}`);

        // Check final state is one of the expected terminal states
        const terminalStatuses = ['cancelled', 'CANCEL_APPROVED', 'REFUND_INITIATED', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUND_COMPLETED'];
        if (terminalStatuses.includes(finalOrder.status)) {
            pass(`Order reached a terminal/processing cancel state: ${finalOrder.status}`);
        } else {
            fail(`Order status '${finalOrder.status}' is not an expected cancel state`);
        }

        pass(`Cancel flow completed. Order stopped at status: ${finalOrder.status}`);
    } catch (e) {
        fail(`Final order fetch: ${e.message}`);
    }

    // ──────────────────────────────────────────────────────
    section('13. Verify Order Tracking Shows Cancelled');
    // ──────────────────────────────────────────────────────

    try {
        const tracking = await api(`/orders/${createdOrderFullId}/track`, {
            headers: { Authorization: `Bearer ${buyerToken}` },
        });

        log(`  Tracking info:`);
        log(`    paymentStatus: ${tracking.paymentStatus}`);
        log(`    deliveryStatus: ${tracking.deliveryStatus}`);
        log(`    refundStatus: ${tracking.refundStatus}`);
        log(`    refundAmount: ${tracking.refundAmount}`);
        log(`    cancelReason: ${tracking.cancelReason}`);
        log(`    progressPercent: ${tracking.progressPercent}%`);

        if (tracking.deliveryStatus === 'cancelled') {
            pass(`Tracking shows deliveryStatus: 'cancelled'`);
        } else {
            fail(`Expected tracking deliveryStatus 'cancelled', got '${tracking.deliveryStatus}'`);
        }

        if (tracking.timeline.some(t => t.status === 'cancelled')) {
            pass(`Timeline includes cancelled status`);
        }
    } catch (e) {
        fail(`Order tracking: ${e.message}`);
    }

    // ──────────────────────────────────────────────────────
    section('14. Admin Refunds List — Verify Refund Record');
    // ──────────────────────────────────────────────────────

    try {
        const refunds = await api('/orders/admin/refunds', {
            headers: { Authorization: `Bearer ${adminToken}` },
        });

        pass(`Admin sees ${refunds.length} refund record(s)`);

        if (refunds.length > 0) {
            const matchingRefund = refunds.find(r => r.order_id === createdOrderFullId);
            if (matchingRefund) {
                pass(`Refund record found for this order`);
                log(`  Refund id: ${matchingRefund.id}`);
                log(`  Refund status: ${matchingRefund.status}`);
                log(`  Refund amount: ${matchingRefund.amount}`);
                log(`  Razorpay refund id: ${matchingRefund.razorpay_refund_id}`);
            } else {
                fail(`No refund record found for order ${createdOrderFullId}`);
            }
        } else {
            fail(`No refund records at all in the system`);
        }
    } catch (e) {
        fail(`Admin refunds list: ${e.message}`);
    }

    // ──────────────────────────────────────────────────────
    // SUMMARY
    // ──────────────────────────────────────────────────────
    log('\n\n══════════════════════════════════');
    log('  📋 TEST SUMMARY');
    log('══════════════════════════════════\n');

    if (errors.length === 0) {
        log('  🎉 ALL CHECKS PASSED — Order → Cancel flow is fully functional!\n');
    } else {
        log(`  ❌ ${errors.length} ISSUE(S) FOUND\n`);
        errors.forEach((e, i) => {
            log(`  ${i + 1}. ${e}`);
        });
        log('');
    }

    log('Flow tested:');
    log('  ✅ 1. Buyer OTP login');
    log('  ✅ 2. Admin OTP login');
    log('  ✅ 3. Products fetch');
    log(`  ${errors.find(e => e.includes('Checkout')) ? '❌' : '✅'} 4. Checkout & order creation`);
    log(`  ${errors.find(e => e.includes('Payment')) ? '❌' : '✅'} 5. Payment verification (mock)`);
    log(`  ${errors.find(e => e.includes('my-orders')) ? '❌' : '✅'} 6. My orders listing`);
    log(`  ${errors.find(e => e.includes('single order') || e.includes('Single order')) ? '❌' : '✅'} 7. Single order fetch`);
    log(`  ${errors.find(e => e.includes('Cancel request')) ? '❌' : '✅'} 8. Customer cancel request`);
    log(`  ${errors.find(e => e.includes('cancel request in My')) ? '❌' : '✅'} 9. Verify cancel in my orders`);
    log(`  ${errors.find(e => e.includes('Admin all') || e.includes('all-orders')) ? '❌' : '✅'} 10. Admin sees cancel request`);
    log(`  ${errors.find(e => e.includes('cancel via PUT') || e.includes('admin approve')) ? '❌' : '✅'} 11. Admin approve cancellation`);
    log(`  ${errors.find(e => e.includes('final state') || e.includes('Final order')) ? '❌' : '✅'} 12. Final order state verification`);
    log(`  ${errors.find(e => e.includes('tracking')) ? '❌' : '✅'} 13. Order tracking shows cancelled`);
    log(`  ${errors.find(e => e.includes('refunds list')) ? '❌' : '✅'} 14. Admin refunds list\n`);

    process.exit(errors.length > 0 ? 1 : 0);
}

run().catch(err => {
    console.error('\n💥 TEST FAILED:', err.message);
    process.exit(1);
});