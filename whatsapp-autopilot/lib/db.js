/**
 * JSON File-based Database — for local development
 * Zero dependencies, instant setup
 * Switch to PostgreSQL (lib/db-pg.js) when deploying to Alibaba Cloud
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DB_DIR, 'autopilot.json');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// Load or initialize database
function loadDB() {
    if (fs.existsSync(DB_FILE)) {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
    const initial = {
        businesses: [],
        catalog_items: [],
        policies: [],
        customer_bindings: [],
        conversations: [],
        orders: [],
        sequence: { businesses: 1, catalog_items: 1, policies: 1, customer_bindings: 1, conversations: 1, orders: 1 }
    };
    saveDB(initial);
    return initial;
}

function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

// Auto-reload every 5 seconds for multi-process safety
setInterval(() => {
    if (fs.existsSync(DB_FILE)) {
        try {
            db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } catch { /* ignore parse errors */ }
    }
}, 5000);

function nextId(table) {
    db.sequence[table] = (db.sequence[table] || 1) + 1;
    return db.sequence[table] - 1;
}

function persist() {
    saveDB(db);
}

// ============== BUSINESSES ==============

export async function getBusinessByCode(code) {
    return db.businesses.find(b => b.code === code.toUpperCase() && b.status === 'live') || null;
}

export async function getBusinessByOwner(number) {
    return db.businesses.find(b => b.owner_whatsapp_number === number) || null;
}

export async function getBusinessById(id) {
    return db.businesses.find(b => b.id === Number(id)) || null;
}

