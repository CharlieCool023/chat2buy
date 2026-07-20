import express from 'express';
import * as db from '../lib/db.js';
import * as wa from '../lib/whatsapp.js';
import * as ai from '../lib/ai.js';
import * as nego from '../lib/negotiation.js';
import * as paystack from '../lib/paystack.js';

const router = express.Router();
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const NGROK_URL = process.env.NGROK_URL || 'http://localhost:3000';
const APP_PUBLIC_URL = getPublicAppUrl();
const escalationBuffer = new Map();

const PLATFORM_INTRO = `Hi, I am *Charlotte* from *Chat2Buy*!

I can help you shop from businesses on WhatsApp, or set up your own AI sales assistant if you sell something.

If you have a seller code, send it here. If you want to create your own store, type *SELL*.`;

function getPublicAppUrl() {
    const candidates = [
        process.env.APP_PUBLIC_URL,
        process.env.DASHBOARD_URL,
        process.env.NGROK_URL,
        process.env.PUBLIC_URL,
        'http://localhost:3000'
    ];

    for (const candidate of candidates) {
        const clean = normalizePublicUrl(candidate);
        if (clean) return clean;
    }

    return 'http://localhost:3000';
}

function normalizePublicUrl(value = '') {
    let url = String(value || '').trim();
    if (!url) return '';

    const protocolIndex = url.search(/https?:\/\//i);
    if (protocolIndex > 0) url = url.slice(protocolIndex);
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    try {
        const parsed = new URL(url);
        parsed.hash = '';
        parsed.search = '';
        parsed.pathname = parsed.pathname.replace(/\/dashboard\/?$/i, '').replace(/\/+$/, '');
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return '';
    }
}

router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('[Webhook] Verified by Meta');
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

router.post('/dev/simulate', express.json(), async (req, res) => {
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEV_SIMULATOR !== 'true') {
        return res.status(404).json({ error: 'Not found' });
    }

    const from = req.body.from || '2348000000000';
    const text = req.body.text || '';

    try {
        const ownerBusiness = await db.getBusinessByOwner(from);
        if (ownerBusiness) {
            await handleSellerMessage(from, text, ownerBusiness);
        } else {
            const binding = await db.getCustomerBinding(from);
            if (binding) {
                await handleCustomerMessage(from, text, binding);
            } else {
                await handleNewCustomer(from, text);
            }
        }

        res.json({
            ok: true,
            from,
            text,
            replies: process.env.WHATSAPP_DRY_RUN === 'true' ? wa.drainDryRunOutbox(from) : undefined,
            note: process.env.WHATSAPP_DRY_RUN === 'true'
                ? 'Reply was printed in the server terminal by WHATSAPP_DRY_RUN.'
                : 'Simulation processed. Set WHATSAPP_DRY_RUN=true to avoid sending real WhatsApp messages.'
        });
    } catch (err) {
        console.error('[Dev simulate] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/webhook', express.json(), async (req, res) => {
    res.sendStatus(200);

    try {
        const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!message) return;

        const from = message.from;
        const text = extractMessageText(message);
        const msgId = message.id;

        console.log(`[Webhook] From ${from}: "${text.substring(0, 80)}"`);
        wa.markAsRead(msgId);

        if (escalationBuffer.has(from)) {
            await handleEscalationReply(from, text);
            return;
        }

        const ownerBusiness = await db.getBusinessByOwner(from);
        if (ownerBusiness) {
            await handleSellerMessage(from, text, ownerBusiness);
            return;
        }

        const binding = await db.getCustomerBinding(from);
        if (!binding) {
            await handleNewCustomer(from, text);
            return;
        }

        const lower = text.trim().toLowerCase();
        
        // Handle session switching for multi-vendor capability
        if (/(new seller|different store|switch store|change vendor|shop elsewhere|shop somewhere else)/.test(lower)) {
            await wa.sendText(from, `You can now shop with a different seller. Enter another seller code to switch, or type SELL to set up your own store.`);
            return;
        }

        if (lower.includes('switch') || lower === 'new') {
            await wa.sendText(from, 'Sure. Enter another seller code, or type SELL to set up your own store.');
            return;
        }

        await handleCustomerMessage(from, text, binding);
    } catch (err) {
        console.error('[Webhook] Error:', err);
    }
});

async function handleSellerMessage(from, text, business) {
    const lower = text.trim().toLowerCase();
    const sellerConvo = await db.getConversation(business.id, from);
    const ctx = sellerConvo.context || {};

    if (ctx.stage === 'awaiting_other_seller_code') {
        await handleSellerSwitchCode(from, text, business, sellerConvo);
        return;
    }

    if (/(buy from another seller|shop elsewhere|different seller|another store|other seller|want another store|buy from another store)/i.test(lower)) {
        ctx.stage = 'awaiting_other_seller_code';
        await db.updateConversation(business.id, from, { context: ctx, stage: 'awaiting_other_seller_code' });
        await wa.sendText(from, 'No wahala. Send the seller code for the store you want to buy from and I will help you switch over.');
        return;
    }

    // Handle casual conversation for sellers
    if (/^(how.*day|how.*going|how.*are.*you|how.*doing|how.*far)$/i.test(lower)) {
        await wa.sendText(from, `Thank you for asking! ${business.name} is going well. How can I assist you today?`);
        return;
    }

    if (/(weather|rain|sun|hot|cold|climate|temperature)/.test(lower)) {
        await wa.sendText(from, `I don't have real-time weather info, but I hope it's treating you well! How is the weather affecting your business today?`);
        return;
    }

    if (
        lower === 'token' ||
        lower.includes('setup token') ||
        lower.includes('dashboard token') ||
        lower.includes('setup link') ||
        lower.includes('dashboard link') ||
        lower.includes('remind me of my token') ||
        lower.includes('access the link') ||
        lower.includes('open the link')
    ) {
        await wa.sendText(from, buildSellerCredentialReminder(business));
        return;
    }

    if (
        lower === 'code' ||
        lower.includes('seller code') ||
        lower.includes('sales code') ||
        lower.includes('store code')
    ) {
        await wa.sendText(from, `Your seller code is *${business.code}*. Share it with customers so they can shop from ${business.name}.\n\nIf you need your dashboard token too, type TOKEN.`);
        return;
    }

    const analyticsReply = await buildSellerAnalyticsReply(lower, business);
    if (analyticsReply) {
        await wa.sendText(from, analyticsReply);
        return;
    }

    if (lower === 'test') {
        await db.updateConversation(business.id, from, {
            stage: 'greeting',
            context: { is_test: true },
            is_test: true
        });
        
        try {
            const reply = await ai.simpleReply(
                `You are Charlotte! You just turned on Test Mode for the seller!
                Keep it friendly and excited!
                Tell them Test Mode is ON!
                Tell them you'll respond like a real customer!
                Give them ideas: try "hi" or "what do you have?"
                Tell them to type STOP to end test mode!
                Keep it short! 1 emoji max!`,
                ''
            );
            await wa.sendText(from, reply);
        } catch (err) {
            await wa.sendText(from, '*Test Mode* is ON! I will respond like a real customer! Try "hi"! Type STOP to end!');
        }
        
        return;
    }

    if (sellerConvo.is_test && lower === 'stop') {
        await db.updateConversation(business.id, from, {
            stage: 'greeting',
            context: {},
            is_test: false
        });
        await wa.sendText(from, 'Test mode ended. Back to normal.');
        return;
    }

    if (business.status === 'pending_setup' || lower.includes('setup') || lower.includes('sell')) {
        await handleSellerOnboarding(from, text, business);
        return;
    }

    if (sellerConvo.is_test) {
        await handleCustomerMessage(from, text, {
            business_id: business.id,
            code: business.code,
            name: business.name
        });
        return;
    }

    try {
        const reply = await ai.simpleReply(
            `You are Charlotte, chatting with the business owner of ${business.name} (seller code: ${business.code})!
            The store is live!
            Keep it friendly, casual (light Nigerian Pidgin allowed).
            Give a warm welcome!
            Tell them they can ask about orders, analytics, etc.
            Remind them they can type TEST to try the customer flow!
            Keep it short! 1 emoji max!`,
            ''
        );
        await wa.sendText(from, reply);
    } catch (err) {
        await wa.sendText(from, `Hi boss! ${business.name} is live! Type TEST to try the customer flow! Your seller code is *${business.code}*!`);
    }
}

async function handleSellerOnboarding(from, text, business) {
    const convo = await db.getConversation(business.id, from);
    const ctx = convo.context || {};
    const lower = text.trim().toLowerCase();

    if (!ctx.onboarding_step) {
        ctx.onboarding_step = 'ask_name';
        ctx.onboarding_data = {};
        await db.updateConversation(business.id, from, { context: ctx });
        
        try {
            const welcomeReply = await ai.simpleReply(
                `You are Charlotte, welcoming a new seller to Chat2Buy! 😊
                Keep it warm, friendly, casual (light Nigerian Pidgin allowed).
                Keep messages short (1-3 WhatsApp-style sentences, 1 emoji max).
                Then ask them for their business name.`,
                ''
            );
            await wa.sendText(from, welcomeReply);
        } catch (err) {
            console.error('[Onboarding AI error]', err);
            await wa.sendText(from, `Welcome to *Chat2Buy*. Nice move! What is your business name?`);
        }
        
        return;
    }

    if (isOnboardingCancel(lower)) {
        await db.updateConversation(business.id, from, { context: {}, stage: 'greeting' });
        await wa.sendText(from, `No problem, I have paused the setup.

When you are ready, type *SELL* or *SETUP* and I will continue from the beginning. If you already have a store, you can ask me for your seller code or dashboard token.`);
        return;
    }

    if (isOnboardingHelp(lower)) {
        await wa.sendText(from, buildOnboardingHelp(ctx.onboarding_step));
        return;
    }

    if (lower === 'back') {
        rewindOnboardingStep(ctx);
        await db.updateConversation(business.id, from, { context: ctx });
        await wa.sendText(from, buildOnboardingStepPrompt(ctx));
        return;
    }

    const data = ctx.onboarding_data;
    if (ctx.onboarding_step === 'ask_name') {
        const processedName = text.trim();
        if (!isLikelyBusinessName(text)) {
            try {
                const prompt = `You're Charlotte helping a new seller! They didn't give a valid business name. Ask them again nicely for the business name (the one customers know them by), in a friendly way! Keep it short!`;
                const reply = await ai.simpleReply(prompt, text);
                await wa.sendText(from, reply);
            } catch (err) {
                await wa.sendText(from, `Please give me your actual business name, like "Charlie the Tailor"!`);
            }
            return;
        }

        data.name = processedName;
        ctx.onboarding_step = 'ask_description';
        await db.updateConversation(business.id, from, { context: ctx });
        
        try {
            const reply = await ai.simpleReply(ai.buildSellerOnboardingPrompt('ask_description', data, business), text);
            await wa.sendText(from, reply);
        } catch (err) {
            await wa.sendText(from, `Nice! *${data.name}*! What do you sell or what service do you offer?`);
        }
        
        return;
    }

    if (ctx.onboarding_step === 'ask_description') {
        const description = cleanBusinessDescription(text);
        if (!isUsefulBusinessDescription(description)) {
            try {
                const prompt = `You're Charlotte helping a new seller! Their answer about what they sell isn't clear. Ask them again nicely for what they actually sell/offer, give examples like "tailor", "food", "clothes"! Keep it short!`;
                const reply = await ai.simpleReply(prompt, text);
                await wa.sendText(from, reply);
            } catch (err) {
                await wa.sendText(from, `Please tell me what you actually sell or offer! Like "tailor" or "food"!`);
            }
            return;
        }

        data.description = description;
        data.category = inferOnboardingCategory(description);
        ctx.onboarding_step = 'ask_flexibility';
        await db.updateConversation(business.id, from, { context: ctx });
        
        try {
            const reply = await ai.simpleReply(ai.buildSellerOnboardingPrompt('ask_flexibility', data, business), text);
            await wa.sendText(from, reply);
            await wa.sendQuickReplies(from, 'Quick options:', [
                { title: 'Strict' },
                { title: 'Moderate' },
                { title: 'Flexible' }
            ]);
        } catch (err) {
            await wa.sendText(from, `Got it! Now, how flexible should pricing be? Strict / Moderate / Flexible?`);
            await wa.sendQuickReplies(from, 'Quick options:', [
                { title: 'Strict' },
                { title: 'Moderate' },
                { title: 'Flexible' }
            ]);
        }
        
        return;
    }

    if (ctx.onboarding_step === 'ask_category') {
        data.category = text.trim() || 'General';
        ctx.onboarding_step = 'ask_flexibility';
        await db.updateConversation(business.id, from, { context: ctx });
        await wa.sendQuickReplies(from, 'How flexible should pricing be for customers?', [
            { title: 'Strict' },
            { title: 'Moderate' },
            { title: 'Flexible' }
        ]);
        return;
    }

    const flex = text.toLowerCase();
    if (!/(strict|moderate|flexible)/.test(flex)) {
        try {
            const reply = await ai.simpleReply(
                `You're Charlotte helping a new seller! They didn't pick one of the 3 options: Strict, Moderate, Flexible. Ask them again clearly to choose one of those 3! Keep it friendly and short!`,
                text
            );
            await wa.sendText(from, reply);
            await wa.sendQuickReplies(from, 'Quick options:', [
                { title: 'Strict' },
                { title: 'Moderate' },
                { title: 'Flexible' }
            ]);
        } catch (err) {
            await wa.sendText(from, `Please choose: Strict, Moderate, or Flexible!`);
            await wa.sendQuickReplies(from, 'Quick options:', [
                { title: 'Strict' },
                { title: 'Moderate' },
                { title: 'Flexible' }
            ]);
        }
        return;
    }

    let maxDiscount = 3;
    let bulkDiscount = 10;
    let flexLabel = 'moderate';
    if (flex.includes('flexible')) {
        maxDiscount = 5;
        bulkDiscount = 12;
        flexLabel = 'flexible';
    } else if (flex.includes('strict')) {
        maxDiscount = 2;
        bulkDiscount = 7;
        flexLabel = 'strict';
    }

    await db.updateBusiness(business.id, {
        name: data.name,
        description: data.description,
        category: data.category,
        status: 'pending_setup'
    });

    await db.updatePolicy(business.id, {
        bulkMinQty: 20,
        bulkDiscountPct: bulkDiscount,
        maxDiscountPct: maxDiscount,
        deliveryFee: 1500,
        pickupAvailable: true,
        notes: `Pricing flexibility: ${flexLabel}`
    });

    const updated = await db.getBusinessById(business.id);
    ctx.onboarding_step = null;
    ctx.onboarding_data = null;
    await db.updateConversation(business.id, from, { context: ctx });

    const dashboardUrl = `${APP_PUBLIC_URL}/dashboard/setup?token=${updated.setup_token}&biz=${updated.id}`;
    try {
        const finalReply = await ai.simpleReply(
            `You are Charlotte! The seller just finished the initial setup! Congratulate them warmly!
            Tell them their seller code: ${updated.code}
            Give them the dashboard link: ${dashboardUrl}
            Tell them to finish setup there and come say hi when done!
            Keep it short, friendly, casual! 1 emoji max!`,
            ''
        );
        await wa.sendText(from, finalReply);
    } catch (err) {
        await wa.sendText(from,
            `Great! *${updated.name}* is ready! Your seller code is *${updated.code}*! Finish setup here: ${dashboardUrl}. Come say hi when done!`
        );
    }
}

function buildSellerCredentialReminder(business) {
    const baseUrl = process.env.DASHBOARD_URL || `${APP_PUBLIC_URL}/dashboard`;
    const setupUrl = `${baseUrl.replace(/\/$/, '')}/setup?token=${business.setup_token}&biz=${business.id}`;

    return `Here are your ${business.name} details:\n\n` +
        `Seller code: *${business.code}*\n` +
        `Dashboard token: *${business.setup_token}*\n` +
        `Setup link: ${setupUrl}\n\n` +
        `Tap the setup link to open your dashboard. If WhatsApp does not open it, copy the full link into Chrome or Safari.

Share only the seller code with customers. Keep the dashboard token private.`;
}

function isOnboardingCancel(lower = '') {
    return /^(cancel|stop|quit|exit|pause|not now|never mind|nevermind|forget it|start over|restart)$/i.test(lower) ||
        /\b(cancel|stop setup|pause setup|quit setup|not now)\b/i.test(lower);
}

function isOnboardingHelp(lower = '') {
    return /^(help|what now|what should i do|how does this work|explain)$/i.test(lower);
}

function isLikelyBusinessName(text = '') {
    const value = text.trim();
    if (value.length < 2 || value.length > 80) return false;
    if (isOnboardingCancel(value.toLowerCase()) || isOnboardingHelp(value.toLowerCase())) return false;
    if (/^(hi|hello|hey|yes|no|ok|okay|thanks?|thank you|sell|setup)$/i.test(value)) return false;
    return /[a-z0-9]/i.test(value);
}

function isUsefulBusinessDescription(text = '') {
    const value = text.trim();
    if (value.length < 3 || value.length > 180) return false;
    if (isOnboardingCancel(value.toLowerCase()) || isOnboardingHelp(value.toLowerCase())) return false;
    if (/^(yes|no|ok|okay|same|business|store|shop)$/i.test(value)) return false;
    return /[a-z]/i.test(value);
}

function rewindOnboardingStep(ctx) {
    if (ctx.onboarding_step === 'ask_description') {
        ctx.onboarding_step = 'ask_name';
        delete ctx.onboarding_data?.name;
    } else if (ctx.onboarding_step === 'ask_category' || ctx.onboarding_step === 'ask_flexibility') {
        ctx.onboarding_step = 'ask_description';
        delete ctx.onboarding_data?.description;
        delete ctx.onboarding_data?.category;
    } else {
        ctx.onboarding_step = 'ask_name';
        ctx.onboarding_data = {};
    }
}

function buildOnboardingStepPrompt(ctx = {}) {
    const data = ctx.onboarding_data || {};
    if (ctx.onboarding_step === 'ask_name') return 'Sure, let us take that again. What is your business name?';
    if (ctx.onboarding_step === 'ask_description') {
        return `No problem. What does *${data.name || 'your business'}* sell or what service do you offer?`;
    }
    return 'How flexible should pricing be with customers: Strict, Moderate, or Flexible?';
}

function buildOnboardingHelp(step) {
    if (step === 'ask_name') {
        return `I am setting up your Chat2Buy store.

Send your business name, the way customers know it. Example: "Charlie the Tailor".`;
    }
    if (step === 'ask_description') {
        return `Tell me what you sell or the service you offer.

You can answer naturally, like "I am a tailor", "we sell shoes and bags", or "we cook party food".`;
    }
    return `Choose how Charlotte should negotiate:

*Strict* for firm prices, *Moderate* for balanced offers, or *Flexible* when you want more room to close sales.`;
}

function cleanBusinessDescription(text = '') {
    return text
        .trim()
        .replace(/^i\s*(am|'m)\s+(a|an)\s+/i, '')
        .replace(/^we\s+(are|sell|make|do)\s+/i, '')
        .replace(/^i\s+(sell|make|do|sew)\s+/i, '')
        .trim() || text.trim();
}

function inferOnboardingCategory(text = '') {
    const lower = text.toLowerCase();
    if (/(tailor|sew|sewing|fashion designer|dress|gown|kaftan|agbada|alteration)/.test(lower)) return 'Tailoring';
    if (/(food|restaurant|rice|soup|catering|small chops|drink|kitchen)/.test(lower)) return 'Food';
    if (/(shoe|bag|clothes|boutique|wear|thrift|fashion)/.test(lower)) return 'Fashion retail';
    if (/(phone|laptop|electronics?|gadget|accessor)/.test(lower)) return 'Electronics';
    if (/(hair|makeup|beauty|salon|nail|spa)/.test(lower)) return 'Beauty';
    if (/(event|rental|decoration|planner|usher)/.test(lower)) return 'Events and rentals';
    if (/(consult|service|repair|cleaning|training|class)/.test(lower)) return 'Professional services';
    return 'General';
}

function isPlatformQuestion(lower = '') {
    return /(what.*(this|platform|about)|who.*you|what.*do.*you.*do|how.*does.*this.*work|chat2buy|explain)/.test(lower);
}

function looksLikeSellerCode(text = '') {
    const value = text.trim();
    if (!/^[a-z0-9]{4,12}$/i.test(value)) return false;
    if (/^(sell|help|hello|hi|hey|menu|price|order)$/i.test(value)) return false;
    return /[a-z]/i.test(value) && (/\d/.test(value) || value.length >= 5);
}

async function handleNewCustomer(from, text) {
    const lower = text.trim().toLowerCase();
    const code = text.trim().toUpperCase();
    const business = await db.getBusinessByCode(code);

    if (business) {
        await db.bindCustomerToBusiness(from, business.id);
        await db.getConversation(business.id, from);
        await wa.sendText(from, `Welcome to *${business.name}*! 👋\n\n${business.description || ''}`);
        return;
    }

    if (lower === 'sell' || lower.includes('set up') || lower.includes('become a seller')) {
        const newBiz = await db.createBusiness({
            name: 'New Business',
            owner_whatsapp_number: from,
            description: ''
        });
        await db.getConversation(newBiz.id, from);
        await handleSellerOnboarding(from, 'start', newBiz);
        return;
    }

    if (looksLikeSellerCode(text)) {
        await wa.sendText(from, `I could not find that seller code. Please recheck and send it again, or type *SELL* to set up your own store.`);
        return;
    }

    // Use AI for all other platform interactions
    try {
        const reply = await ai.simpleReply(ai.buildPlatformPrompt(), text);
        await wa.sendText(from, reply);
    } catch (err) {
        console.error('[Webhook] Platform AI error:', err);
        await wa.sendText(from, PLATFORM_INTRO);
    }
}

async function handleCustomerMessage(from, text, binding) {
    const businessId = binding.business_id;
    const business = await db.getBusinessById(businessId);
    const catalog = await db.getCatalog(businessId);
    const policy = await db.getPolicy(businessId) || {};
    const convo = await db.getConversation(businessId, from);
    const lower = text.trim().toLowerCase();
    const directCodeSwitch = await maybeSwitchCustomerByCode(from, text, businessId);
    if (directCodeSwitch) return;

    if (['confirm', 'yes confirm', 'go ahead', 'pay', 'send payment link', 'i want to pay'].includes(lower)) {
        if (convo.stage === 'confirming' || convo.stage === 'quoting') {
            await processOrderConfirmation(from, convo, business, policy);
        }
        return;
    }

    await db.touchCustomerBinding(from, businessId);

    const history = convo.history || [];
    const messages = [...history.slice(-4), { role: 'user', content: text }];
    const externalContext = await ai.getExternalContext(business);
    const previousSellers = await db.getCustomerBindings(from);
    const systemPrompt = ai.buildCustomerPrompt(business, catalog, policy, convo, externalContext, previousSellers);

    let aiMessage;
    try {
        const aiResponse = await ai.chatWithAI({ systemPrompt, messages, tools: ai.AGENT_TOOLS });
        aiMessage = aiResponse.message;
    } catch (err) {
        console.error('[Webhook] AI service unavailable:', err.message);
        await wa.sendText(from, 'No wahala boss - I am taking a quick rest. Come back in a few minutes and I will help you with that.');
        return;
    }

    if (aiMessage?.tool_calls?.length) {
        for (const toolCall of aiMessage.tool_calls) {
            const result = await handleToolCall(toolCall, { from, businessId, business, catalog, policy, convo });
            if (result?.reply) await wa.sendText(from, result.reply);
            if (result?.imageUrl) await wa.sendImage(from, result.imageUrl, result.imageCaption || '');
        }

        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: aiMessage.content || `[Used ${aiMessage.tool_calls.map(t => t.function.name).join(', ')}]` });
        await db.updateConversation(businessId, from, { history: history.slice(-10) });
        return;
    }

    if (aiMessage?.content) {
        await wa.sendText(from, aiMessage.content);
        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: aiMessage.content });
        await db.updateConversation(businessId, from, { history: history.slice(-10) });
    }
}

