-- Checkout module: Orders and Order Items
-- Cart-based checkout with per-line-item staff attribution for compensation tracking

BEGIN;

-- ============================================================
-- 1. Orders (the cart / receipt)
-- ============================================================

CREATE TABLE IF NOT EXISTS fin_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES sys_businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES cus_customers(id) ON DELETE SET NULL,
    booking_id UUID REFERENCES apt_bookings(id) ON DELETE SET NULL,
    order_number VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'completed', 'voided', 'refunded')),
    subtotal INTEGER NOT NULL DEFAULT 0,
    tax_amount INTEGER NOT NULL DEFAULT 0,
    discount_amount INTEGER NOT NULL DEFAULT 0,
    total_amount INTEGER NOT NULL DEFAULT 0,
    payment_method VARCHAR(30) DEFAULT 'cash'
        CHECK (payment_method IN ('cash', 'card', 'transfer', 'other')),
    payment_reference VARCHAR(100),
    notes TEXT,
    checked_out_by UUID REFERENCES usr_users(id),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fin_orders_business ON fin_orders(business_id);
CREATE INDEX IF NOT EXISTS idx_fin_orders_customer ON fin_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_fin_orders_booking ON fin_orders(booking_id);
CREATE INDEX IF NOT EXISTS idx_fin_orders_status ON fin_orders(business_id, status);

-- ============================================================
-- 2. Order Items (line items in the cart)
-- ============================================================

CREATE TABLE IF NOT EXISTS fin_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES fin_orders(id) ON DELETE CASCADE,
    item_type VARCHAR(20) NOT NULL
        CHECK (item_type IN ('service', 'product', 'membership', 'package')),
    item_id UUID,
    item_name VARCHAR(200) NOT NULL,
    variant_name VARCHAR(100),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL DEFAULT 0,
    discount_amount INTEGER NOT NULL DEFAULT 0,
    tax_amount INTEGER NOT NULL DEFAULT 0,
    total_price INTEGER NOT NULL DEFAULT 0,
    credited_to UUID REFERENCES usr_users(id),
    booking_id UUID REFERENCES apt_bookings(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fin_order_items_order ON fin_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_fin_order_items_credited ON fin_order_items(credited_to);
CREATE INDEX IF NOT EXISTS idx_fin_order_items_type ON fin_order_items(item_type, item_id);

-- ============================================================
-- 3. Order number sequence
-- ============================================================

CREATE OR REPLACE FUNCTION generate_order_number(p_business_id UUID)
RETURNS VARCHAR(20) AS $$
DECLARE
    seq_val INTEGER;
    year_str VARCHAR(4);
BEGIN
    year_str := TO_CHAR(NOW(), 'YYYY');
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(order_number FROM 'ORD-[0-9]{4}-([0-9]+)') AS INTEGER)
    ), 0) + 1
    INTO seq_val
    FROM fin_orders
    WHERE business_id = p_business_id
      AND order_number LIKE 'ORD-' || year_str || '-%';
    RETURN 'ORD-' || year_str || '-' || LPAD(seq_val::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

COMMIT;
