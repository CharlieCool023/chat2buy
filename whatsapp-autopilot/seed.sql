-- Seed data: Demo business "Mama Nkechi's Kitchen" with 8 Nigerian food items
-- For local testing - run after schema.sql

-- Insert demo business
INSERT INTO businesses (name, owner_whatsapp_number, description, code, status)
VALUES (
    'Mama Nkechi''s Kitchen',
    '2349050996837',
    'Authentic Nigerian party food and small chops for all occasions. We specialize in jollof rice, fried rice, small chops, and traditional soups.',
    'MKN001',
    'live'
) ON CONFLICT DO NOTHING;

-- Insert pricing policy
INSERT INTO policies (business_id, bulk_min_qty, bulk_discount_pct, max_discount_pct_no_bulk, delivery_fee, pickup_available, notes)
VALUES (
    (SELECT id FROM businesses WHERE code = 'MKN001'),
    20,    -- bulk_min_qty: 20+ plates gets bulk discount
    5,     -- bulk_discount_pct: 5% off for bulk
    2,     -- max_discount_pct_no_bulk: 2% max for small orders
    1500,  -- delivery_fee: N1,500
    true,  -- pickup available
    'Free delivery on orders above N50,000. Bulk discount applies to main dishes only (rice items and soup combos).'
) ON CONFLICT DO NOTHING;

-- Insert 8 catalog items (Nigerian food)
INSERT INTO catalog_items (business_id, name, description, category, price, image_url, active) VALUES
(
    (SELECT id FROM businesses WHERE code = 'MKN001'),
    'Party Jollof Rice',
    'Smoky Nigerian party jollof rice cooked over firewood for that authentic taste. Served with fried plantain and grilled chicken. Serves 1 person.',
    'Rice Dishes',
    3500,
    'https://placeholder-for-local.com/catalog/jollof-rice.jpg',
    true
),
(
    (SELECT id FROM businesses WHERE code = 'MKN001'),
    'Fried Rice Special',
    'Fragrant fried rice with mixed vegetables (carrots, green beans, sweet corn), diced liver, and spring onions. Served with coleslaw.',
    'Rice Dishes',
    3500,
    'https://placeholder-for-local.com/catalog/fried-rice.jpg',
    true
),
(
    (SELECT id FROM businesses WHERE code = 'MKN001'),
    'Small Chops Platter',
    'Assorted party snacks: 6 spring rolls, 6 samosas, 10 puff-puff, and 4 chicken kebabs. Served with chili and garlic dipping sauces.',
    'Snacks',
    5000,
    'https://placeholder-for-local.com/catalog/small-chops.jpg',
    true
),
(
    (SELECT id FROM businesses WHERE code = 'MKN001'),
    'Ofada Rice & Ayamase',
    'Unpolished Ofada brown rice served on traditional leaf with spicy Ayamase stew (ofada sauce) containing assorted meats, boiled eggs, and smoked fish.',
    'Traditional',
    4000,
    'https://placeholder-for-local.com/catalog/ofada-rice.jpg',
    true
),
(
    (SELECT id FROM businesses WHERE code = 'MKN001'),
    'Egusi Soup Combo',
    'Thick melon seed soup with ugu leaves, assorted meat (beef, goat meat, stockfish), and 2 wraps of pounded yam.',
    'Soups',
    4500,
    'https://placeholder-for-local.com/catalog/egusi-soup.jpg',
    true
),
(
    (SELECT id FROM businesses WHERE code = 'MKN001'),
    'Chicken Suya Skewers',
    '5 pieces of spicy grilled chicken suya with groundnut-pepper spice coating, charred to perfection. Served with fresh onions and tomatoes.',
    'Grills',
    3000,
    'https://placeholder-for-local.com/catalog/chicken-suya.jpg',
    true
),
(
    (SELECT id FROM businesses WHERE code = 'MKN001'),
    'Chapman Punch (1L)',
    'Refreshing Nigerian Chapman cocktail - mix of Fanta, Sprite, grenadine, and Angostura bitters. Garnished with cucumber, orange, and cherry. 1 liter serves 4.',
    'Drinks',
    2000,
    'https://placeholder-for-local.com/catalog/chapman-drink.jpg',
    true
),
(
    (SELECT id FROM businesses WHERE code = 'MKN001'),
    'Sweet Puff-Puff (20 pcs)',
    '20 pieces of golden-brown deep-fried dough balls, lightly dusted with sugar. Soft and fluffy inside - the perfect party snack.',
    'Snacks',
    1500,
    'https://placeholder-for-local.com/catalog/puff-puff.jpg',
    true
)
ON CONFLICT DO NOTHING;