async function tryFastCustomerReply({ from, text, lower, business, catalog, policy, convo, businessId }) {
    // Handle greeting variations
    if (/^(hi|hello|hey|good morning|good afternoon|good evening|good day)\b/.test(lower)) {
        if (catalog.length) {
            await wa.sendText(from, `Hello, welcome to ${business.name}. ${business.description || ''}\n\nTell me what you need today, or ask me for the menu.`);
            await appendHistory(businessId, from, convo, text, '[greeting reply]');
            return true;
        }
        return false;
    }

    // Handle casual conversation about how the day is going
    if (/^(how.*day|how.*going|how.*are.*you|how.*doing|how.*far)$/i.test(lower)) {
        await wa.sendText(from, `Thank you for asking! The day is going great, and we have fresh items ready for you. How can I assist you today?`);
        await appendHistory(businessId, from, convo, text, '[casual conversation reply]');
        return true;
    }

    // Handle general business questions
    if (/(store|location|where.*you|address|operat|hours|time|open|close|contact|reach)/.test(lower)) {
        const deliveryFee = policy.delivery_fee || 1500;
        const address = business.address || 'Contact the owner for exact location';
        const hours = business.operating_hours || 'Contact owner for hours';
        
        await wa.sendText(from, `We're located at ${address}. Our operating hours are ${hours}. Our delivery fee is NGN ${deliveryFee.toLocaleString()}, but pickup is free. ${business.description || ''}`);
        await appendHistory(businessId, from, convo, text, '[business info reply]');
        return true;
    }

    // Handle delivery fee questions specifically
    if (/(delivery.*fee|fee.*delivery|how much.*delivery|delivery.*cost|cost.*delivery)/.test(lower)) {
        const deliveryFee = policy.delivery_fee || 1500;
        await wa.sendText(from, `Our delivery fee is NGN ${deliveryFee.toLocaleString()}. Pickup is free of charge. Where would you like your order delivered?`);
        await appendHistory(businessId, from, convo, text, '[delivery fee reply]');
        return true;
    }

    // Handle menu-related queries
    if (catalog.length && /(menu|what.*have|available|catalog|list|options|food|sell)/.test(lower)) {
        await sendMenuReply(from, business, catalog);
        await appendHistory(businessId, from, convo, text, '[fast menu reply]');
        return true;
    }

    const matched = findCatalogItem(catalog, lower);
    if (matched && /(how much|price|cost|amount)/.test(lower)) {
        await wa.sendText(from, `${matched.name} is NGN ${Number(matched.price).toLocaleString()}. ${matched.description || ''}\n\nWant me to add it for you?`);
        await appendHistory(businessId, from, convo, text, `[fast price reply for ${matched.name}]`);
        return true;
    }

    if (matched && /(photo|picture|image|see|show)/.test(lower) && matched.image_url) {
        await wa.sendImage(from, matched.image_url, `${matched.name} - NGN ${Number(matched.price).toLocaleString()}`);
        await appendHistory(businessId, from, convo, text, `[fast image reply for ${matched.name}]`);
        return true;
    }

    const parsedItems = parseOrderItems(text, catalog);
    if (parsedItems.length && /(order|want|need|take|get|add|buy|\d)/.test(lower)) {
        const fulfillment = lower.includes('deliver') || lower.includes('delivery') ? 'delivery' : 'pickup';
        const address = fulfillment === 'delivery' ? extractDeliveryAddress(text) : undefined;
        const totals = nego.calculateTotals(parsedItems, policy, fulfillment);
        const ctx = convo.context || {};
        ctx.order = { items: parsedItems, fulfillment, address, ...totals };

        if (fulfillment === 'delivery' && !address) {
            await db.updateConversation(businessId, from, { context: ctx, stage: 'collecting_address' });
            await wa.sendText(from, 'Sure, I have added that. What delivery address should I use?');
            await appendHistory(businessId, from, convo, text, '[fast order draft needs address]');
            return true;
        }

        await db.updateConversation(businessId, from, { context: ctx, stage: 'confirming' });
        await wa.sendText(from, nego.renderQuoteRecap(ctx.order, policy));
        await appendHistory(businessId, from, convo, text, '[fast quote]');
        return true;
    }

    if (convo.stage === 'collecting_address' && convo.context?.order?.items?.length) {
        const ctx = convo.context;
        ctx.order.address = text.trim();
        ctx.order.fulfillment = 'delivery';
        Object.assign(ctx.order, nego.calculateTotals(ctx.order.items, policy, 'delivery', ctx.order.discount_applied || 0));
        await db.updateConversation(businessId, from, { context: ctx, stage: 'confirming' });
        await wa.sendText(from, nego.renderQuoteRecap(ctx.order, policy));
        await appendHistory(businessId, from, convo, text, '[fast address collected]');
        return true;
    }

    if (!catalog.length && /(price|cost|how much|order|want|need|sew|make|buy|book|available|catalog|menu|deliver|pickup|measure|material|fabric|style)/.test(lower)) {
        return false;
    }

    return false;
}

