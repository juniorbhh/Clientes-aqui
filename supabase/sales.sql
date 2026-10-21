begin;
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  delivered_on date not null,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null check (total_cents > 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0 and paid_cents <= total_cents),
  due_on date,
  notes text check (char_length(notes) <= 1000),
  payments jsonb not null default '[]'::jsonb check (jsonb_typeof(payments) = 'array'),
  created_at timestamptz not null default now()
);
create index if not exists sales_user_delivery_idx on public.sales(user_id, delivered_on desc);
create index if not exists sales_client_idx on public.sales(client_id);
alter table public.sales enable row level security;
drop policy if exists sales_own_select on public.sales;
create policy sales_own_select on public.sales for select to authenticated using (user_id = (select auth.uid()));
-- Writes go through the validated RPCs, never directly from the browser.
revoke all on public.sales from anon, authenticated;
grant select on public.sales to authenticated;

create table if not exists public.client_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  client_id uuid not null references public.clients(id) on delete restrict,
  visited_on date not null,
  reason text not null check (reason in ('Ainda tem estoque', 'Responsável ausente', 'Não quis comprar', 'Retornar depois', 'Outro')),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists visits_user_date_idx on public.client_visits(user_id, visited_on desc);
alter table public.client_visits enable row level security;
drop policy if exists visits_own_select on public.client_visits;
create policy visits_own_select on public.client_visits for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists visits_own_insert on public.client_visits;
create policy visits_own_insert on public.client_visits for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.clients c where c.id = client_id and c.user_id = (select auth.uid()))
);
revoke all on public.client_visits from anon, authenticated;
grant select, insert on public.client_visits to authenticated;

create or replace function public.register_sale(
 p_client_id uuid, p_delivered_on date, p_items jsonb, p_discount_cents bigint,
 p_paid_cents bigint, p_payment_method text, p_due_on date, p_notes text,
 p_id uuid
) returns public.sales language plpgsql security definer set search_path = '' as $$
declare item jsonb; subtotal bigint := 0; total bigint; result public.sales; uid uuid := auth.uid();
begin
 if uid is null or not exists(select 1 from public.clients where id=p_client_id and user_id=uid) then raise exception 'Cliente não encontrado nesta conta.'; end if;
 -- Client-generated UUID makes retried submissions idempotent.
 select * into result from public.sales where id=p_id and user_id=uid;
 if found then return result; end if;
 if p_delivered_on is null or p_delivered_on > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe uma data de entrega válida, até hoje.'; end if;
 if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Adicione pelo menos um produto.'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
   if nullif(trim(item->>'product'),'') is null or char_length(item->>'product') > 120
     or coalesce(item->>'unit','') not in ('pacote','fardo','kg','un')
     or coalesce((item->>'quantity')::numeric,0) <= 0 or (item->>'quantity')::numeric > 1000000
     or round((item->>'quantity')::numeric,3) <> (item->>'quantity')::numeric
     or coalesce((item->>'unit_price_cents')::numeric,-1) < 0
     or (item->>'unit_price_cents')::numeric > 1000000000
     or trunc((item->>'unit_price_cents')::numeric) <> (item->>'unit_price_cents')::numeric then raise exception 'Produto, quantidade ou preço inválido.'; end if;
   subtotal := subtotal + round((item->>'quantity')::numeric * (item->>'unit_price_cents')::numeric)::bigint;
 end loop;
 if subtotal > 9007199254740991 then raise exception 'Valor da venda muito alto.'; end if;
 if p_discount_cents is null or p_discount_cents < 0 or p_discount_cents >= subtotal then raise exception 'Desconto inválido.'; end if;
 total := subtotal-p_discount_cents;
 if p_paid_cents is null or p_paid_cents < 0 or p_paid_cents > total then raise exception 'Valor pago inválido.'; end if;
 if coalesce(p_payment_method,'') not in ('Pix','Dinheiro','Cartão','Boleto','Outro') then raise exception 'Selecione a forma de pagamento.'; end if;
 if p_paid_cents < total and (p_due_on is null or p_due_on < p_delivered_on) then raise exception 'Informe o vencimento do saldo pendente.'; end if;
 insert into public.sales(id,user_id,client_id,delivered_on,items,discount_cents,total_cents,paid_cents,due_on,notes,payments)
 values(p_id,uid,p_client_id,p_delivered_on,p_items,p_discount_cents,total,p_paid_cents,
   case when p_paid_cents < total then p_due_on else null end,nullif(trim(p_notes),''),
   case when p_paid_cents > 0 then jsonb_build_array(jsonb_build_object('amount_cents',p_paid_cents,'method',p_payment_method,'paid_on',p_delivered_on)) else '[]'::jsonb end)
 returning * into result;
 return result;
end $$;
revoke all on function public.register_sale(uuid,date,jsonb,bigint,bigint,text,date,text,uuid) from public, anon;
grant execute on function public.register_sale(uuid,date,jsonb,bigint,bigint,text,date,text,uuid) to authenticated;

create or replace function public.record_sale_payment(p_sale_id uuid,p_amount_cents bigint,p_method text,p_paid_on date,p_id uuid)
returns public.sales language plpgsql security definer set search_path = '' as $$
declare result public.sales;
begin
 select * into result from public.sales where id=p_sale_id and user_id=auth.uid() for update;
 if not found then raise exception 'Venda não encontrada nesta conta.'; end if;
 if exists(select 1 from jsonb_array_elements(result.payments) p where p->>'id'=p_id::text) then return result; end if;
 if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > result.total_cents-result.paid_cents then raise exception 'Valor maior que o saldo pendente ou inválido.'; end if;
 if p_paid_on is null or p_paid_on < result.delivered_on or p_paid_on > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe uma data de pagamento entre a entrega e hoje.'; end if;
 if coalesce(p_method,'') not in ('Pix','Dinheiro','Cartão','Boleto','Outro') then raise exception 'Forma de pagamento inválida.'; end if;
 update public.sales set paid_cents=paid_cents+p_amount_cents,
 payments=payments||jsonb_build_array(jsonb_build_object('id',p_id,'amount_cents',p_amount_cents,'method',p_method,'paid_on',p_paid_on))
 where id=p_sale_id returning * into result;
 return result;
end $$;
revoke all on function public.record_sale_payment(uuid,bigint,text,date,uuid) from public, anon;
grant execute on function public.record_sale_payment(uuid,bigint,text,date,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
