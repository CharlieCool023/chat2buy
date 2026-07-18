import OpenAI from 'openai';
import crypto from 'crypto';

const AI_API_KEY = process.env.DASHSCOPE_API_KEY;
const AI_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

if (!AI_API_KEY) {
    console.warn('[AI] Warning: No Dashscope API key configured. Set DASHSCOPE_API_KEY.');
}
console.log('[AI] provider: dashscope', 'model:', process.env.AI_MODEL || 'qwen3-235b-a22b-instruct-2507', 'baseURL:', AI_BASE_URL);

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_LOCATION = process.env.WEATHER_LOCATION;

const aiClient = new OpenAI({
    apiKey: AI_API_KEY,
    baseURL: AI_BASE_URL,
});

const REASONING_MODEL = process.env.AI_MODEL || 'qwen3-235b-a22b-instruct-2507';
const ENABLE_MODEL_THINKING = process.env.AI_ENABLE_THINKING === 'true';

function inferBusinessMode(business = {}, catalog = []) {
    const text = `${business.category || ''} ${business.description || ''} ${catalog.map(i => `${i.name} ${i.category}`).join(' ')}`.toLowerCase();
    if (/(tailor|fashion designer|sew|sewing|alteration|dress|gown|agbada|kaftan|suit|measurements?)/.test(text)) return 'tailoring';
    if (/(food|restaurant|kitchen|rice|soup|drink|catering|chops)/.test(text)) return 'food';
    if (/(shoe|bag|clothes|wear|boutique|fashion|thrift)/.test(text)) return 'fashion_retail';
    if (/(phone|laptop|electronic|gadget|accessor)/.test(text)) return 'electronics';
    if (/(salon|beauty|makeup|hair|spa|nail)/.test(text)) return 'beauty_service';
    return 'general';
}

function buildCategoryGuidance(mode, business = {}) {
    const store = business.name || 'the store';
    const common = `Always introduce yourself as a salesperson for ${store}, not as an AI. If the customer goes off-topic, answer briefly like a human and gently bring the chat back to what they need from ${store}.`;

    const guidance = {
        tailoring: `Tailoring mode:
- Customers may ask for sewing, alterations, fabric sourcing, designs, delivery dates, or measurement help.
- If they ask "can you buy the material?" explain that ${store} can either work with their fabric or help source suitable material if the owner offers it; ask budget, fabric type, color, event date, and style reference.
- If measurements are needed, ask for gender/body style only when useful, then request the right measurements: shoulder, bust/chest, waist, hip, sleeve, length, trouser waist, thigh, inseam as needed.
- If the customer says the tailor already has their measurement, ask for the name the tailor knows them by and attach it to the order note.
- For custom work, do not invent a fixed price unless it is in the catalog. Create a clear quote request and use the human checkpoint when the owner must price it.`,
        food: `Food/vendor mode:
- Help customers choose by hunger level, budget, quantity, delivery timing, and event size.
- Mention freshness, portion size, packaging, and delivery practicality when persuading.
- For bulk or event orders, collect date, time, delivery/pickup, guest count, and budget before final quote.`,
        fashion_retail: `Fashion retail mode:
- Help with size, color, fit, occasion, quality, authenticity, and available alternatives.
- If price is challenged, defend value politely: quality, durability, originality, finish, and limited stock.
- Do not push a cheaper item immediately; first explain why the selected item is worth it, then offer alternatives only if budget is truly tight.`,
        electronics: `Electronics mode:
- Ask about device model, compatibility, warranty, condition, budget, and urgency.
- Be precise about specs already in the catalog and avoid inventing warranty or technical claims.
- If the customer needs support or repair details, collect the device model and issue, then escalate for owner review.`,
        beauty_service: `Beauty/service mode:
- Ask for appointment date/time, style reference, service type, location, and any constraints.
- Recommend options based on event, hair/skin type, budget, and timeline.
- Escalate custom pricing, allergic reactions, or urgent special handling.`,
        general: `General commerce mode:
- Discover the buyer's goal, budget, quantity, delivery preference, and urgency.
- Recommend from the catalog first. For custom or unclear requests, collect enough detail and use the human checkpoint.`
    };

    return `${common}\n${guidance[mode] || guidance.general}`;
}

