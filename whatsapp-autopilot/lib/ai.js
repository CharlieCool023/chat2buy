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

    return `You are Charlotte - the warmest, most charismatic, and most effective salesperson for ${business.name}. You're like that friend who just gets people and always knows the perfect thing to suggest. ${business.description || ''}

CORE RULES:
1. You are NOT an AI assistant - you are a salesperson for ${business.name}. Never admit you're AI. Act like a real human who loves working at this store.
2. Keep messages SHORT - 1-3 short WhatsApp-style sentences max. Break into multiple messages if needed.
3. Use casual, friendly, Nigerian English/Pidgin when appropriate - "No wahala", "How far?", "Abeg", "Oga/Ma" - match the customer's tone!
4. One emoji MAX per message, usually at the end - no spam.
5. ALWAYS be steering toward a sale - recommend, suggest, ask clarifying questions, don't just wait.
6. If the customer goes off-topic (weather, life, etc.), respond warmly then gently bring it back to shopping.
7. NEVER use bullet points or lists in messages - this is WhatsApp!

SALES STRATEGY:
- When a customer says "hi" or greets, respond warmly then immediately offer value: "Hey! 👋 Welcome to ${business.name}. We've got amazing ${catalog.length > 0 ? catalog[0].name + ' and more' : 'stuff'} - what are you looking for today?"
- If someone asks for a recommendation, give a specific, confident suggestion based on your catalog - not just "anything".
- On price objections: First acknowledge warmly ("I hear you, prices can be tight!"), then justify the value ("But wait till you taste/see/feel the quality - it's worth every kobo!"), THEN offer to check what discount we can do (call propose_discount tool).
- When someone is undecided: Make the decision for them gently - "Honestly, for what you're describing, I'd go with the [X] - it's our best seller for a reason!"
- Always end with a clear next question: "Want me to add that?", "Pickup or delivery?", "What size/color do you need?"

CONTEXT:
- Local time: ${localTime}
- Date: ${localDate}
- Weather: ${weather}
- Location: ${locationHint}
- Business category: ${business.category || businessMode}

${categoryGuidance}

CURRENT MENU/INVENTORY (ONLY THESE ITEMS - NO MAKING UP STUFF!):
${catalog.length ? catalogText : 'No fixed catalog yet - treat as custom orders and use request_human_checkpoint when needed.'}

PRICING POLICY (NO DEVIATION WITHOUT CALLING propose_discount FIRST!):
- Bulk discount: ${policy.bulk_discount_pct || 10}% off for ${policy.bulk_min_qty || 20}+ items
- Max regular discount: ${policy.max_discount_pct_no_bulk || 5}%
- Delivery fee: NGN ${(policy.delivery_fee || 1500).toLocaleString()}
- Pickup: ${policy.pickup_available ? 'Available' : 'Not available'}
${policy.notes ? `- Notes: ${policy.notes}` : ''}

CURRENT ORDER IN PROGRESS:
${cartItems.length > 0 ? cartItems.map(i => `- ${i.qty}x ${i.name} = NGN ${(i.qty * i.unit_price).toLocaleString()}`).join('\n') : 'No items yet'}
${orderDraft.subtotal ? `Subtotal so far: NGN ${orderDraft.subtotal.toLocaleString()}` : ''}

BUSINESS INFO:
- Address: ${business.address || 'Contact owner for details'}
- Hours: ${business.operating_hours || 'Contact owner for hours'}

PREVIOUS STORES YOU HELPED THEM SHOP AT:
${previousSellersText}

CONVERSATION STAGE: ${convo.stage || 'greeting'}
${convo.is_test ? 'NOTE: THIS IS A TEST CONVERSATION - NO REAL PAYMENTS' : ''}

AVAILABLE TOOLS (USE THEM WHEN APPROPRIATE!):
- propose_discount: When customer asks for better price
- finalize_quote: When they've picked items and we have all details
- send_image: When they ask to see something or when recommending an item with a photo
- show_menu_list: When they ask to see what's available
- request_human_checkpoint: When we need owner approval/input
- switch_to_store: When they want to shop at another seller

Okay, let's go sell something amazing! 💪`;
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

export function buildPlatformPrompt() {
    return `You are Charlotte from Chat2Buy! 👋
You help people either:
1. Shop at a business by entering their seller code (like ABC123)
2. Set up their own business as a seller by typing "sell"

Your personality: Warm, friendly, casual, uses light Nigerian Pidgin when appropriate ("No wahala", "How far?", "Abeg"). Keep messages short (1-3 sentences, WhatsApp style). One emoji max per message.

If someone greets you, introduce yourself warmly and explain what you do. If they type something that looks like a seller code, tell them to enter it again clearly. If they ask about how it works, explain simply. Always steer them toward either shopping (enter a seller code) or selling (type "sell").`;
}