async function maybeSwitchCustomerByCode(from, text, currentBusinessId) {
    const raw = text.trim();
    if (!/^[a-z0-9]{4,12}$/i.test(raw)) return false;

    const targetBusiness = await db.getBusinessByCode(raw.toUpperCase());
    if (!targetBusiness) return false;

    if (Number(targetBusiness.id) === Number(currentBusinessId)) {
        await wa.sendText(from, `You are already chatting with *${targetBusiness.name}*.\n\nTell me what you want, or ask for the menu.`);
        return true;
    }

    await db.bindCustomerToBusiness(from, targetBusiness.id);
    await db.getConversation(targetBusiness.id, from);
    await wa.sendText(from, `Switched you to *${targetBusiness.name}*.\n\n${targetBusiness.description || ''}\n\nYou can ask for the menu, prices, photos, or tell me what you want.`);
    return true;
}

async function handleToolCall(toolCall, { from, businessId, business, catalog, policy, convo }) {
    const name = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments || '{}');
    console.log(`[Tool] ${name}(${JSON.stringify(args)})`);

    switch (name) {
        case 'propose_discount':
            return handleDiscountTool(args, { from, businessId, business, policy, convo });
        case 'finalize_quote':
            return handleFinalizeQuoteTool(args, { from, businessId, catalog, policy, convo });
        case 'send_image':
            return handleSendImageTool(args, catalog);
        case 'show_menu_list':
            return handleShowMenuTool(args, business, catalog);
        case 'request_human_checkpoint':
            return handleHumanCheckpointTool(args, { from, businessId, business, convo });
        case 'switch_to_store':
            return handleSwitchStoreTool(args, { from, businessId });
        default:
            return { reply: 'I am not sure how to do that yet. Can you rephrase?' };
    }
}

