(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.SalesCore = core;
})(typeof window === 'undefined' ? globalThis : window, function () {
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const currency = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dateLabel = date => date ? new Date(date + 'T12:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Sem registro';
  function number(value) {
    const text = String(value ?? '').trim();
    if (!text) return NaN;
    return Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
  }
  function cents(value) {
    const parsed = number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10000000 ? Math.round((parsed + Number.EPSILON) * 100) : NaN;
  }
  function totals(items, discount = 0, paid = 0) {
    if (!items.length || items.some(i => !i.product?.trim() || !['pacote','fardo','kg','un'].includes(i.unit) || !Number.isFinite(i.quantity) || i.quantity <= 0 || i.quantity > 1000000 || !Number.isSafeInteger(i.unit_price_cents) || i.unit_price_cents < 0)) throw new Error('Preencha produto, quantidade e preço de todos os itens.');
    const subtotal = items.reduce((sum, i) => sum + Math.round(i.quantity * i.unit_price_cents), 0);
    if (!Number.isSafeInteger(discount) || discount < 0 || discount >= subtotal) throw new Error('O desconto precisa ser menor que o valor dos produtos.');
    const total = subtotal - discount;
    if (!Number.isSafeInteger(paid) || paid < 0 || paid > total) throw new Error('O valor pago deve ficar entre zero e o total da venda.');
    return { subtotal, total, paid, balance: total - paid };
  }
  function clientStats(id, sales, visits, date = today()) {
    const purchases = sales.filter(s => s.client_id === id).sort((a,b) => b.delivered_on.localeCompare(a.delivered_on) || (b.created_at || '').localeCompare(a.created_at || ''));
    const last = purchases[0] || null;
    const lastVisit = visits.filter(v => v.client_id === id).map(v => v.visited_on).concat(last ? [last.delivered_on] : []).sort().pop() || null;
    return { last, lastVisit, balance: purchases.reduce((sum,s) => sum + Number(s.total_cents) - Number(s.paid_cents), 0), days: last ? Math.max(0, Math.floor((Date.parse(date + 'T12:00:00Z') - Date.parse(last.delivered_on + 'T12:00:00Z')) / 86400000)) : null, purchases };
  }
  function dashboard(sales, month) {
    const selected = sales.filter(s => s.delivered_on.startsWith(month));
    const received = sales.flatMap(s => s.payments || []).filter(p => p.paid_on.startsWith(month)).reduce((sum,p) => sum + Number(p.amount_cents), 0);
    return { sold: selected.reduce((sum,s) => sum + Number(s.total_cents), 0), received, balance: sales.reduce((sum,s) => sum + Number(s.total_cents) - Number(s.paid_cents), 0), deliveries: selected.length };
  }
  return { today, currency, dateLabel, number, cents, totals, clientStats, dashboard };
});
