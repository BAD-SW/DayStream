import { adminPool } from '../db/pool';

interface CreateVendorInput {
  businessId: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  paymentTerms?: number;
  category?: string;
  notes?: string;
}

export async function createVendor(input: CreateVendorInput) {
  const { rows } = await adminPool.query(
    `INSERT INTO vendors (business_id, name, contact_name, email, phone, address, tax_id, payment_terms, category, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [input.businessId, input.name, input.contactName||null, input.email||null, input.phone||null, input.address||null, input.taxId||null, input.paymentTerms??30, input.category||null, input.notes||null],
  );
  return rows[0];
}

export async function getVendors(businessId: string) {
  const { rows } = await adminPool.query(
    `SELECT v.*, COALESCE((SELECT SUM(b.amount)::int FROM bills b WHERE b.vendor_id = v.id AND b.status = 'paid'), 0) AS total_spend,
            COALESCE((SELECT SUM(b.amount - b.amount_paid)::int FROM bills b WHERE b.vendor_id = v.id AND b.status NOT IN ('paid','void')), 0) AS outstanding
     FROM vendors v WHERE v.business_id = $1 AND v.status = 'active' ORDER BY v.name`,
    [businessId],
  );
  return rows;
}

export async function updateVendor(id: string, businessId: string, updates: Record<string, any>) {
  const { rows: existing } = await adminPool.query('SELECT * FROM vendors WHERE id = $1 AND business_id = $2', [id, businessId]);
  if (existing.length === 0) return null;
  const allowed: Record<string, string> = { name:'name', contact_name:'contact_name', email:'email', phone:'phone', address:'address', tax_id:'tax_id', payment_terms:'payment_terms', category:'category', notes:'notes', status:'status' };
  const fields: string[] = []; const values: any[] = []; let idx = 1;
  for (const [k,v] of Object.entries(updates)) { if (allowed[k]) { fields.push(`${allowed[k]} = $${idx++}`); values.push(v); } }
  if (fields.length === 0) return existing[0];
  fields.push('updated_at = NOW()'); values.push(id); values.push(businessId);
  const { rows } = await adminPool.query(`UPDATE vendors SET ${fields.join(', ')} WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`, values);
  return rows[0];
}