export async function getExternalContext(business = {}) {
    const now = new Date();
    const localDate = now.toLocaleDateString('en-NG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    const localTime = now.toLocaleTimeString('en-NG', {
        hour: '2-digit',
        minute: '2-digit'
    });
    const location = business.address || WEATHER_LOCATION || 'Lagos, Nigeria';
    let weather = 'Weather details are not available right now.';

    if (WEATHER_API_KEY) {
        try {
            const locationQuery = encodeURIComponent(WEATHER_LOCATION || business.address || 'Lagos, NG');
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${locationQuery}&units=metric&appid=${WEATHER_API_KEY}`;
            const resp = await fetch(url);
            if (resp.ok) {
                const data = await resp.json();
                const temp = Math.round(data.main?.temp ?? 0);
                const desc = data.weather?.[0]?.description || 'clear skies';
                weather = `${desc}, about ${temp}°C`;
            }
        } catch (err) {
            console.error('[AI] getExternalContext weather fetch failed:', err.message);
        }
    }

    return {
        localDate,
        localTime,
        weather,
        location
    };
}

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
    },
    {
        type: 'function',
        function: {
            name: 'request_human_checkpoint',
            description: 'Ask the store owner to review a custom request, unusual discount, complex sizing, unavailable item, or anything that needs human approval.',
            parameters: {
                type: 'object',
                properties: {
                    reason: { type: 'string', description: 'Why a human should review this' },
                    customer_summary: { type: 'string', description: 'Short summary of what the customer wants' },
                    collected_details: { type: 'string', description: 'Useful details already collected' },
                    suggested_next_step: { type: 'string', description: 'What the owner should do next' }
                },
                required: ['reason', 'customer_summary']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'switch_to_store',
            description: 'Switch the customer to shop with a different store using the store code.',
            parameters: {
                type: 'object',
                properties: {
                    store_code: { type: 'string', description: 'The unique code of the store to switch to (e.g., S3E2A)' }
                },
                required: ['store_code']
            }
        }
    }
];

export function buildCustomerPrompt(business, catalog, policy, convo, externalContext = {}, previousSellers = []) {
    const catalogText = catalog.map(item =>
        `- ${item.name}: NGN ${Number(item.price).toLocaleString()} (${item.category})\n  ${item.description || 'No description'}`
    ).join('\n');

    const orderDraft = convo.context?.order || {};
    const cartItems = orderDraft.items || [];
    const localDate = externalContext.localDate || new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const localTime = externalContext.localTime || new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
    const weather = externalContext.weather || 'No weather details available right now';
    const locationHint = business.address || externalContext.location || 'your area';

    const businessMode = inferBusinessMode(business, catalog);
    const categoryGuidance = buildCategoryGuidance(businessMode, business);

    const previousSellersText = previousSellers.length > 0
        ? previousSellers.map(s => `- ${s.business_name} (Code: ${s.code})`).join('\n')
        : 'None';

    return `You are Charlotte, the warm, friendly, award-winning salesperson for ${business.name}. ${business.description || ''} You chat like a real, experienced WhatsApp sales rep: relaxed, persuasive, observant, and natural.

CONTEXT:
- Local time: ${localTime}
- Date: ${localDate}
- Weather: ${weather}
- Location: ${locationHint}
- Business category: ${business.category || businessMode}

PERSONALITY AND STYLE:
- Introduce yourself as "Charlotte" (the warm, friendly, award-winning sales assistant for ${business.name}) when greeted, when the customer asks who you are, or when beginning the conversation.
- Sound human, not scripted, with short sentences and a natural WhatsApp rhythm.
- Match the customer's tone. Casual customer gets a casual reply; formal customer gets a respectful reply.
- Light Nigerian English or Pidgin is welcome when it fits: "No wahala", "How far", "Sure", "I hear you".
- Use at most one emoji when it adds warmth. Do not force it.
- Keep most replies to 2-4 short sentences.
- Ask one clear next question at a time.
- Understand natural requests like "two jollof", "show me rice", "I want to sew a dress", "can you deliver", "any cheaper one", "I want to pay".
- When the buyer is unsure, recommend the best value item and explain why it is a good choice.
- If the buyer complains about price, first defend the value naturally: quality, portion/finish, durability, convenience. Do not jump straight to a cheaper option.
- If the buyer has less money, negotiate within policy, bundle intelligently, or explain what can be adjusted without making the store look desperate.

BUSINESS-SPECIFIC SALES PLAYBOOK:
${categoryGuidance}

CURRENT MENU:
${catalog.length ? `Only quote these items and exact prices. Never invent unavailable items.\n${catalogText}` : 'No fixed catalog is loaded yet. Treat customer requests as custom inquiries, collect details, and use request_human_checkpoint when pricing or owner approval is needed.'}

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

PREVIOUS STORES SHOPPED WITH:
${previousSellersText}

CONVERSATION STAGE: ${convo.stage || 'greeting'}
${convo.is_test ? 'NOTE: This is a TEST conversation. No real payments or fulfillment.' : ''}

RULES:
- If asked for something not on the menu, say you do not have it and suggest the closest available item.
- If the customer clearly gives item names and quantities, call finalize_quote. Do not wait for "CONFIRM" before creating the quote.
- If delivery is requested but address is missing, ask naturally for the address.
- If the customer wants a discount, call propose_discount with a realistic amount.
- If they ask to see an item, call send_image.
- If they want to browse, call show_menu_list or mention a small set of relevant options.
- If the request is custom, ambiguous, high-value, risky, outside catalog, or needs owner pricing, call request_human_checkpoint after collecting the key details.
- If they ask for time or weather, answer using the local context above and keep it friendly.
- If they ask which stores they have shopped with, want their codes, or want to switch stores, tell them the store names and codes from the PREVIOUS STORES SHOPPED WITH section.
- If they ask to switch to one of these stores or to a store code, call the switch_to_store tool with the correct store code.
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
    const params = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            ...messages
        ],
        temperature: 0.65,
        max_tokens: 280,
    };

    if (!ENABLE_MODEL_THINKING) {
        params.extra_body = { enable_thinking: false };
    }

    if (tools?.length) {
        params.tools = tools;
        params.tool_choice = 'auto';
    }

    try {
        const response = await aiClient.chat.completions.create(params);
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
    if (/^(sell|seller|setup|set up|become a seller)\b/.test(lower)) return 'sell';
    if (/^(switch|change seller|new seller|different store|another seller)\b/.test(lower)) return 'switch';
    if (/^[a-z]{2,}\d{2,}$/i.test(lower.replace(/\s/g, ''))) return 'code';
    if (/(menu|price|order|buy|deliver|pickup|food|catalog|available|how much)/.test(lower)) return 'shop';

    try {
        const response = await aiClient.chat.completions.create({
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
            extra_body: { enable_thinking: false },
        });
        return response.choices[0].message.content.trim().toLowerCase();
    } catch (err) {
        console.error('[AI] classifyIntent error:', err.message);
        return 'unknown';
    }
}

export async function simpleReply(systemPrompt, userText) {
    try {
        const response = await aiClient.chat.completions.create({
            model: REASONING_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userText }
            ],
            temperature: 0.75,
            max_tokens: 220,
            extra_body: { enable_thinking: false },
        });
        return response.choices[0].message.content;
    } catch (err) {
        console.error('[AI] simpleReply error:', err.message);
        return "Sorry, I am having a little trouble right now. Can you try again in a moment?";
    }
}
