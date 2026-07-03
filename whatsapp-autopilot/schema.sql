-- Chat-to-Buy WhatsApp Autopilot Database Schema
-- PostgreSQL - for local development and Alibaba Cloud ApsaraDB RDS

-- Enable UUID extension for unique codes
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Businesses (sellers)
CREATE TABLE IF NOT EXISTS businesses (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    owner_whatsapp_number TEXT NOT NULL UNIQUE,
    description TEXT,
    code TEXT UNIQUE NOT NULL DEFAULT upper(substring(md5(random()::text), 1, 6)),
    setup_token TEXT NOT NULL DEFAULT md5(random()::text),
    status TEXT DEFAULT 'pending_setup' CHECK (status IN ('pending_setup', 'live')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Catalog items (products)
CREATE TABLE IF NOT EXISTS catalog_items (
    id SERIAL PRIMARY KEY,
    business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    price NUMERIC NOT NULL,
    image_url TEXT,
    active BOOLEAN DEFAULT TRUE
);

-- Pricing & negotiation policies
CREATE TABLE IF NOT EXISTS policies (
    id SERIAL PRIMARY KEY,
    business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
    bulk_min_qty INT DEFAULT 25,
    bulk_discount_pct NUMERIC DEFAULT 5,
    max_discount_pct_no_bulk NUMERIC DEFAULT 2,
    delivery_fee NUMERIC DEFAULT 1000,
    pickup_available BOOLEAN DEFAULT TRUE,
    notes TEXT,
    UNIQUE (business_id)
);

-- Customer bindings to sellers (multi-tenant routing)
CREATE TABLE IF NOT EXISTS customer_bindings (
    id SERIAL PRIMARY KEY,
    customer_number TEXT NOT NULL,
    business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
    bound_at TIMESTAMPTZ DEFAULT NOW(),
    last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (customer_number, business_id)
);

-- Conversations (stateful chat tracking)
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
    customer_number TEXT NOT NULL,
    stage TEXT DEFAULT 'greeting' CHECK (stage IN (
        'greeting', 'browsing', 'negotiating', 'quoting', 
        'confirming', 'payment_pending', 'completed', 
        'escalated', 'seller_onboarding', 'awaiting_code'
    )),
    context JSONB DEFAULT '{}',
    history JSONB DEFAULT '[]',
    is_test BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (business_id, customer_number)
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    business_id INT REFERENCES businesses(id) ON DELETE CASCADE,
    customer_number TEXT NOT NULL,
    items JSONB NOT NULL DEFAULT '[]',
    subtotal NUMERIC,
    discount_applied NUMERIC DEFAULT 0,
    delivery_fee NUMERIC DEFAULT 0,
    total NUMERIC,
    fulfillment TEXT CHECK (fulfillment IN ('delivery', 'pickup')),
    address TEXT,
    payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
    payment_link TEXT,
    paystack_reference TEXT,
    is_test BOOLEAN DEFAULT FALSE,
    escalation_status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_catalog_items_business ON catalog_items(business_id);
CREATE INDEX IF NOT EXISTS idx_conversations_business_customer ON conversations(business_id, customer_number);
CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id);
CREATE INDEX IF NOT EXISTS idx_customer_bindings_number ON customer_bindings(customer_number);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_bindings_updated_at
    BEFORE UPDATE ON customer_bindings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
