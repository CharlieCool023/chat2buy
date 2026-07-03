/**
 * WhatsApp Cloud API Helpers
 * Sends messages, images, and other media types via Meta's Graph API
 */

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}`;

/**
 * Send a text message via WhatsApp
 */
export async function sendText(to, body) {
    try {
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
