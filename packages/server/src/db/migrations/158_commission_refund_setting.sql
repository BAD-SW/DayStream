-- Commission after a refund (THE-21): a business owner setting.
--
-- `commission.refund_clawback` = 'true' (default, chosen by David): when a sale is refunded,
-- the commission on the refunded part is taken back, in the pay period in which the refund
-- happens (a negative commission line on the day of the refund). Pay periods already
-- finalized are never changed. 'false': a refund changes no commission.
--
-- Until now a refunded or partly refunded sale earned no commission at all, even for the
-- lines that were not refunded, and the commission of a past period changed when a refund
-- was made later.

BEGIN;

INSERT INTO sys_configuration_definitions (key, category, data_type, default_value, description)
VALUES ('commission.refund_clawback', 'billing', 'boolean', 'true',
        'Payroll: when a sale is refunded, take the commission on the refunded part back (true) or keep it (false)')
ON CONFLICT (key) DO NOTHING;

COMMIT;
