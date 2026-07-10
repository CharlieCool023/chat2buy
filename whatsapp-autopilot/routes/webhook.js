import express from 'express';
import * as db from '../lib/db.js';
import * as wa from '../lib/whatsapp.js';
import * as ai from '../lib/ai.js';
import * as nego from '../lib/negotiation.js';
import * as paystack from '../lib/paystack.js';

const router = express.Router();
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const NGROK_URL = process.env.NGROK_URL || 'http://localhost:3000';
const escalationBuffer = new Map();

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
        lower.includes('remind me of my token')
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
        await wa.sendText(from, '*Test Mode* is on.\n\nI will respond like I would to a real customer. Try "hi" or "what do you have?"\n\nType STOP to end test mode.');
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

    await wa.sendText(from, `Hi boss. ${business.name} is live.\n\nYou can ask me "any recent orders?", "orders today", "orders this week", "give me 10 orders", or "how is business going?".\n\nType TEST to try the customer flow. Your seller code is *${business.code}*.`);
}

async function handleSellerOnboarding(from, text, business) {
    const convo = await db.getConversation(business.id, from);
    const ctx = convo.context || {};

    if (!ctx.onboarding_step) {
        ctx.onboarding_step = 'ask_name';
        ctx.onboarding_data = {};
        await db.updateConversation(business.id, from, { context: ctx });
        await wa.sendText(from, "Welcome. Let's prepare your AI store together.\n\nWhat is your business name?");
        return;
    }

    const data = ctx.onboarding_data;
    if (ctx.onboarding_step === 'ask_name') {
        data.name = text.trim();
        ctx.onboarding_step = 'ask_description';
        await db.updateConversation(business.id, from, { context: ctx });
        await wa.sendText(from, `Nice. What does *${data.name}* sell? Give me a short phrase.`);
        return;
    }

    if (ctx.onboarding_step === 'ask_description') {
        data.description = text.trim();
        ctx.onboarding_step = 'ask_category';
        await db.updateConversation(business.id, from, { context: ctx });
        await wa.sendText(from, 'Which market category fits your business best? For example: food, fashion, electronics, or retail.');
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

    const dashboardUrl = `${NGROK_URL}/dashboard/setup?token=${updated.setup_token}&biz=${updated.id}`;
    await wa.sendText(from,
        `Great! *${updated.name}* is ready for dashboard setup.\n\nSeller code: *${updated.code}*\nCategory: *${updated.category}*\n\nFinish onboarding here:\n${dashboardUrl}\n\nWhen you're done, return to WhatsApp and say hi so I can welcome you and help you test the store.`
    );
}

function buildSellerCredentialReminder(business) {
    const baseUrl = process.env.DASHBOARD_URL || `${NGROK_URL}/dashboard`;
    const setupUrl = `${baseUrl.replace(/\/$/, '')}/setup?token=${business.setup_token}&biz=${business.id}`;

    return `Here are your ${business.name} details:\n\n` +
        `Seller code: *${business.code}*\n` +
        `Dashboard token: *${business.setup_token}*\n` +
        `Setup link: ${setupUrl}\n\n` +
        `Share only the seller code with customers. Keep the dashboard token private.`;
}

async function handleNewCustomer(from, text) {
    const lower = text.trim().toLowerCase();
    const code = text.trim().toUpperCase();
    const business = await db.getBusinessByCode(code);

    if (business) {
        await db.bindCustomerToBusiness(from, business.id);
        await db.getConversation(business.id, from);
        await wa.sendText(from, `Welcome to *${business.name}*.\n\n${business.description || ''}\n\nYou can ask for the menu, prices, photos, or just tell me what you want.`);
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

    // Handle casual conversation for new customers
    if (/^(how.*day|how.*going|how.*are.*you|how.*doing|how.*far)$/i.test(lower)) {
        await wa.sendText(from, `Hello! Thank you for reaching out. You can start shopping by entering a seller code, or set up your own store by typing SELL. How can I assist you today?`);
        return;
    }

    if (/(weather|rain|sun|hot|cold|climate|temperature)/.test(lower)) {
        await wa.sendText(from, `I don't have real-time weather info, but I hope it's treating you well! You can start shopping by entering a seller code, or set up your own store by typing SELL.`);
        return;
    }

    await wa.sendText(from, 'Welcome. Enter a seller code to start shopping, or type SELL to set up your own store.');
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
        } else {
            await wa.sendText(from, 'No order to confirm yet. Tell me what you want and I will put it together.');
        }
        return;
    }

    // Handle casual conversation and general questions
    if (/^(how.*day|how.*going|how.*are.*you|how.*doing|how.*far)$/i.test(lower)) {
        await wa.sendText(from, `Thank you for asking! ${business.name} is doing great. How can I assist you with shopping today?`);
        await appendHistory(businessId, from, convo, text, '[casual conversation reply]');
        return;
    }

    if (/(switch|change seller|new seller|different store|shop somewhere else)/.test(lower)) {
        await db.touchCustomerBinding(from, businessId);
        await wa.sendText(from, `Sure, you can switch to shop with a different seller. Enter another seller code, or type SELL to set up your own store.`);
        await appendHistory(businessId, from, convo, text, '[switch seller requested]');
        return;
    }

    const handledFast = await tryFastCustomerReply({ from, text, lower, business, catalog, policy, convo, businessId });
    if (handledFast) return;

    await db.touchCustomerBinding(from, businessId);

    const history = convo.history || [];
    const messages = [...history.slice(-4), { role: 'user', content: text }];
    const externalContext = await ai.getExternalContext(business);
    const systemPrompt = ai.buildCustomerPrompt(business, catalog, policy, convo, externalContext);

    let aiMessage;
    try {
        const aiResponse = await ai.chatWithAI({ systemPrompt, messages, tools: ai.AGENT_TOOLS });
        aiMessage = aiResponse.message;
    } catch (err) {
        console.error('[Webhook] AI service unavailable:', err.message);
        await wa.sendText(from, 'No wahala boss — I’m taking a quick rest. Come back in a few minutes and I’ll help you with that.');
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

    if (aiMessage.content) {
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
        default:
            return { reply: 'I am not sure how to do that yet. Can you rephrase?' };
    }
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
