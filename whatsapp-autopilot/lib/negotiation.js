export function evaluateDiscount({ baseTotal, proposedTotal, quantity, policy }) {
    if (!baseTotal || proposedTotal >= baseTotal) {
        return { approved: true, finalTotal: proposedTotal, discountPct: 0, savings: 0 };
    }

    const discountPct = (1 - proposedTotal / baseTotal) * 100;
    const bulkUnlocked = quantity >= (policy.bulk_min_qty || 20);
    const allowedPct = bulkUnlocked
        ? (policy.bulk_discount_pct || 5)
        : (policy.max_discount_pct_no_bulk || 2);

    if (discountPct <= allowedPct) {
        return {
            approved: true,
            finalTotal: proposedTotal,
            discountPct: Math.round(discountPct * 100) / 100,
            savings: baseTotal - proposedTotal
        };
    }

    const counterTotal = Math.round(baseTotal * (1 - allowedPct / 100));
    return {
        approved: false,
        escalate: discountPct > (allowedPct + 8),
        reason: `Customer wants ${discountPct.toFixed(1)}% off; policy allows ${allowedPct}% at this quantity (${quantity} items).`,
        counterTotal,
        counterPct: allowedPct,
        savings: baseTotal - counterTotal
    };
}

export function calculateTotals(items, policy, fulfillment, discountApplied = 0) {
    const subtotal = items.reduce((sum, item) => {
        return sum + (Number(item.qty || 0) * Number(item.unit_price || item.price || 0));
    }, 0);

    const deliveryFee = fulfillment === 'delivery' ? Number(policy?.delivery_fee || 1500) : 0;
    const total = Math.max(0, subtotal - Number(discountApplied || 0) + deliveryFee);

    return { subtotal, discountApplied, deliveryFee, total };
}

export function renderQuoteRecap(order, policy) {
    const lines = order.items.map(i =>
        `${i.qty} x ${i.name} - NGN ${(Number(i.qty) * Number(i.unit_price)).toLocaleString()}`
    );

    const deliveryFee = order.deliveryFee ?? order.delivery_fee ?? policy?.delivery_fee ?? 1500;
    const deliveryLine = order.fulfillment === 'delivery'
        ? `Delivery fee: NGN ${Number(deliveryFee).toLocaleString()}`
        : 'Pickup - no delivery fee';

    const parts = [
        '*Here is your order:*',
        '',
        ...lines,
        '',
        deliveryLine,
    ];

    const discount = order.discount_applied ?? order.discountApplied ?? 0;
    if (discount > 0) {
        parts.push(`Discount applied: -NGN ${Number(discount).toLocaleString()}`);
    }

    parts.push('');
    parts.push(`*Total: NGN ${Number(order.total || 0).toLocaleString()}*`);
    parts.push('');
    parts.push('Reply CONFIRM to lock this in and get your payment link.');

    return parts.join('\n');
}

export function shouldEscalate(evaluation) {
    return evaluation.escalate === true;
}

export function buildEscalationMessage(business, order, evaluation, customerNumber) {
    const items = order.items?.map(i => `- ${i.qty} x ${i.name}`).join('\n') || 'No items';
    return `*Discount Escalation*\n\n` +
        `Customer: ${customerNumber}\n` +
        `Items:\n${items}\n\n` +
        `${evaluation.reason}\n` +
        `Counter-offer: NGN ${evaluation.counterTotal?.toLocaleString()}\n\n` +
        `Reply with an approved amount, or NO to reject.`;
}

export function buildOrderTicket(business, order) {
    const items = order.items?.map(i => `- ${i.qty} x ${i.name}`).join('\n') || '';
    const discount = order.discount_applied ?? order.discountApplied ?? 0;
    const discountLine = discount > 0 ? `\nDiscount: NGN ${Number(discount).toLocaleString()}` : '';

    return `*New Order #${order.id}*\n\n` +
        `${items}\n\n` +
        `Fulfillment: ${order.fulfillment}${order.address ? `\nAddress: ${order.address}` : ''}\n\n` +
        `*Total: NGN ${Number(order.total || 0).toLocaleString()}*${discountLine}\n` +
        `Payment: ${order.payment_status}\n\n` +
        `Please prepare this order once payment is confirmed.`;
}
