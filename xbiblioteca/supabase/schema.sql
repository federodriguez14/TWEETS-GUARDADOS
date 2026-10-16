-- =====================================================================
--  XBiblioteca — esquema de base de datos para Supabase (plan Free)
--  Pegar COMPLETO en: Supabase Dashboard → SQL Editor → New query → Run
--  Se puede ejecutar más de una vez sin romper nada (idempotente).
-- =====================================================================

-- ---------- Tabla de publicaciones ----------
create table if not exists public.posts (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url               text not null check (char_length(url) <= 500),
  tweet_id          text check (tweet_id ~ '^[0-9]{1,25}$'),
  author_name       text check (char_length(author_name) <= 200),
  author_handle     text check (char_length(author_handle) <= 50),
  text              text check (char_length(text) <= 10000),
  posted_at         timestamptz,
  note              text check (char_length(note) <= 20000),
  categories        text[] not null default '{}',
  tags              text[] not null default '{}',
  favorite          boolean not null default false,
  status            text not null default 'pendiente'
                    check (status in ('pendiente','leido','archivado')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),   -- reloj del dispositivo (resolver conflictos)
  deleted_at        timestamptz,                          -- borrado lógico, para sincronizar eliminaciones
  server_updated_at timestamptz not null default now()    -- reloj del servidor (descarga incremental)
);

-- ---------- Tabla de categorías personalizadas ----------
create table if not exists public.categories (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 60),
  color             text not null default '#4f7cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default now()
);

create index if not exists posts_user_sync_idx      on public.posts (user_id, server_updated_at);
create index if not exists categories_user_sync_idx on public.categories (user_id, server_updated_at);

-- ---------- Trigger de sincronización ----------
-- 1) Impide cambiar el dueño de una fila.
-- 2) "Gana la última edición": si llega una versión más vieja que la guardada, se ignora.
-- 3) Marca la hora del servidor para que los otros dispositivos descarguen el cambio.
create or replace function public.tg_sync_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id no se puede modificar';
    end if;
    if new.updated_at < old.updated_at then
      return null;  -- versión vieja: se descarta sin error
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists posts_sync_guard on public.posts;
create trigger posts_sync_guard before insert or update on public.posts
  for each row execute function public.tg_sync_guard();

drop trigger if exists categories_sync_guard on public.categories;
create trigger categories_sync_guard before insert or update on public.categories
  for each row execute function public.tg_sync_guard();

-- ---------- Seguridad: Row Level Security ----------
-- Cada usuario autenticado solo ve y modifica SUS filas. El rol anónimo no tiene acceso.
alter table public.posts      enable row level security;
alter table public.categories enable row level security;

revoke all on public.posts      from anon;
revoke all on public.categories from anon;
grant select, insert, update, delete on public.posts      to authenticated;
grant select, insert, update, delete on public.categories to authenticated;

do $$
declare t text;
begin
  foreach t in array array['posts','categories'] loop
    execute format('drop policy if exists %I on public.%I', t||'_select_own', t);
    execute format('drop policy if exists %I on public.%I', t||'_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t||'_update_own', t);
    execute format('drop policy if exists %I on public.%I', t||'_delete_own', t);

    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t||'_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t||'_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t||'_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t||'_delete_own', t);
  end loop;
end $$;

-- ---------- Keep-alive opcional (evita la pausa por inactividad) ----------
-- Solo registra la hora del último "ping". No expone ningún dato.
create table if not exists public.heartbeat (
  id        int primary key default 1 check (id = 1),
  last_ping timestamptz not null default now()
);
insert into public.heartbeat (id) values (1) on conflict (id) do nothing;
alter table public.heartbeat enable row level security;   -- sin políticas: nadie la lee por API
revoke all on public.heartbeat from anon, authenticated;

create or replace function public.keepalive()
returns text
language sql
security definer
set search_path = ''
as $$
  update public.heartbeat set last_ping = now() where id = 1;
  select 'ok'::text;
$$;
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