export async function createBusiness({ name, owner_whatsapp_number, description }) {
    const code = `S${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const setupToken = `setup-${crypto.randomBytes(4).toString('hex')}-${Date.now().toString(36)}`;
    const business = {
        id: nextId('businesses'),
        name,
        owner_whatsapp_number,
        description: description || '',
        code,
        category: 'General',
        setup_token: setupToken,
        status: 'pending_setup',
        created_at: new Date().toISOString()
    };
    db.businesses.push(business);

    // Create default policy (generous defaults for negotiation flexibility)
    db.policies.push({
        id: nextId('policies'),
        business_id: business.id,
        bulk_min_qty: 15,
        bulk_discount_pct: 10,
        max_discount_pct_no_bulk: 5,
        delivery_fee: 1500,
        pickup_available: true,
        notes: ''
    });

    persist();
    return business;
}

export async function updateBusinessStatus(businessId, status) {
    const b = db.businesses.find(b => b.id === Number(businessId));
    if (b) { b.status = status; persist(); }
    return b || null;
}

export async function updateBusiness(businessId, updates = {}) {
    const b = db.businesses.find(b => b.id === Number(businessId));
    if (!b) return null;

    const allowed = ['name', 'description', 'status', 'owner_whatsapp_number', 'category'];
    for (const key of allowed) {
        if (updates[key] !== undefined) b[key] = updates[key];
    }
    b.updated_at = new Date().toISOString();
    persist();
    return b;
}

// ============== CATALOG ==============

export async function getCatalog(businessId) {
    return db.catalog_items.filter(c => c.business_id === Number(businessId) && c.active !== false);
}

export async function addCatalogItem({ businessId, name, description, category, price, imageUrl }) {
    const item = {
        id: nextId('catalog_items'),
        business_id: Number(businessId),
        name,
        description: description || '',
        category: category || 'General',
        price: Number(price),
        image_url: imageUrl || null,
        active: true
    };
    db.catalog_items.push(item);
    persist();
    return item;
}

export async function deleteCatalogItem(businessId, itemId) {
    const item = db.catalog_items.find(
        c => c.id === Number(itemId) && c.business_id === Number(businessId)
    );
    if (!item) return null;
    item.active = false;
    persist();
    return item;
}

// ============== POLICIES ==============

export async function getPolicy(businessId) {
    return db.policies.find(p => p.business_id === Number(businessId)) || null;
}

export async function updatePolicy(businessId, { bulkMinQty, bulkDiscountPct, maxDiscountPct, deliveryFee, pickupAvailable, notes }) {
    let p = db.policies.find(p => p.business_id === Number(businessId));
    if (!p) {
        p = { id: nextId('policies'), business_id: Number(businessId) };
        db.policies.push(p);
    }
    p.bulk_min_qty = bulkMinQty;
    p.bulk_discount_pct = bulkDiscountPct;
    p.max_discount_pct_no_bulk = maxDiscountPct;
    p.delivery_fee = deliveryFee;
    p.pickup_available = pickupAvailable;
    p.notes = notes;
    persist();
    return p;
}

// ============== CUSTOMER BINDINGS ==============

export async function getCustomerBinding(customerNumber) {
    const binding = db.customer_bindings
        .filter(cb => cb.customer_number === customerNumber)
        .sort((a, b) => new Date(b.last_interaction_at) - new Date(a.last_interaction_at))[0];

    if (!binding) return null;

    const business = db.businesses.find(b => b.id === binding.business_id);
    if (!business) return null;

    return {
        ...binding,
        business_name: business.name,
        code: business.code,
        description: business.description,
        owner_whatsapp_number: business.owner_whatsapp_number
    };
}

export async function bindCustomerToBusiness(customerNumber, businessId) {
    const existing = db.customer_bindings.find(
        cb => cb.customer_number === customerNumber && cb.business_id === Number(businessId)
    );
    if (existing) {
        existing.last_interaction_at = new Date().toISOString();
    } else {
        db.customer_bindings.push({
            id: nextId('customer_bindings'),
            customer_number: customerNumber,
            business_id: Number(businessId),
            bound_at: new Date().toISOString(),
            last_interaction_at: new Date().toISOString()
        });
    }
    persist();
}

export async function touchCustomerBinding(customerNumber, businessId) {
    const binding = db.customer_bindings.find(
        cb => cb.customer_number === customerNumber && cb.business_id === Number(businessId)
    );
    if (!binding) return null;
    binding.last_interaction_at = new Date().toISOString();
    persist();
    return binding;
}

// ============== CONVERSATIONS ==============

export async function getConversation(businessId, customerNumber) {
    let convo = db.conversations.find(
        c => c.business_id === Number(businessId) && c.customer_number === customerNumber
    );
    if (!convo) {
        convo = {
            id: nextId('conversations'),
            business_id: Number(businessId),
            customer_number: customerNumber,
            stage: 'greeting',
            context: {},
            history: [],
            is_test: false,
            updated_at: new Date().toISOString()
        };
        db.conversations.push(convo);
        persist();
    }
    return convo;
}

export async function updateConversation(businessId, customerNumber, { stage, context, history, is_test }) {
    const convo = db.conversations.find(
        c => c.business_id === Number(businessId) && c.customer_number === customerNumber
    );
    if (!convo) return null;

    if (stage !== undefined) convo.stage = stage;
    if (context !== undefined) convo.context = context;
    if (history !== undefined) convo.history = history;
    if (is_test !== undefined) convo.is_test = is_test;
    convo.updated_at = new Date().toISOString();

    persist();
    return convo;
}

// ============== ORDERS ==============

export async function createOrder({ businessId, customerNumber, items, subtotal, discountApplied, deliveryFee, total, fulfillment, address, isTest }) {
    const order = {
        id: nextId('orders'),
        business_id: Number(businessId),
        customer_number: customerNumber,
        items,
        subtotal: subtotal || 0,
        discount_applied: discountApplied || 0,
        delivery_fee: deliveryFee || 0,
        total: total || 0,
        fulfillment,
        address: address || null,
        payment_status: 'pending',
        payment_link: null,
        paystack_reference: null,
        is_test: isTest || false,
        escalation_status: null,
        created_at: new Date().toISOString()
    };
    db.orders.push(order);
    persist();
    return order;
}

export async function getOrder(orderId) {
    return db.orders.find(o => o.id === Number(orderId)) || null;
}

export async function updateOrderPayment(orderId, { paymentStatus, paystackReference }) {
    const order = db.orders.find(o => o.id === Number(orderId));
    if (order) {
        if (paymentStatus) order.payment_status = paymentStatus;
        if (paystackReference) order.paystack_reference = paystackReference;
        persist();
    }
    return order || null;
}

export async function updateOrderPaymentLink(orderId, paymentLink) {
    const order = db.orders.find(o => o.id === Number(orderId));
    if (order) {
        order.payment_link = paymentLink;
        persist();
    }
    return order || null;
}

export async function getOrdersByBusiness(businessId) {
    return db.orders
        .filter(o => o.business_id === Number(businessId))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function getOrderStats(businessId, { from, to } = {}) {
    const fromTime = from ? new Date(from).getTime() : null;
    const toTime = to ? new Date(to).getTime() : null;
    const bizOrders = db.orders.filter(o => {
        if (o.business_id !== Number(businessId) || o.is_test) return false;
        const created = new Date(o.created_at).getTime();
        if (fromTime && created < fromTime) return false;
        if (toTime && created > toTime) return false;
        return true;
    });
    const paid = bizOrders.filter(o => o.payment_status === 'paid');
    return {
        total_orders: bizOrders.length,
        pending_payment: bizOrders.filter(o => o.payment_status === 'pending').length,
        paid_orders: paid.length,
        total_revenue: paid.reduce((s, o) => s + (o.total || 0), 0),
        pending_value: bizOrders
            .filter(o => o.payment_status === 'pending')
            .reduce((s, o) => s + (o.total || 0), 0),
        average_order_value: paid.length
            ? Math.round(paid.reduce((s, o) => s + (o.total || 0), 0) / paid.length)
            : 0
    };
}

// ============== MISC ==============

export async function query(sql, params) {
    // Placeholder for PostgreSQL compatibility
    // Not used in JSON mode but kept for API consistency
    console.log(`[DB] query() called with JSON db - ignoring: ${sql.substring(0, 60)}...`);
    return { rows: [] };
}

export { loadDB, saveDB };
export default { loadDB, saveDB };
