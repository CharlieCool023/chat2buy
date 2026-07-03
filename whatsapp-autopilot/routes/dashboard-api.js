import express from 'express';
import * as db from '../lib/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Load JSON db for direct access in middleware
function getJsonDB() {
    const dbPath = path.join(__dirname, '..', 'data', 'autopilot.json');
    if (!fs.existsSync(dbPath)) return { businesses: [] };
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

// Middleware: validate setup token for onboarding access
async function validateSetupToken(req, res, next) {
    const token = req.query.token || req.headers['x-setup-token'];
    if (!token) return res.status(401).json({ error: 'Setup token required' });

    const jsonDB = getJsonDB();
    const business = jsonDB.businesses.find(b => b.setup_token === token);
    if (!business) return res.status(403).json({ error: 'Invalid token' });

    req.business = business;
    next();
}

// Middleware: simple API key auth for dashboard
async function validateApiKey(req, res, next) {
    const token = req.query.token || req.headers['x-api-key'];
    if (!token) return res.status(401).json({ error: 'API key required' });

    const jsonDB = getJsonDB();
    const business = jsonDB.businesses.find(b => b.setup_token === token);
    if (!business) return res.status(403).json({ error: 'Invalid API key' });

    req.business = business;
    next();
}

/**
 * GET /api/dashboard/stats — Overview stats
 */
router.get('/dashboard/stats', validateApiKey, async (req, res) => {
    try {
        const stats = await db.getOrderStats(req.business.id);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const week = new Date();
        week.setDate(week.getDate() - 6);
        week.setHours(0, 0, 0, 0);
        const todayStats = await db.getOrderStats(req.business.id, { from: today.toISOString() });
        const weekStats = await db.getOrderStats(req.business.id, { from: week.toISOString() });
        const catalog = await db.getCatalog(req.business.id);
        res.json({
            business: {
                id: req.business.id,
                name: req.business.name,
                code: req.business.code,
                status: req.business.status
            },
            stats: {
                ...stats,
                catalog_size: catalog.length,
                today_orders: todayStats.total_orders,
                today_revenue: todayStats.total_revenue,
                week_orders: weekStats.total_orders,
                week_revenue: weekStats.total_revenue
            }
        });
    } catch (err) {
        console.error('[Dashboard] Stats error:', err);
        res.status(500).json({ error: 'Failed to load stats' });
    }
});

/**
 * GET /api/dashboard/catalog — List all products
 */
router.get('/dashboard/catalog', validateApiKey, async (req, res) => {
    try {
        const items = await db.getCatalog(req.business.id);
        res.json({ items });
    } catch (err) {
        console.error('[Dashboard] Catalog error:', err);
        res.status(500).json({ error: 'Failed to load catalog' });
    }
});

/**
 * POST /api/dashboard/catalog — Add a product
 */
router.post('/dashboard/catalog', validateApiKey, async (req, res) => {
    try {
        const { name, description, category, price, imageUrl } = req.body;
        if (!name || !price) {
            return res.status(400).json({ error: 'Name and price are required' });
        }

        const item = await db.addCatalogItem({
            businessId: req.business.id,
            name,
            description: description || '',
            category: category || 'General',
            price: parseFloat(price),
            imageUrl: imageUrl || null
        });

        // Auto-activate business when first product is added
        if (req.business.status === 'pending_setup') {
            await db.updateBusinessStatus(req.business.id, 'live');
        }

        res.status(201).json({ item });
    } catch (err) {
        console.error('[Dashboard] Add catalog error:', err);
        res.status(500).json({ error: 'Failed to add product' });
    }
});

/**
 * DELETE /api/dashboard/catalog/:id — Remove a product
 */
router.delete('/dashboard/catalog/:id', validateApiKey, async (req, res) => {
    try {
        const item = await db.deleteCatalogItem(req.business.id, req.params.id);
        if (!item) return res.status(404).json({ error: 'Product not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('[Dashboard] Delete catalog error:', err);
        res.status(500).json({ error: 'Failed to remove product' });
    }
});

/**
 * GET /api/dashboard/policy — Get pricing policy
 */
router.get('/dashboard/policy', validateApiKey, async (req, res) => {
    try {
        const policy = await db.getPolicy(req.business.id);
        res.json({ policy });
    } catch (err) {
        console.error('[Dashboard] Policy error:', err);
        res.status(500).json({ error: 'Failed to load policy' });
    }
});

/**
 * PUT /api/dashboard/policy — Update pricing policy
 */
router.put('/dashboard/policy', validateApiKey, async (req, res) => {
    try {
        const {
            bulk_min_qty,
            bulk_discount_pct,
            max_discount_pct,
            delivery_fee,
            pickup_available,
            notes
        } = req.body;

        const policy = await db.updatePolicy(req.business.id, {
            bulkMinQty: parseInt(bulk_min_qty) || 20,
            bulkDiscountPct: parseFloat(bulk_discount_pct) || 5,
            maxDiscountPct: parseFloat(max_discount_pct) || 2,
            deliveryFee: parseFloat(delivery_fee) || 1500,
            pickupAvailable: pickup_available !== false,
            notes: notes || ''
        });

        res.json({ policy });
    } catch (err) {
        console.error('[Dashboard] Update policy error:', err);
        res.status(500).json({ error: 'Failed to update policy' });
    }
});

/**
 * GET /api/dashboard/orders — List all orders
 */
router.get('/dashboard/orders', validateApiKey, async (req, res) => {
    try {
        const orders = await db.getOrdersByBusiness(req.business.id);
        res.json({ orders });
    } catch (err) {
        console.error('[Dashboard] Orders error:', err);
        res.status(500).json({ error: 'Failed to load orders' });
    }
});

/**
 * GET /api/dashboard/business — Get business info
 */
router.get('/dashboard/business', validateApiKey, async (req, res) => {
    try {
        res.json({
            business: {
                id: req.business.id,
                name: req.business.name,
                description: req.business.description,
                code: req.business.code,
                status: req.business.status,
                owner_whatsapp_number: req.business.owner_whatsapp_number,
                created_at: req.business.created_at
            }
        });
    } catch (err) {
        console.error('[Dashboard] Business error:', err);
        res.status(500).json({ error: 'Failed to load business info' });
    }
});

/**
 * GET /api/dashboard/setup — Validate setup token (for onboarding link)
 */
router.get('/dashboard/setup', validateSetupToken, async (req, res) => {
    try {
        res.json({
            valid: true,
            business: {
                id: req.business.id,
                name: req.business.name,
                status: req.business.status
            }
        });
    } catch (err) {
        console.error('[Dashboard] Setup error:', err);
        res.status(500).json({ error: 'Setup validation failed' });
    }
});

/**
 * GET /api/dashboard — Check auth (used by dashboard frontend)
 */
router.get('/dashboard', validateApiKey, async (req, res) => {
    res.json({ authenticated: true, business: req.business });
});

export default router;