async function handleSwitchStoreTool(args, { from, businessId }) {
    const switched = await maybeSwitchCustomerByCode(from, args.store_code || '', businessId);
    if (switched) return {};

    return {
        reply: `I could not find that seller code on Chat2Buy. Please recheck it and send it again.`
    };
}

async function handleHumanCheckpointTool(args, { from, businessId, business, convo }) {
    const ownerMessage = `*Human Checkpoint Needed*\n\n` +
        `Customer: ${from}\n` +
        `Reason: ${args.reason}\n\n` +
        `Request: ${args.customer_summary}\n` +
        `${args.collected_details ? `Details: ${args.collected_details}\n` : ''}` +
        `${args.suggested_next_step ? `Suggested next step: ${args.suggested_next_step}\n` : ''}\n\n` +
        `Reply to the customer directly, or send a price/approval here so the assistant can continue.`;

    await wa.sendText(business.owner_whatsapp_number, ownerMessage);

    const ctx = convo.context || {};
    ctx.human_checkpoint = {
        reason: args.reason,
        customer_summary: args.customer_summary,
        collected_details: args.collected_details || '',
        suggested_next_step: args.suggested_next_step || '',
        created_at: new Date().toISOString()
    };
    await db.updateConversation(businessId, from, { context: ctx, stage: 'human_checkpoint' });

    return {
        reply: `I have the important details now. Let me confirm this with ${business.name}'s owner so I do not misquote you.\n\nI will come back with the right answer shortly.`
    };
}

