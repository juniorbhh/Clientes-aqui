create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  category text not null check (category in ('padaria', 'supermercado', 'emporio', 'outro')),
  client_status text not null default 'nao_visitado' check (client_status in ('ativo', 'espera', 'nao_visitado')),
  address text,
  phone text,
  contact_name text,
  notes text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clients add column if not exists client_status text;
alter table public.clients alter column client_status set default 'nao_visitado';
update public.clients set client_status = 'ativo' where client_status is null;
alter table public.clients alter column client_status set not null;
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.clients'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%client_status%'
  loop
    execute format('alter table public.clients drop constraint %I', constraint_name);
  end loop;
end $$;
alter table public.clients add constraint clients_client_status_check
  check (client_status in ('ativo', 'espera', 'nao_visitado'));
update public.clients
set client_status = 'nao_visitado',
    notes = nullif(substr(notes, length('[[CLIENTES_AQUI_A_VISITAR]]' || chr(10)) + 1), '')
where client_status = 'espera' and notes like '[[CLIENTES_AQUI_A_VISITAR]]' || chr(10) || '%';

create index if not exists clients_user_id_created_at_idx
  on public.clients (user_id, created_at desc);

alter table public.clients enable row level security;

drop policy if exists "clients_select_own" on public.clients;
create policy "clients_select_own"
  on public.clients for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "clients_insert_own" on public.clients;
create policy "clients_insert_own"
  on public.clients for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "clients_update_own" on public.clients;
create policy "clients_update_own"
  on public.clients for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "clients_delete_own" on public.clients;
create policy "clients_delete_own"
  on public.clients for delete
  to authenticated
  using ((select auth.uid()) = user_id);
