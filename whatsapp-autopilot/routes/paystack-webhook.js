import express from 'express';
import * as db from '../lib/db.js';
import * as wa from '../lib/whatsapp.js';
import * as paystack from '../lib/paystack.js';

const router = express.Router();

/**
 * POST /webhook/paystack — Receive Paystack payment events
 */
router.post('/paystack', express.json(), async (req, res) => {
    // Acknowledge immediately
    res.sendStatus(200);

    try {
        const event = req.body;
        const signature = req.headers['x-paystack-signature'];

        // Verify signature (lenient in dev)
        if (process.env.NODE_ENV !== 'development') {
            const isValid = paystack.verifyWebhookSignature(event, signature);
            if (!isValid) {
                console.error('[Paystack Webhook] Invalid signature');
                return;
            }
        }

        if (event.event === 'charge.success') {
            const data = event.data;
            const reference = data.reference;
            const metadata = data.metadata || {};
            const orderId = metadata.orderId || metadata.custom_fields?.find(f => f.variable_name === 'order_id')?.value;
            const customerPhone = metadata.phone || metadata.custom_fields?.find(f => f.variable_name === 'customer')?.value;

            console.log(`[Paystack] Payment success: ref=${reference}, order=${orderId}`);

            if (!orderId) {
                console.error('[Paystack Webhook] No orderId in metadata');
                return;
            }

            // Update order
            const order = await db.getOrder(orderId);
            if (!order) {
                console.error(`[Paystack Webhook] Order ${orderId} not found`);
                return;
            }

            await db.updateOrderPayment(orderId, {
                paymentStatus: 'paid',
                paystackReference: reference
            });

            // Notify customer
            if (customerPhone) {
                await wa.sendText(customerPhone,
                    `*Payment received!* ✅\n\n` +
                    `Order #${orderId} is confirmed. We'll start preparing your order right away.\n\n` +
                    `Thanks for choosing us! 🙏`
                );
            }

            // Notify owner
            const business = await db.getBusinessById(order.business_id);
            if (business) {
                await wa.sendText(business.owner_whatsapp_number,
                    `*Payment received for Order #${orderId}* ✅\n\n` +
                    `Amount: ₦${(data.amount / 100).toLocaleString()}\n` +
                    `Reference: ${reference}\n\n` +
                    `Order is paid and ready to fulfill! 🎉`
                );
            }
        }

        else if (event.event === 'charge.failed') {
            const data = event.data;
            const orderId = data.metadata?.orderId;

            if (orderId) {
                await db.updateOrderPayment(orderId, { paymentStatus: 'failed' });

                const order = await db.getOrder(orderId);
                if (order) {
                    await wa.sendText(order.customer_number,
                        `Your payment couldn't be processed. 😔\n\n` +
                        `No worries — you can try again or pay on ${order.fulfillment === 'pickup' ? 'pickup' : 'delivery'}.\n\n` +
                        `Reply if you need help!`
                    );
                }
            }
        }

    } catch (err) {
        console.error('[Paystack Webhook] Error:', err);
    }
});

export default router;