async function handleDiscountTool(args, { from, businessId, business, policy, convo }) {
    const order = convo.context?.order || { items: [] };
    const baseTotal = order.items?.reduce((s, i) => s + (i.qty * i.unit_price), 0) || 0;
    const quantity = order.items?.reduce((s, i) => s + i.qty, 0) || args.quantity || 0;

    if (!baseTotal) {
        return { reply: 'Let us choose the items first, then I can check what discount is possible.' };
    }

    const evalResult = nego.evaluateDiscount({
        baseTotal,
        proposedTotal: args.proposed_total,
        quantity,
        policy
    });

    if (evalResult.approved) {
        const ctx = convo.context || {};
        const orderData = ctx.order || { items: [] };
        const totals = nego.calculateTotals(orderData.items, policy, orderData.fulfillment, evalResult.savings);
        ctx.order = { ...orderData, ...totals, discount_applied: evalResult.savings };
        await db.updateConversation(businessId, from, { context: ctx, stage: 'quoting' });

        return { reply: `Good news. I can take NGN ${evalResult.savings.toLocaleString()} off. Your new total is NGN ${totals.total.toLocaleString()}.\n\nReply CONFIRM when you are ready.` };
    }

    if (evalResult.escalate) {
        // Build a more realistic escalation message
        const escalationMessage = `*Discount Escalation*\n\n` +
            `Customer: ${from}\n` +
            `Items: ${order.items?.map(i => `${i.qty} x ${i.name}`).join(', ') || 'No items'}\n\n` +
            `Customer requested ${evalResult.discountPct?.toFixed(1)}% off, but policy allows ${evalResult.counterPct}% at this quantity (${evalResult.quantity || 0} items).\n` +
            `They expect to pay: NGN ${args.proposed_total?.toLocaleString()}\n` +
            `Counter-offer: NGN ${evalResult.counterTotal?.toLocaleString()}\n\n` +
            `Reply with an approved amount, or NO to reject.`;

        await wa.sendText(business.owner_whatsapp_number, escalationMessage);
        escalationBuffer.set(business.owner_whatsapp_number, {
            customerNumber: from,
            businessId,
            evalResult,
            timestamp: Date.now()
        });
        await db.updateConversation(businessId, from, { stage: 'escalated' });
        
        // More realistic response to customer
        return { reply: `That discount request is quite generous. Let me check with the boss and get back to you in a few minutes.` };
    }

    return { reply: `I wish I could go that low. The best I can do now is NGN ${evalResult.savings.toLocaleString()} off, so total is NGN ${evalResult.counterTotal.toLocaleString()}.\n\nDoes that work for you?` };
}

