(() => {
  const C = window.SalesCore;
  const app = window.ClientesAqui;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const S = { sales: [], visits: [], loaded: false, loading: false, error: '', clientId: null, paymentSale: null, sequence: 0, saleId: null, visitId: null, paymentId: null, busy: false };
  const labels = { ativo: 'Ativo', espera: 'Em espera', nao_visitado: 'A visitar' };
  const units = { pacote: 'pacote(s)', fardo: 'fardo(s)', kg: 'kg', un: 'unidade(s)' };
  const empty = message => `<p class="business-empty">${esc(message)}</p>`;
  const client = id => app.getClients().find(c => c.id === id);
  const stats = id => C.clientStats(id, S.sales, S.visits);
  const amountInput = cents => (cents / 100).toFixed(2).replace('.', ',');
  const money = value => C.currency(value);
  const itemText = i => `${Number(i.quantity).toLocaleString('pt-BR')} ${units[i.unit] || i.unit} de ${i.product}`;
  function message(id, text) { $(id).textContent = text; $(id).hidden = !text; }
  let toastTimer;
  function toast(text) { clearTimeout(toastTimer); message('business-toast', text); toastTimer = setTimeout(() => message('business-toast', ''), 5000); }
  function showDialog(id) { const d = $(id); if (!d.open) d.showModal(); d.scrollTop = 0; }
  function isValidDate(date, min = '') { return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date + 'T12:00:00Z')) && date <= C.today() && (!min || date >= min); }
  async function allRows(table, order) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const page = await app.request(`/rest/v1/${table}?select=*&order=${order}&limit=500&offset=${offset}`);
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  async function load() {
    if (!app.getUserId()) return;
    const sequence = ++S.sequence;
    S.loading = true; S.error = '';
    message('sales-load-message', 'Carregando vendas e entregas…'); $('sales-retry').hidden = true;
    try {
      const results = await Promise.allSettled([allRows('sales', 'delivered_on.desc,created_at.desc'), allRows('client_visits', 'visited_on.desc,created_at.desc')]);
      if (sequence !== S.sequence || !app.getUserId()) return;
      const failed = results.find(r => r.status === 'rejected');
      if (failed) throw failed.reason;
      S.sales = results[0].value; S.visits = results[1].value; S.loaded = true;
      message('sales-load-message', '');
    } catch (error) {
      if (sequence !== S.sequence) return;
      S.error = 'Não foi possível carregar o histórico. Toque em tentar novamente.';
      message('sales-load-message', S.error); $('sales-retry').hidden = false;
      console.warn('Histórico indisponível:', error.code || error.status || error.message);
    } finally {
      if (sequence === S.sequence) { S.loading = false; render(); app.refreshMap(); }
    }
  }
  function requireLoaded() {
    if (S.loading || !S.loaded || S.error) { toast(S.loading ? 'Aguarde o carregamento do histórico.' : 'Carregue o histórico no Dashboard antes de registrar.'); return false; }
    return true;
  }
  function mapMatches(id) {
    if (!S.loaded || S.error) return true;
    const filter = $('activity-filter').value;
    const v = stats(id);
    if (filter === 'pending') return v.balance > 0;
    if (filter === 'never') return !v.last;
    if (filter === '15' || filter === '30') return v.days === null || v.days >= Number(filter);
    return true;
  }
  function popup(id) {
    if (!S.loaded || S.error) return `<div class="popup-sales"><small>${S.error ? 'Histórico indisponível no momento.' : 'Carregando histórico…'}</small></div>`;
    const v = stats(id);
    return `<div class="popup-sales"><small>Última entrega</small><strong>${v.last ? `${C.dateLabel(v.last.delivered_on)} · ${v.days === 0 ? 'hoje' : `há ${v.days} dias`}` : 'Sem compras registradas'}</strong>${v.last ? `<p>${esc(v.last.items.map(itemText).join(' · '))}</p><small>Compra: ${money(v.last.total_cents)} · Pago: ${money(v.last.paid_cents)}</small>` : ''}<small class="${v.balance ? 'balance-pending' : ''}">Saldo pendente: ${money(v.balance)}</small><div class="popup-business-actions"><button type="button" data-business-sale="${id}">Registrar venda</button><button type="button" data-business-visit="${id}">Visita sem venda</button><button type="button" data-business-profile="${id}">Ver histórico</button></div></div>`;
  }
  function render() {
    const month = $('dashboard-month').value || C.today().slice(0,7);
    const m = C.dashboard(S.sales, month);
    const cards = [['Vendido no mês', m.sold, 'Valor total das vendas', false], ['Recebido no mês', m.received, 'Pagamentos recebidos no período', false], ['A receber', m.balance, 'Saldo de todos os períodos', false], ['Entregas no mês', m.deliveries, 'Uma entrega por venda registrada', true]];
    $('dashboard-metrics').innerHTML = cards.map(([label,value,subtitle,count]) => `<article class="metric-card"><span>${label}</span><strong>${S.loaded && !S.error ? count ? value : money(value) : '—'}</strong><small>${subtitle}</small></article>`).join('');
    if (!S.loaded || S.error) {
      for (const id of ['dashboard-deliveries','dashboard-receivables','dashboard-followups','dashboard-products']) $(id).innerHTML = empty(S.error ? 'Histórico indisponível. Tente carregar novamente.' : 'Carregando…');
    } else {
      const monthSales = S.sales.filter(s => s.delivered_on.startsWith(month));
      $('dashboard-deliveries').innerHTML = monthSales.slice(0,8).map(s => `<button class="dashboard-row" type="button" data-business-profile="${s.client_id}"><span><strong>${esc(client(s.client_id)?.name || 'Cliente')}</strong><small>${C.dateLabel(s.delivered_on)} · ${s.items.length} produto(s)</small></span><b>${money(s.total_cents)}</b></button>`).join('') || empty('Nenhuma entrega neste período. Abra um cliente para registrar a primeira venda.');
      const pending = S.sales.filter(s => Number(s.total_cents) > Number(s.paid_cents)).sort((a,b) => (a.due_on || '9999').localeCompare(b.due_on || '9999'));
      $('dashboard-receivables').innerHTML = pending.slice(0,8).map(s => `<button class="dashboard-row" type="button" data-business-payment="${s.id}"><span><strong>${esc(client(s.client_id)?.name || 'Cliente')}</strong><small class="${s.due_on < C.today() ? 'balance-pending' : ''}">${s.due_on < C.today() ? 'Vencido em' : 'Vence em'} ${C.dateLabel(s.due_on)}</small></span><b>${money(s.total_cents-s.paid_cents)}</b></button>`).join('') || empty('Nenhum pagamento pendente.');
      const followups = app.getClients().map(c => ({...c, summary: stats(c.id)})).filter(c => c.summary.days !== null && c.summary.days >= 15).sort((a,b) => b.summary.days-a.summary.days);
      $('dashboard-followups').innerHTML = followups.slice(0,8).map(c => `<button class="dashboard-row" type="button" data-business-profile="${c.id}"><span><strong>${esc(c.name)}</strong><small>Última entrega: ${C.dateLabel(c.summary.last.delivered_on)}</small></span><b>${c.summary.days} dias</b></button>`).join('') || empty('Nenhum cliente com compra registrada há 15 dias ou mais.');
      const products = new Map();
      monthSales.flatMap(s => s.items).forEach(i => { const key = `${i.product.toLocaleLowerCase('pt-BR')}|${i.unit}`; const prev = products.get(key) || {...i, quantity:0}; prev.quantity += Number(i.quantity); products.set(key,prev); });
      const top = [...products.values()].sort((a,b) => b.quantity-a.quantity).slice(0,6);
      $('dashboard-products').innerHTML = top.map(i => `<div class="product-rank"><div><strong>${esc(i.product)}</strong><span>${Number(i.quantity).toLocaleString('pt-BR')} ${units[i.unit]}</span></div><div class="rank-track"><span style="width:${Math.max(3,Math.round(i.quantity/top[0].quantity*100))}%"></span></div></div>`).join('') || empty('Os produtos aparecerão conforme as vendas forem registradas.');
    }
    const shown = app.getVisibleCount ? app.getVisibleCount() : app.getClients().filter(c => mapMatches(c.id)).length;
    $('activity-filter-note').textContent = `${shown} de ${app.getClients().length} clientes`;
    $('activity-filter').disabled = !S.loaded || Boolean(S.error);
    if ($('client-profile-dialog').open) renderProfile();
  }
  function openProfile(id) {
    if (!client(id)) return;
    S.clientId = id;
    renderProfile(); showDialog('client-profile-dialog');
  }
  function renderProfile() {
    const c = client(S.clientId); if (!c) return;
    $('profile-title').textContent = c.name;
    const v = stats(c.id);
    const entries = [...v.purchases.map(s => ({kind:'sale',date:s.delivered_on,created:s.created_at,data:s})), ...S.visits.filter(x => x.client_id===c.id).map(x=>({kind:'visit',date:x.visited_on,created:x.created_at,data:x}))].sort((a,b)=>b.date.localeCompare(a.date) || (b.created || '').localeCompare(a.created || ''));
    $('client-profile-content').innerHTML = `<span class="client-status-badge status-${c.client_status}">${esc(labels[c.client_status] || 'Ativo')}</span><p class="profile-address">${esc(c.address || 'Endereço não informado')}</p>${c.phone ? `<p class="profile-contact">Telefone: ${esc(c.phone)}${c.contact_name ? ` · ${esc(c.contact_name)}` : ''}</p>` : ''}<div class="profile-summary"><div><small>Última entrega</small><strong>${v.last ? C.dateLabel(v.last.delivered_on) : 'Sem registro'}</strong></div><div><small>A receber</small><strong>${S.loaded && !S.error ? money(v.balance) : '—'}</strong></div><div><small>Última visita</small><strong>${C.dateLabel(v.lastVisit)}</strong></div></div><div class="profile-actions"><button class="primary-button" type="button" data-business-sale="${c.id}" ${S.loaded && !S.error ? '' : 'disabled'}>Registrar venda</button><button class="secondary-button" type="button" data-business-visit="${c.id}" ${S.loaded && !S.error ? '' : 'disabled'}>Visita sem venda</button></div><section class="profile-notes"><h3>Observações do cliente</h3><p>${esc(c.notes || 'Nenhuma observação cadastrada.')}</p></section><h3 class="history-title">Compras e visitas</h3>${S.error ? empty(S.error) : !S.loaded ? empty('Carregando histórico…') : entries.length ? entries.map(e => e.kind === 'visit' ? `<article class="history-visit"><span>Visita sem venda · ${C.dateLabel(e.date)}</span><strong>${esc(e.data.reason)}</strong>${e.data.notes ? `<p>${esc(e.data.notes)}</p>` : ''}</article>` : saleHistory(e.data)).join('') : empty('Nenhuma compra ou visita registrada para este cliente.')}`;
  }
  function saleHistory(s) {
    const balance = Number(s.total_cents)-Number(s.paid_cents);
    return `<details class="history-sale"><summary><span><strong>Entrega · ${C.dateLabel(s.delivered_on)}</strong><small>${balance ? `Pendente: ${money(balance)}` : 'Pagamento completo'}</small></span><b>${money(s.total_cents)}</b></summary><div class="history-sale-body"><ul>${s.items.map(i => `<li><span>${esc(itemText(i))}<small>${money(i.unit_price_cents)} por ${i.unit === 'un' ? 'unidade' : i.unit}</small></span><b>${money(C.lineTotal(i.quantity,i.unit_price_cents))}</b></li>`).join('')}</ul>${Number(s.discount_cents) ? `<p>Desconto: ${money(s.discount_cents)}</p>` : ''}<p>Pago: <strong>${money(s.paid_cents)}</strong></p>${balance ? `<p class="balance-pending">Saldo: ${money(balance)} · Vencimento: ${C.dateLabel(s.due_on)}</p><button class="secondary-button full" type="button" data-business-payment="${s.id}">Registrar pagamento</button>` : ''}${s.notes ? `<p class="preserve-lines">${esc(s.notes)}</p>` : ''}<h4>Recebimentos</h4>${s.payments.length ? s.payments.map(p => `<p class="payment-entry">${C.dateLabel(p.paid_on)} · ${esc(p.method)} <strong>${money(p.amount_cents)}</strong></p>`).join('') : '<p>Nenhum recebimento registrado.</p>'}</div></details>`;
  }
  function addItem() {
    if ($('sale-items').children.length >= 100) return;
    const row = document.createElement('div'); row.className = 'sale-item';
    row.innerHTML = `<div class="sale-item-header"><strong>Produto</strong><button type="button" class="remove-item" aria-label="Remover produto">Remover</button></div><label class="sr-only">Nome do produto</label><input aria-label="Nome do produto" data-product list="sale-products" maxlength="120" placeholder="Escolha ou digite o produto" required /><div class="item-fields"><label>Medida<select data-unit><option value="pacote">Pacote</option><option value="fardo">Fardo</option><option value="kg">Quilo</option><option value="un">Unidade</option></select></label><label>Quantidade<input data-quantity type="text" inputmode="decimal" value="1" required /></label><label>Preço por medida (R$)<input data-price type="text" inputmode="decimal" placeholder="0,00" required /></label></div><p class="item-line-total">Subtotal: <strong>R$ 0,00</strong></p>`;
    row.querySelector('.remove-item').addEventListener('click', () => { if ($('sale-items').children.length > 1) { row.remove(); updateTotals(); } else toast('A venda precisa de pelo menos um produto.'); });
    $('sale-items').append(row); updateTotals();
  }
  function readItems() {
    return [...$('sale-items').children].map(row => ({product:row.querySelector('[data-product]').value.trim(),unit:row.querySelector('[data-unit]').value,quantity:C.number(row.querySelector('[data-quantity]').value),unit_price_cents:C.cents(row.querySelector('[data-price]').value)}));
  }
  function updateTotals() {
    const items = readItems();
    [...$('sale-items').children].forEach((row,i) => { const value = C.lineTotal(items[i].quantity,items[i].unit_price_cents); row.querySelector('.item-line-total strong').textContent = money(Number.isFinite(value) ? Math.round(value) : 0); });
    const subtotal = items.reduce((s,i) => s+(Number.isFinite(C.lineTotal(i.quantity,i.unit_price_cents)) ? C.lineTotal(i.quantity,i.unit_price_cents) : 0),0);
    const total = Math.max(0, subtotal-(C.cents($('sale-discount').value)||0));
    const paid = C.cents($('sale-paid').value)||0;
    $('sale-total').innerHTML = `<small>Total da venda</small><strong>${money(total)}</strong><span>Saldo a receber: ${money(Math.max(0,total-paid))}</span>`;
    $('sale-due-label').hidden = total > 0 && paid >= total;
    return total;
  }
  function openSale(id) {
    if (!client(id) || !requireLoaded()) return;
    S.clientId = id; S.saleId = crypto.randomUUID(); $('sale-form').reset();
    $('sale-client-name').textContent = client(id).name; $('sale-date').value = C.today(); $('sale-date').max = C.today();
    $('sale-items').innerHTML = ''; addItem(); message('sale-error',''); showDialog('sale-dialog');
  }
  function openVisit(id) {
    if (!client(id) || !requireLoaded()) return;
    S.clientId = id; S.visitId = crypto.randomUUID(); $('visit-form').reset();
    $('visit-client-name').textContent = client(id).name; $('visit-date').value = C.today(); $('visit-date').max = C.today(); message('visit-error',''); showDialog('visit-dialog');
  }
  function openPayment(id) {
    const s = S.sales.find(x=>x.id===id); if (!s || !requireLoaded()) return;
    S.paymentSale = s; S.paymentId = crypto.randomUUID(); $('payment-form').reset();
    $('payment-balance').textContent = `${client(s.client_id)?.name || 'Cliente'} · Saldo: ${money(s.total_cents-s.paid_cents)}`;
    $('payment-amount').value = amountInput(s.total_cents-s.paid_cents); $('payment-date').value = C.today(); $('payment-date').max = C.today(); $('payment-date').min = s.delivered_on; message('payment-error',''); showDialog('payment-dialog');
  }
  async function persist(buttonId, errorId, action, dialogId, success) {
    if (S.busy) return;
    S.busy = true; const button = $(buttonId); button.disabled = true; message(errorId,'');
    try { await action(); $(dialogId).close(); await load(); toast(S.error ? `${success} O resumo ainda não atualizou; tente carregar novamente.` : success); }
    catch (error) { message(errorId, error.message === 'Failed to fetch' || error.message === 'Load failed' ? 'Falha de conexão. Tente novamente; o mesmo registro não será duplicado.' : error.message); }
    finally { S.busy = false; button.disabled = false; }
  }
  $('sale-form').addEventListener('submit', event => {
    event.preventDefault();
    let t, items;
    try {
      if (!isValidDate($('sale-date').value)) throw new Error('Informe uma data de entrega válida, até hoje.');
      items=readItems(); t=C.totals(items,C.cents($('sale-discount').value || '0'),C.cents($('sale-paid').value || '0'));
      if (t.balance && (!$('sale-due').value || $('sale-due').value < $('sale-date').value)) throw new Error('Informe o vencimento do saldo, a partir da data de entrega.');
    } catch (error) { message('sale-error',error.message); return; }
    void persist('sale-save','sale-error',()=>app.request('/rest/v1/rpc/register_sale',{method:'POST',body:{p_id:S.saleId,p_client_id:S.clientId,p_delivered_on:$('sale-date').value,p_items:items,p_discount_cents:C.cents($('sale-discount').value || '0'),p_paid_cents:t.paid,p_payment_method:$('sale-method').value,p_due_on:t.balance ? $('sale-due').value : null,p_notes:$('sale-notes').value.trim()}}),'sale-dialog','Venda e entrega registradas.');
  });
  $('visit-form').addEventListener('submit', event => {
    event.preventDefault(); if (!isValidDate($('visit-date').value)) { message('visit-error','Informe uma data de visita válida, até hoje.'); return; }
    void persist('visit-save','visit-error',()=>app.request('/rest/v1/client_visits',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:{id:S.visitId,client_id:S.clientId,visited_on:$('visit-date').value,reason:$('visit-reason').value,notes:$('visit-notes').value.trim() || null}}),'visit-dialog','Visita registrada.');
  });
  $('payment-form').addEventListener('submit', event => {
    event.preventDefault(); const amount=C.cents($('payment-amount').value);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount>S.paymentSale.total_cents-S.paymentSale.paid_cents) { message('payment-error','Informe um valor maior que zero, até o saldo pendente.'); return; }
    if (!isValidDate($('payment-date').value,S.paymentSale.delivered_on)) { message('payment-error','Informe uma data entre a entrega e hoje.'); return; }
    void persist('payment-save','payment-error',()=>app.request('/rest/v1/rpc/record_sale_payment',{method:'POST',body:{p_sale_id:S.paymentSale.id,p_amount_cents:amount,p_method:$('payment-method').value,p_paid_on:$('payment-date').value,p_id:S.paymentId}}),'payment-dialog','Pagamento registrado.');
  });
  $('sale-add-item').addEventListener('click', addItem);
  $('sale-form').addEventListener('input', updateTotals);
  $('sale-paid-full').addEventListener('click', () => { $('sale-paid').value=amountInput(updateTotals()); updateTotals(); });
  $('dashboard-month').value=C.today().slice(0,7);
  $('dashboard-month').addEventListener('change',render);
  $('sales-retry').addEventListener('click',()=>void load());
  $('dashboard-open-clients').addEventListener('click',()=>app.showView('clients'));
  $('activity-filter').addEventListener('change',()=>{render();app.refreshMap();});
  document.addEventListener('click', event => {
    const target=event.target.closest('[data-business-profile],[data-business-sale],[data-business-visit],[data-business-payment],[data-close-dialog]'); if (!target) return;
    if (target.hasAttribute('data-close-dialog')) { if (!S.busy) target.closest('dialog').close(); }
    else if (target.dataset.businessProfile) openProfile(target.dataset.businessProfile);
    else if (target.dataset.businessSale) openSale(target.dataset.businessSale);
    else if (target.dataset.businessVisit) openVisit(target.dataset.businessVisit);
    else if (target.dataset.businessPayment) openPayment(target.dataset.businessPayment);
  });
  document.querySelectorAll('.business-dialog').forEach(dialog=>dialog.addEventListener('cancel',event=>{if(S.busy)event.preventDefault();}));
  document.addEventListener('clientes:updated',()=>void load());
  document.addEventListener('clientes:signed-out',()=>{S.sequence++;S.sales=[];S.visits=[];S.loaded=false;S.error='';S.loading=false;document.querySelectorAll('.business-dialog[open]').forEach(d=>d.close());render();});
  window.ClientesAquiSales={matches:mapMatches,popup,openProfile};
  render();
})();
