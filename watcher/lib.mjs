// Pure helpers shared by the watcher and its tests.
// These mirror the extraction/normalization logic in bills.html so the
// watcher produces bill records identical to ones added through the web UI.
// This file has NO dependencies so it can be unit-tested without installing anything.

export const CATEGORIES = [
    'Utilities', 'Electric', 'Gas', 'Water', 'Internet/Phone', 'Insurance',
    'Rent/Mortgage', 'Loan', 'Fuel', 'Feed', 'Supplies', 'Equipment',
    'Taxes', 'Subscription', 'Medical', 'Other'
];

// File types Claude can read. Anything else is skipped (e.g. .heic).
export const MIME = {
    '.pdf':  'application/pdf',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
};

export function buildPrompt(categories = CATEGORIES) {
    const catList = categories.join(', ');
    return `This is a bill, invoice, utility statement, or receipt. Read it and return ONLY valid JSON (no markdown fences, no other text) with these fields:
{
  "vendor":"the company/biller name or empty",
  "amount":"total amount due as a plain number, no currency symbol or commas, or empty",
  "billDate":"the statement/invoice date as YYYY-MM-DD or empty",
  "dueDate":"the payment due date as YYYY-MM-DD or empty",
  "account":"account number or empty",
  "invoice":"invoice or bill number or empty",
  "category":"one of: ${catList} or empty",
  "notes":"one short sentence with anything else notable, or empty"
}
Only include values you can read with reasonable confidence; use an empty string when unsure.`;
}

// Normalize a raw AI JSON object into a clean bill record — identical rules to bills.html.
export function normalizeBill(d, categories = CATEGORIES) {
    const out = {};
    out.vendor  = (d.vendor  || '').toString().trim();
    out.account = (d.account || '').toString().trim();
    out.invoice = (d.invoice || '').toString().trim();
    out.notes   = (d.notes   || '').toString().trim();
    const amt = parseFloat(String(d.amount ?? '').replace(/[^0-9.]/g, ''));
    out.amount = Number.isFinite(amt) ? amt : 0;
    out.billDate = /^\d{4}-\d{2}-\d{2}$/.test(String(d.billDate ?? '').trim()) ? String(d.billDate).trim() : '';
    out.dueDate  = /^\d{4}-\d{2}-\d{2}$/.test(String(d.dueDate  ?? '').trim()) ? String(d.dueDate).trim()  : '';
    const cat = (d.category || '').toString().trim();
    out.category = categories.find(c => c.toLowerCase() === cat.toLowerCase()) || (cat ? 'Other' : '');
    return out;
}

// Pull the first {...} JSON object out of a model response.
export function parseJsonObject(text) {
    const m = (text || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not parse AI response (no JSON found)');
    return JSON.parse(m[0]);
}