async function handleFinalizeQuoteTool(args, { from, businessId, catalog, policy, convo }) {
    const items = args.items || [];
    const fulfillment = args.fulfillment || 'pickup';
    const address = args.address;

    const enrichedItems = items.map(item => {
        const catalogItem = findCatalogItem(catalog, item.name || '');
        return {
            name: catalogItem?.name || item.name,
            qty: Number(item.qty) || 1,
            unit_price: Number(item.unit_price || catalogItem?.price || 0)
        };
    }).filter(i => i.unit_price > 0);

    if (!enrichedItems.length) {
        return { reply: 'I could not match that to the menu. Which item would you like?' };
    }

    if (fulfillment === 'delivery' && !address) {
        const ctx = convo.context || {};
        ctx.order = { items: enrichedItems, fulfillment, ...nego.calculateTotals(enrichedItems, policy, fulfillment) };
        await db.updateConversation(businessId, from, { context: ctx, stage: 'collecting_address' });
        return { reply: 'Sure. What delivery address should I use?' };
    }

    const totals = nego.calculateTotals(enrichedItems, policy, fulfillment);
    const ctx = convo.context || {};
    ctx.order = { items: enrichedItems, fulfillment, address, ...totals };
    await db.updateConversation(businessId, from, { context: ctx, stage: 'confirming' });
    return { reply: nego.renderQuoteRecap(ctx.order, policy) };
}

