begin;
alter table public.sales drop constraint if exists sales_payment_method_check;
alter table public.sales add constraint sales_payment_method_check check (payment_method in ('Pix','Dinheiro','Cartão','Boleto','Outro','Vale'));
create or replace function public.register_sale(
 p_client_id uuid, p_delivered_on date, p_items jsonb, p_discount_cents bigint,
 p_paid_cents bigint, p_payment_method text, p_due_on date, p_notes text,
 p_id uuid
) returns public.sales language plpgsql security definer set search_path = '' as $$
declare item jsonb; item_price numeric; item_amount numeric; subtotal bigint := 0; total bigint; result public.sales; uid uuid := auth.uid();
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
     then raise exception 'Produto ou quantidade inválida.'; end if;
   if item ? 'line_total_cents' then
     item_price := coalesce((item->>'line_total_cents')::numeric,-1);
     item_amount := item_price;
   else
     item_price := coalesce((item->>'unit_price_cents')::numeric,-1);
     item_amount := round((item->>'quantity')::numeric * item_price);
   end if;
   if item_price < 0 or item_price > 1000000000 or trunc(item_price) <> item_price or item_price = 'NaN'::numeric then raise exception 'Preço inválido.'; end if;
   subtotal := subtotal + item_amount::bigint;
 end loop;
 if subtotal > 9007199254740991 then raise exception 'Valor da venda muito alto.'; end if;
 if p_discount_cents is null or p_discount_cents < 0 or p_discount_cents >= subtotal then raise exception 'Desconto inválido.'; end if;
 total := subtotal-p_discount_cents;
 if p_paid_cents is null or p_paid_cents < 0 or p_paid_cents > total then raise exception 'Valor pago inválido.'; end if;
 if coalesce(p_payment_method,'') not in ('Pix','Dinheiro','Cartão','Boleto','Outro','Vale') then raise exception 'Selecione a forma de pagamento.'; end if;
 if p_payment_method = 'Vale' and p_paid_cents <> 0 then raise exception 'Vale deve ter valor recebido igual a zero.'; end if;
 if p_paid_cents < total and (p_due_on is null or p_due_on < p_delivered_on) then raise exception 'Informe o vencimento do saldo pendente.'; end if;
 insert into public.sales(id,user_id,client_id,delivered_on,items,discount_cents,total_cents,paid_cents,payment_method,due_on,notes,payments)
 values(p_id,uid,p_client_id,p_delivered_on,p_items,p_discount_cents,total,p_paid_cents,p_payment_method,
   case when p_paid_cents < total then p_due_on else null end,nullif(trim(p_notes),''),
   case when p_paid_cents > 0 then jsonb_build_array(jsonb_build_object('amount_cents',p_paid_cents,'method',p_payment_method,'paid_on',p_delivered_on)) else '[]'::jsonb end)
 returning * into result;
 return result;
end $$;
notify pgrst, 'reload schema';
commit;
