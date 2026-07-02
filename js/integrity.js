import {
  getCategories, getProducts, db,
} from './db.js?v=212';
import { auditProductionData } from './calc.js?v=212';

const ISSUE_LABELS = {
  invalid_quantity: 'כמות לא תקינה ברישום',
  orphan_entry: 'רישום יתום (מוצר שנמחק)',
  duplicate_date_product: 'כפילות: אותו מוצר באותו יום',
  product_sum_mismatch: 'סכום לפי מוצר לא תואם לסה"כ',
  category_sum_mismatch: 'סכום לפי קטגוריה לא תואם לסה"כ',
  raw_qty_mismatch: 'סכום גולמי של רישומים לא תואם',
  category_product_mismatch: 'סכום קטגוריה לא תואם לסכום מוצריה',
  report_qty_mismatch: 'דוח Excel — כמות לא תואמת',
  report_val_mismatch: 'דוח Excel — ערך לא תואם',
};

export function formatAuditIssue(issue) {
  const label = ISSUE_LABELS[issue.kind] || issue.kind;
  const details = { ...issue };
  delete details.kind;
  const extra = Object.keys(details).length
    ? ` (${Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(', ')})`
    : '';
  return `${label}${extra}`;
}

export async function runProductionAudit() {
  const [categories, products, entries] = await Promise.all([
    getCategories(),
    getProducts(),
    db.productionEntries.toArray(),
  ]);

  const audit = auditProductionData(products, entries, categories);
  return { ...audit, categories, products, entries };
}