function handleSendImageTool(args, catalog) {
    const item = findCatalogItem(catalog, args.item_name || '');
    if (item?.image_url) {
        return {
            imageUrl: item.image_url,
            imageCaption: `${item.name} - NGN ${Number(item.price).toLocaleString()}\n${item.description?.substring(0, 120) || ''}`
        };
    }
    return { reply: item ? `${item.name}: ${item.description || 'No description available yet.'}` : 'I do not have a photo of that item right now.' };
}

function handleShowMenuTool(args, business, catalog) {
    const category = args.category;
    const items = category ? catalog.filter(c => normalize(c.category) === normalize(category)) : catalog;
    const menuText = items.map(i => `- *${i.name}* - NGN ${Number(i.price).toLocaleString()}\n  ${i.description?.substring(0, 80) || ''}`).join('\n\n');
    return { reply: `*${business.name} Menu*\n\n${menuText}\n\nWhich one should I add for you?` };
}

async function processOrderConfirmation(from, convo, business, policy) {
    const orderData = convo.context?.order;
    if (!orderData?.items?.length) {
        await wa.sendText(from, 'I do not see any items in your order yet. What would you like?');
        return;
    }

    const order = await db.createOrder({
        businessId: business.id,
        customerNumber: from,
        items: orderData.items,
        subtotal: orderData.subtotal,
        discountApplied: orderData.discount_applied || 0,
        deliveryFee: orderData.deliveryFee || orderData.delivery_fee || 0,
        total: orderData.total,
        fulfillment: orderData.fulfillment,
        address: orderData.address,
        isTest: convo.is_test
    });

    if (convo.is_test) {
        await wa.sendText(from, `TEST ORDER #${order.id}\n\n${nego.renderQuoteRecap(orderData, policy)}\n\nThis is only a test. No payment needed.`);
        await wa.sendText(business.owner_whatsapp_number, `Test order #${order.id}\nFrom: ${from}\n${orderData.items.map(i => `- ${i.qty} x ${i.name}`).join('\n')}\nTotal: NGN ${Number(orderData.total || 0).toLocaleString()}`);
        await db.updateConversation(business.id, from, { stage: 'completed', context: {} });
        return;
    }

    try {
        const paystackRef = `order_${order.id}_${Date.now()}`;
        const payment = await paystack.createPaymentLink({
            amount: orderData.total,
            reference: paystackRef,
            metadata: { orderId: order.id, phone: from, businessId: business.id }
        });

        await db.updateOrderPaymentLink(order.id, payment.paymentLink);
        await wa.sendText(from, `Order #${order.id} confirmed.\n\nTotal: NGN ${Number(orderData.total || 0).toLocaleString()}\n\nPay here:\n${payment.paymentLink}\n\nOnce payment is complete, you will get a confirmation.`);
        await wa.sendText(business.owner_whatsapp_number, nego.buildOrderTicket(business, { ...order, items: orderData.items, fulfillment: orderData.fulfillment, address: orderData.address }));
        await db.updateConversation(business.id, from, { stage: 'payment_pending', context: { order_id: order.id } });
    } catch (err) {
        console.error('[Order] Payment link error:', err);
        await wa.sendText(from, 'Your order is confirmed, but I am having trouble generating the payment link. The store owner has been notified and will follow up.');
        await wa.sendText(business.owner_whatsapp_number, nego.buildOrderTicket(business, { ...order, items: orderData.items }) + '\n\nPayment link generation failed. Send manually.');
    }
}

async function handleEscalationReply(ownerNumber, text) {
    const escalation = escalationBuffer.get(ownerNumber);
    if (!escalation) return;

    const lower = text.trim().toLowerCase();
    if (lower === 'no' || lower === 'n') {
        await wa.sendText(escalation.customerNumber, `I checked. The best we can do is NGN ${escalation.evalResult.counterTotal?.toLocaleString()}. Reply CONFIRM if you want to go ahead.`);
        escalationBuffer.delete(ownerNumber);
        return;
    }

    const approvedAmount = parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (approvedAmount > 0) {
        await wa.sendText(escalation.customerNumber, `Good news. I got approval for NGN ${approvedAmount.toLocaleString()}.\n\nReply CONFIRM to lock it in.`);

        const convo = await db.getConversation(escalation.businessId, escalation.customerNumber);
        const ctx = convo.context || {};
        if (ctx.order) {
            ctx.order.total = approvedAmount;
            ctx.order.discount_applied = (ctx.order.subtotal + (ctx.order.deliveryFee || ctx.order.delivery_fee || 0)) - approvedAmount;
        }
        await db.updateConversation(escalation.businessId, escalation.customerNumber, { context: ctx, stage: 'confirming' });
        escalationBuffer.delete(ownerNumber);
        return;
    }

    await wa.sendText(ownerNumber, 'Reply with an approved amount, or NO to reject the discount.');
}

