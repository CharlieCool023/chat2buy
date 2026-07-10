/**
 * WhatsApp Cloud API Helpers
 * Sends messages, images, and other media types via Meta's Graph API
 */

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}`;
const DRY_RUN = process.env.WHATSAPP_DRY_RUN === 'true';

function assertWhatsAppConfigured() {
    if (DRY_RUN) return;
    if (!PHONE_NUMBER_ID || !WHATSAPP_TOKEN) {
        throw new Error('WhatsApp credentials are missing. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN, or set WHATSAPP_DRY_RUN=true for local testing.');
    }
}

/**
 * Send a text message via WhatsApp
 */
export async function sendText(to, body) {
    try {
        if (DRY_RUN) {
            console.log(`[WhatsApp:dry-run] text to ${to}: ${body}`);
            return { dry_run: true, to, type: 'text', body };
        }
        assertWhatsAppConfigured();
        const response = await fetch(`${BASE_URL}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body }
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('[WhatsApp] Send text error:', data);
            throw new Error(data.error?.message || 'Failed to send message');
        }
        return data;
    } catch (err) {
        console.error('[WhatsApp] sendText error:', err.message);
        throw err;
    }
}

/**
 * Send an image via WhatsApp
 */
export async function sendImage(to, imageUrl, caption = '') {
    try {
        if (DRY_RUN) {
            console.log(`[WhatsApp:dry-run] image to ${to}: ${imageUrl} ${caption}`);
            return { dry_run: true, to, type: 'image', imageUrl, caption };
        }
        assertWhatsAppConfigured();
        const response = await fetch(`${BASE_URL}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'image',
                image: {
                    link: imageUrl,
                    caption: caption || undefined
                }
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('[WhatsApp] Send image error:', data);
            throw new Error(data.error?.message || 'Failed to send image');
        }
        return data;
    } catch (err) {
        console.error('[WhatsApp] sendImage error:', err.message);
        throw err;
    }
}

/**
 * Send a quick-reply interactive message
 */
export async function sendQuickReplies(to, body, replies) {
    try {
        if (DRY_RUN) {
            console.log(`[WhatsApp:dry-run] quick replies to ${to}: ${body} ${JSON.stringify(replies)}`);
            return { dry_run: true, to, type: 'quick_replies', body, replies };
        }
        assertWhatsAppConfigured();
        const response = await fetch(`${BASE_URL}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: body },
                    action: {
                        buttons: replies.slice(0, 3).map((r, i) => ({
                            type: 'reply',
                            reply: { id: `btn_${i}`, title: r.title }
                        }))
                    }
                }
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('[WhatsApp] Quick replies error:', data);
            throw new Error(data.error?.message || 'Failed to send quick replies');
        }
        return data;
    } catch (err) {
        console.error('[WhatsApp] sendQuickReplies error:', err.message);
        throw err;
    }
}

/**
 * Send a list message (for menu/catalog browsing)
 */
export async function sendList(to, header, body, items) {
    try {
        if (DRY_RUN) {
            console.log(`[WhatsApp:dry-run] list to ${to}: ${header} ${body} ${JSON.stringify(items)}`);
            return { dry_run: true, to, type: 'list', header, body, items };
        }
        assertWhatsAppConfigured();
        const rows = items.slice(0, 10).map((item, i) => ({
            id: `item_${item.id || i}`,
            title: item.name.substring(0, 24),
            description: `₦${item.price?.toLocaleString()} - ${item.description?.substring(0, 72) || ''}`
        }));

        const response = await fetch(`${BASE_URL}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'interactive',
                interactive: {
                    type: 'list',
                    header: header ? { type: 'text', text: header } : undefined,
                    body: { text: body },
                    action: {
                        button: 'View options',
                        sections: [{ title: 'Menu', rows }]
                    }
                }
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('[WhatsApp] Send list error:', data);
            throw new Error(data.error?.message || 'Failed to send list');
        }
        return data;
    } catch (err) {
        console.error('[WhatsApp] sendList error:', err.message);
        throw err;
    }
}

/**
 * Mark a message as read
 */
export async function markAsRead(messageId) {
    try {
        if (DRY_RUN) return { dry_run: true };
        assertWhatsAppConfigured();
        await fetch(`${BASE_URL}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            })
        });
    } catch (err) {
        console.error('[WhatsApp] markAsRead error:', err.message);
    }
}
