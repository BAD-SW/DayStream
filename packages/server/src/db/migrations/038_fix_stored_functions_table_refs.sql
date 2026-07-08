-- Fix stored functions that still reference old table names after the prefix rename (migration 036).

BEGIN;

-- generate_customer_reference: referenced 'customers', now 'cus_customers'
CREATE OR REPLACE FUNCTION generate_customer_reference(p_business_id UUID)
RETURNS VARCHAR(20) AS $$
DECLARE
    next_num INTEGER;
    ref VARCHAR(20);
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(reference_number FROM 6) AS INTEGER)), 0) + 1
    INTO next_num
    FROM cus_customers
    WHERE business_id = p_business_id;

    ref := 'CUST-' || LPAD(next_num::TEXT, 4, '0');
    RETURN ref;
END;
$$ LANGUAGE plpgsql;

-- generate_booking_reference: referenced 'bookings', now 'apt_bookings'
CREATE OR REPLACE FUNCTION generate_booking_reference(p_business_id UUID)
RETURNS VARCHAR(20) AS $$
DECLARE
    current_year INTEGER;
    next_num INTEGER;
    ref VARCHAR(20);
BEGIN
    current_year := EXTRACT(YEAR FROM NOW());

    SELECT COALESCE(MAX(
        CAST(SUBSTRING(booking_reference FROM 9) AS INTEGER)
    ), 0) + 1
    INTO next_num
    FROM apt_bookings
    WHERE business_id = p_business_id
      AND booking_reference LIKE 'BK-' || current_year || '-%';

    ref := 'BK-' || current_year || '-' || LPAD(next_num::TEXT, 4, '0');
    RETURN ref;
END;
$$ LANGUAGE plpgsql;

COMMIT;
