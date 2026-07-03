import OpenAI from 'openai';

const qwen = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

const REASONING_MODEL = process.env.AI_MODEL || 'qwen3.7-flash';

export const AGENT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'propose_discount',
            description: 'Propose a discounted total for the current draft order. Code checks the policy before the customer sees it.',
            parameters: {
                type: 'object',
                properties: {
                    proposed_total: { type: 'number', description: 'Proposed total amount in Nigerian Naira' },
                    quantity: { type: 'number', description: 'Total item quantity across the order' },
                    reason: { type: 'string', description: 'Brief reason for the discount' }
                },
                required: ['proposed_total', 'quantity']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'finalize_quote',
            description: 'Create a formal quote once the customer has provided clear items, quantities, and pickup or delivery details.',
            parameters: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                qty: { type: 'number' },
                                unit_price: { type: 'number' }
                            },
                            required: ['name', 'qty']
                        }
                    },
                    fulfillment: { type: 'string', enum: ['delivery', 'pickup'] },
                    address: { type: 'string', description: 'Delivery address, only when delivery is requested' }
                },
                required: ['items', 'fulfillment']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'send_image',
            description: 'Send a product photo when the customer asks to see an item.',
            parameters: {
                type: 'object',
                properties: {
                    item_name: { type: 'string', description: 'Name of the item to show' }
                },
                required: ['item_name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'show_menu_list',
            description: 'Show the menu or a category when the customer wants to browse.',
            parameters: {
                type: 'object',
                properties: {
                    category: { type: 'string', description: 'Optional catalog category filter' }
                }
            }
        }
    }
];

export function buildCustomerPrompt(business, catalog, policy, convo) {
    const catalogText = catalog.map(item =>
        `- ${item.name}: NGN ${Number(item.price).toLocaleString()} (${item.category})\n  ${item.description || 'No description'}`
    ).join('\n');

    const orderDraft = convo.context?.order || {};
    const cartItems = orderDraft.items || [];

    return `You are the warm, friendly sales assistant for ${business.name}. ${business.description || ''} You chat like a real Nigerian vendor: relaxed, helpful, and easy to talk to. You must help customers naturally, without forcing exact command words.

PERSONALITY AND STYLE:
- Sound human, not scripted. Use short sentences, contractions, and a natural WhatsApp rhythm.
- Match the customer's tone. Casual customer gets a casual reply; formal customer gets a respectful reply.
- Light Nigerian English or Pidgin is welcome when it fits: "No wahala", "How far", "Sure", "I hear you".
- Use at most one emoji when it adds warmth. Do not force it.
- Keep most replies to 2-4 short sentences.
- Ask one clear next question at a time.
- Understand natural requests like "two jollof", "show me rice", "can you deliver", "any cheaper one", "I want to pay".

CURRENT MENU:
Only quote these items and exact prices. Never invent unavailable items.
${catalogText}

PRICING POLICY:
- Bulk discount: ${policy.bulk_discount_pct || 10}% off for ${policy.bulk_min_qty || 20}+ items
- Max regular discount: ${policy.max_discount_pct_no_bulk || 5}%
- Delivery fee: NGN ${(policy.delivery_fee || 1500).toLocaleString()}
- Pickup: ${policy.pickup_available ? 'Available' : 'Not available'}
- Negotiation: Friendly and flexible within the rules. Escalate only when the requested discount is too much.
${policy.notes ? `- Notes: ${policy.notes}` : ''}

CURRENT ORDER DRAFT:
${cartItems.length > 0 ? cartItems.map(i => `- ${i.qty} x ${i.name} = NGN ${(i.qty * i.unit_price).toLocaleString()}`).join('\n') : 'No items yet'}
${orderDraft.subtotal ? `Subtotal: NGN ${orderDraft.subtotal.toLocaleString()}` : ''}

BUSINESS INFORMATION:
- Store location: ${business.address || 'Contact owner for address'}
- Operating hours: ${business.operating_hours || 'Contact owner for hours'}
- Contact: ${business.owner_whatsapp_number || 'Via this chat'}

CONVERSATION STAGE: ${convo.stage || 'greeting'}
${convo.is_test ? 'NOTE: This is a TEST conversation. No real payments or fulfillment.' : ''}

GENERAL QUESTIONS HANDLING:
- If asked about delivery fees: "Our delivery fee is NGN ${(policy.delivery_fee || 1500).toLocaleString()}, but pickup is free."
- If asked about store location: "We're located at ${business.address || 'contact the owner for exact location'}. You can also choose delivery to your location."
- If asked about store operation: "We're currently open and serving customers. Our operating hours are ${business.operating_hours || 'contact owner for hours'}."
- If asked about store offerings: "We offer ${business.description || 'quality products'} with fast delivery and excellent service."
- If asked about weather, day, or casual topics: Respond naturally and friendly, keeping it relevant to the business context.
- For questions about how the day is going: "Thank you for asking! The day is going great, and we have fresh items ready for you. How can I assist you today?"
- For general chitchat: Be friendly and warm, but gently guide back to shopping when appropriate.

RULES:
- If asked for something not on the menu, say you do not have it and suggest the closest available item.
- If the customer clearly gives item names and quantities, call finalize_quote. Do not wait for "CONFIRM" before creating the quote.
- If delivery is requested but address is missing, ask naturally for the address.
- If the customer wants a discount, call propose_discount with a realistic amount.
- If they ask to see an item, call send_image.
- If they want to browse, call show_menu_list or mention a small set of relevant options.
- Never output fake payment links or fake order numbers. Code handles payment and final confirmation.
- End with a gentle next step like "Want me to add that?", "Should I make it pickup or delivery?", or "Does that work for you?"`;
}

