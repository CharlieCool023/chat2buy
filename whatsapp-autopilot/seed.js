/**
 * Seed data for local development
 * Creates demo business "Mama Nkechi's Kitchen" with 8 Nigerian food items
 * Run with: node seed.js
 */

import * as db from './lib/db.js';

async function seed() {
    console.log('[Seed] Creating demo data...');

    // Create demo business
    const business = await db.createBusiness({
        name: "Mama Nkechi's Kitchen",
        owner_whatsapp_number: process.env.OWNER_WHATSAPP_NUMBER || '2349050996837',
        description: 'Authentic Nigerian party food and small chops for all occasions. We specialize in jollof rice, fried rice, small chops, and traditional soups.'
    });

    // Override code and activate
    business.code = 'MKN001';
    business.status = 'live';
    await db.updateBusinessStatus(business.id, 'live');

    console.log(`[Seed] Business created: ${business.name} (code: ${business.code})`);

    // Update policy
    await db.updatePolicy(business.id, {
        bulkMinQty: 20,
        bulkDiscountPct: 5,
        maxDiscountPct: 2,
        deliveryFee: 1500,
        pickupAvailable: true,
        notes: 'Free delivery on orders above N50,000. Bulk discount applies to main dishes only (rice items and soup combos).'
    });

    // Add 8 catalog items
    const products = [
        {
            name: 'Party Jollof Rice',
            description: 'Smoky Nigerian party jollof rice cooked over firewood for that authentic taste. Served with fried plantain and grilled chicken. Serves 1 person.',
            category: 'Rice Dishes',
            price: 3500,
            imageUrl: '/catalog/jollof-rice.jpg'
        },
        {
            name: 'Fried Rice Special',
            description: 'Fragrant fried rice with mixed vegetables (carrots, green beans, sweet corn), diced liver, and spring onions. Served with coleslaw.',
            category: 'Rice Dishes',
            price: 3500,
            imageUrl: '/catalog/fried-rice.jpg'
        },
        {
            name: 'Small Chops Platter',
            description: 'Assorted party snacks: 6 spring rolls, 6 samosas, 10 puff-puff, and 4 chicken kebabs. Served with chili and garlic dipping sauces.',
            category: 'Snacks',
            price: 5000,
            imageUrl: '/catalog/small-chops.jpg'
        },
        {
            name: 'Ofada Rice & Ayamase',
            description: 'Unpolished Ofada brown rice served on traditional leaf with spicy Ayamase stew (ofada sauce) containing assorted meats, boiled eggs, and smoked fish.',
            category: 'Traditional',
            price: 4000,
            imageUrl: '/catalog/ofada-rice.jpg'
        },
        {
            name: 'Egusi Soup Combo',
            description: 'Thick melon seed soup with ugu leaves, assorted meat (beef, goat meat, stockfish), and 2 wraps of pounded yam.',
            category: 'Soups',
            price: 4500,
            imageUrl: '/catalog/egusi-soup.jpg'
        },
        {
            name: 'Chicken Suya Skewers',
            description: '5 pieces of spicy grilled chicken suya with groundnut-pepper spice coating, charred to perfection. Served with fresh onions and tomatoes.',
            category: 'Grills',
            price: 3000,
            imageUrl: '/catalog/chicken-suya.jpg'
        },
        {
            name: 'Chapman Punch (1L)',
            description: 'Refreshing Nigerian Chapman cocktail - mix of Fanta, Sprite, grenadine, and Angostura bitters. Garnished with cucumber, orange, and cherry. 1 liter serves 4.',
            category: 'Drinks',
            price: 2000,
            imageUrl: '/catalog/chapman-drink.jpg'
        },
        {
            name: 'Sweet Puff-Puff (20 pcs)',
            description: '20 pieces of golden-brown deep-fried dough balls, lightly dusted with sugar. Soft and fluffy inside - the perfect party snack.',
            category: 'Snacks',
            price: 1500,
            imageUrl: '/catalog/puff-puff.jpg'
        }
    ];

    for (const product of products) {
        await db.addCatalogItem({
            businessId: business.id,
            ...product
        });
        console.log(`[Seed] Added: ${product.name} — ₦${product.price.toLocaleString()}`);
    }

    console.log('[Seed] Done! Demo business ready to use.');
    console.log(`[Seed] Seller code: ${business.code}`);
    console.log(`[Seed] WhatsApp the bot and enter code: ${business.code}`);
}

seed().catch(console.error);
