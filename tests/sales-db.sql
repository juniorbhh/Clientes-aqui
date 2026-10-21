begin;
do $$
declare uid uuid; cid uuid := gen_random_uuid(); sid uuid := gen_random_uuid(); pid uuid := gen_random_uuid(); result public.sales; blocked boolean := false;
begin
 uid := (select id from auth.users order by created_at limit 1);
 if uid is null then raise exception 'Conta de teste indisponível'; end if;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 insert into public.clients(id,user_id,name,category,latitude,longitude) values(cid,uid,'VERIFICACAO TEMPORARIA','outro',-19.9,-43.9);
 result := public.register_sale(cid,(now() at time zone 'America/Sao_Paulo')::date,'[{"product":"Palha","unit":"kg","quantity":1.5,"unit_price_cents":2500},{"product":"Pimentinha","unit":"fardo","quantity":2,"unit_price_cents":3300}]'::jsonb,350,5000,'Pix',(now() at time zone 'America/Sao_Paulo')::date+7,null,sid);
 if result.total_cents<>10000 or result.paid_cents<>5000 or result.payment_method<>'Pix' then raise exception 'Erro no cálculo'; end if;
 result := public.record_sale_payment(sid,2000,'Dinheiro',(now() at time zone 'America/Sao_Paulo')::date,pid);
 result := public.record_sale_payment(sid,2000,'Dinheiro',(now() at time zone 'America/Sao_Paulo')::date,pid);
 if result.paid_cents<>7000 then raise exception 'Pagamento duplicado'; end if;
 begin
   perform public.record_sale_payment(sid,4000,'Pix',(now() at time zone 'America/Sao_Paulo')::date,gen_random_uuid());
 exception when others then blocked := true;
 end;
 if not blocked then raise exception 'Pagamento acima do saldo não foi bloqueado'; end if;
 result := public.register_sale(cid,(now() at time zone 'America/Sao_Paulo')::date,'[{"product":"Pimentinha","unit":"fardo","quantity":2,"line_total_cents":6600}]'::jsonb,0,0,'Vale',(now() at time zone 'America/Sao_Paulo')::date+7,null,gen_random_uuid());
 if result.total_cents<>6600 or result.paid_cents<>0 or jsonb_array_length(result.payments)<>0 or result.payment_method<>'Vale' then raise exception 'Vale ou preço total incorreto'; end if;
 blocked := false;
 begin
   perform public.register_sale(cid,(now() at time zone 'America/Sao_Paulo')::date,'[{"product":"Pimentinha","unit":"fardo","quantity":2,"line_total_cents":6600}]'::jsonb,0,100,'Vale',(now() at time zone 'America/Sao_Paulo')::date+7,null,gen_random_uuid());
 exception when others then blocked := true;
 end;
 if not blocked then raise exception 'Vale aceitou recebimento'; end if;
 result := public.register_sale(cid,(now() at time zone 'America/Sao_Paulo')::date,'[{"product":"Pimentinha","unit":"fardo","quantity":2,"line_total_cents":6600}]'::jsonb,100,6500,'Pix',null,null,gen_random_uuid());
 if result.total_cents<>6500 or result.paid_cents<>6500 or result.due_on is not null then raise exception 'Pagamento completo incorreto'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 blocked := false;
 begin
   perform public.register_sale(cid,(now() at time zone 'America/Sao_Paulo')::date,'[{"product":"Palha","unit":"kg","quantity":1,"unit_price_cents":1000}]'::jsonb,0,1000,'Pix',null,null,gen_random_uuid());
 exception when others then blocked := true;
 end;
 if not blocked then raise exception 'Outra conta acessou o cliente'; end if;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
select not exists(select 1 from public.sales) as isolamento_por_conta,
       has_table_privilege('authenticated','public.sales','select') as leitura_autenticada,
       not has_table_privilege('authenticated','public.sales','insert') as gravacao_so_por_funcao;
reset role;
rollback;