async function buildSellerAnalyticsReply(lower, business) {
    const asksOrders = /(order|orders|sales|business|revenue|today|week|recent)/.test(lower);
    if (!asksOrders) return null;

    const orders = await db.getOrdersByBusiness(business.id);
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const startWeek = new Date(now);
    startWeek.setDate(now.getDate() - 6);
    startWeek.setHours(0, 0, 0, 0);

    let filtered = orders.filter(o => !o.is_test);
    let label = 'recent';
    if (/(today|this morning|this afternoon|tonight)/.test(lower)) {
        filtered = filtered.filter(o => new Date(o.created_at) >= startToday);
        label = 'today';
    } else if (/(week|7 days|seven days)/.test(lower)) {
        filtered = filtered.filter(o => new Date(o.created_at) >= startWeek);
        label = 'this week';
    }

    const numberMatch = lower.match(/\b(\d{1,2})\b/);
    const limit = numberMatch ? Math.max(1, Math.min(20, Number(numberMatch[1]))) : 5;
    const totalValue = filtered.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const paidValue = filtered.filter(o => o.payment_status === 'paid').reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    if (/(how.*business|business.*going|sales|revenue|summary)/.test(lower)) {
        return `Business summary for *${business.name}* (${label}):\n\nOrders: *${filtered.length}*\nPaid revenue: *NGN ${paidValue.toLocaleString()}*\nTotal order value: *NGN ${totalValue.toLocaleString()}*\nPending payments: *${filtered.filter(o => o.payment_status === 'pending').length}*\n\n${filtered.length ? `Latest order: #${filtered[0].id} for NGN ${Number(filtered[0].total || 0).toLocaleString()}` : 'No orders in this period yet.'}`;
    }

    if (!filtered.length) return `No ${label} orders yet for ${business.name}.`;

    const lines = filtered.slice(0, limit).map(order => {
        const items = order.items?.map(i => `${i.qty}x ${i.name}`).join(', ') || 'No items';
        return `#${order.id} - NGN ${Number(order.total || 0).toLocaleString()} - ${order.payment_status} - ${items}`;
    }).join('\n');

    return `Here are the ${label} orders:\n\n${lines}`;
}

async function sendMenuReply(to, business, catalog) {
    const rows = catalog.slice(0, 12).map(item => `- *${item.name}* - NGN ${Number(item.price).toLocaleString()}`).join('\n');
    await wa.sendText(to, `Here is ${business.name}'s menu:\n\n${rows}\n\nTell me what catches your eye and the quantity.`);
}

function findCatalogItem(catalog, text) {
    const normalized = normalize(text);
    return catalog.find(item => {
        const name = normalize(item.name);
        const words = name.split(' ').filter(w => w.length > 2);
        return normalized.includes(name) || words.some(w => normalized.includes(w));
    });
}

function parseOrderItems(text, catalog) {
    const normalized = normalize(text);
    const items = [];
    for (const item of catalog) {
        const name = normalize(item.name);
        const words = name.split(' ').filter(w => w.length > 2);
        const hasItem = normalized.includes(name) || words.some(w => normalized.includes(w));
        if (!hasItem) continue;
        const qty = extractQuantityNearItem(normalized, words, name) || 1;
        items.push({ name: item.name, qty, unit_price: Number(item.price) });
    }
    return items;
}

function extractQuantityNearItem(text, words, fullName) {
    const numberWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 };
    const candidates = [fullName, ...words];
    for (const candidate of candidates) {
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const before = new RegExp(`(?:^|\\s)(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\\s+(?:plates?\\s+of\\s+|packs?\\s+of\\s+|portions?\\s+of\\s+|pieces?\\s+of\\s+)?${escaped}`);
        const after = new RegExp(`${escaped}\\s+(?:x\\s*)?(\\d+)`);
        const raw = text.match(before)?.[1] || text.match(after)?.[1];
        if (raw) return numberWords[raw] || Number(raw);
    }
    return null;
}

function extractDeliveryAddress(text) {
    const match = text.match(/(?:deliver(?:y)?\s+(?:to|at)?|address(?: is)?|to)\s+(.+)$/i);
    return match?.[1]?.trim();
}

async function handleSellerSwitchCode(from, text, business, convo) {
    const code = text.trim().toUpperCase();
    const targetStore = await db.getBusinessByCode(code);
    if (!targetStore || targetStore.id === business.id) {
        await wa.sendText(from, 'I could not find that seller code. Send a valid code or type a new store name.');
        return;
    }

    await wa.sendText(from,
        `Nice one. I found *${targetStore.name}*. Use the seller code *${targetStore.code}* with the customer flow, or jump back to chat and tell me the item you want from them.`
    );
    await db.updateConversation(business.id, from, { context: {}, stage: 'greeting' });
}

function normalize(text) {
    return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractMessageText(message = {}) {
    if (message.text?.body) return message.text.body;
    if (message.button?.text) return message.button.text;
    if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
    if (message.interactive?.button_reply?.id) return message.interactive.button_reply.id;
    if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
    if (message.interactive?.list_reply?.description) return message.interactive.list_reply.description;
    if (message.image?.caption) return message.image.caption;
    if (message.document?.caption) return message.document.caption;
    return '';
}

async function appendHistory(businessId, from, convo, userText, assistantText) {
    const history = convo.history || [];
    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: assistantText });
    await db.updateConversation(businessId, from, { history: history.slice(-10) });
}

export default router;
