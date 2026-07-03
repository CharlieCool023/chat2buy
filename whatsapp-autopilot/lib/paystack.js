/**
 * Paystack Payment Integration (Test Mode)
 * Handles payment link generation and verification
 */

import crypto from 'crypto';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const CALLBACK_URL = process.env.PAYSTACK_CALLBACK_URL;

/**
 * Initialize a Paystack transaction and get payment link
 */
export async function createPaymentLink({ amount, reference, email, metadata = {} }) {
    try {
        const response = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email || `${metadata.phone}@placeholder.soko`,
                amount: Math.round(amount * 100), // Paystack uses kobo (Naira * 100)
                reference,
                callback_url: CALLBACK_URL,
                metadata: {
                    ...metadata,
                    custom_fields: [
                        { display_name: 'Order ID', variable_name: 'order_id', value: metadata.orderId },
                        { display_name: 'Customer', variable_name: 'customer', value: metadata.phone }
                    ]
                }
            })
        });

        const data = await response.json();
        if (!data.status) {
            console.error('[Paystack] Initialize error:', data);
            throw new Error(data.message || 'Failed to create payment link');
        }

        return {
            paymentLink: data.data.authorization_url,
            reference: data.data.reference,
            accessCode: data.data.access_code
        };
    } catch (err) {
        console.error('[Paystack] createPaymentLink error:', err.message);
        throw err;
    }
}

/**
 * Verify a Paystack transaction
 */
export async function verifyTransaction(reference) {
    try {
        const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (!data.status) {
            console.error('[Paystack] Verify error:', data);
            return { success: false, message: data.message };
        }

        return {
            success: data.data.status === 'success',
            status: data.data.status,
            amount: data.data.amount / 100,
            reference: data.data.reference,
            paidAt: data.data.paid_at,
            channel: data.data.channel,
            metadata: data.data.metadata
        };
    } catch (err) {
        console.error('[Paystack] verifyTransaction error:', err.message);
        return { success: false, message: err.message };
    }
}

/**
 * Verify Paystack webhook signature
 */
export function verifyWebhookSignature(body, signature) {
    // In test mode, we can be lenient. In production, use crypto to verify.
    if (process.env.NODE_ENV === 'development') {
        return true;
    }

    try {
        const hash = crypto.createHmac('sha512', PAYSTACK_SECRET)
            .update(JSON.stringify(body))
            .digest('hex');
        return hash === signature;
    } catch {
        return false;
    }
}