export function buildOnboardingPrompt(dashboardUrl, setupToken) {
    return `You are a friendly onboarding assistant helping a business owner set up their AI sales assistant on WhatsApp.

Collect only these three things, one at a time:
1. Business name
2. What they sell
3. Pricing flexibility: strict, moderate, or flexible

Keep replies warm and brief. If they answer in Pidgin or mixed English, reply in a similar style.

For casual conversation during onboarding (like asking how the day is going), respond warmly but gently guide back to the onboarding process.

After collecting all three, say:
"Great, almost done!

Complete your setup here: ${dashboardUrl}/setup?token=${setupToken}

There you can add your menu, prices, photos, and discount rules. Once done, you will get a unique code to share with customers."`;
}

export async function chatWithAI({ systemPrompt, messages, tools, model = REASONING_MODEL }) {
    try {
        const params = {
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                ...messages
            ],
            temperature: 0.65,
            max_tokens: 240,
        };

        if (tools?.length) {
            params.tools = tools;
            params.tool_choice = 'auto';
        }

        const response = await qwen.chat.completions.create(params);
        return response.choices[0];
    } catch (err) {
        console.error('[AI] chatWithAI error:', err.message);
        if (err.message?.includes('invalid_api_key')) {
            throw new Error('Dashscope API key is invalid or missing. Check your DASHSCOPE_API_KEY.');
        }
        throw err;
    }
}

export async function classifyIntent(text) {
    const lower = (text || '').trim().toLowerCase();
    if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(lower)) return 'greeting';
    if (/^(sell|seller|setup|set up)\b/.test(lower)) return 'sell';
    if (/^(switch|change seller|new seller)\b/.test(lower)) return 'switch';
    if (/^[a-z]{2,}\d{2,}$/i.test(lower.replace(/\s/g, ''))) return 'code';
    if (/(menu|price|order|buy|deliver|pickup|food|catalog|available|how much)/.test(lower)) return 'shop';

    try {
        const response = await qwen.chat.completions.create({
            model: REASONING_MODEL,
            messages: [
                {
                    role: 'system',
                    content: 'Classify the user intent as one word: shop, sell, switch, help, code, greeting, or unknown. Return only the category.'
                },
                { role: 'user', content: text }
            ],
            temperature: 0,
            max_tokens: 8,
        });
        return response.choices[0].message.content.trim().toLowerCase();
    } catch (err) {
        console.error('[AI] classifyIntent error:', err.message);
        return 'unknown';
    }
}

export async function simpleReply(systemPrompt, userText) {
    try {
        const response = await qwen.chat.completions.create({
            model: REASONING_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userText }
            ],
            temperature: 0.75,
            max_tokens: 220,
        });
        return response.choices[0].message.content;
    } catch (err) {
        console.error('[AI] simpleReply error:', err.message);
        return "Sorry, I am having a little trouble right now. Can you try again in a moment?";
    }
}
