create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin_geral', 'sindico', 'subsindico', 'proprietario', 'inquilino');
  elsif not exists (
    select 1
    from pg_enum
    where enumlabel = 'admin_geral'
      and enumtypid = 'user_role'::regtype
  ) then
    alter type user_role add value 'admin_geral' before 'sindico';
  end if;

  if not exists (select 1 from pg_type where typname = 'expense_status') then
    create type expense_status as enum ('open', 'paid', 'canceled');
  end if;

  if not exists (select 1 from pg_type where typname = 'invoice_status') then
    create type invoice_status as enum ('pending_provider', 'issued', 'paid', 'overdue', 'canceled');
  end if;
end $$;

create table if not exists condominiums (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text unique,
  address text,
  created_at timestamptz not null default now()
);

alter table condominiums add column if not exists phone text;
alter table condominiums add column if not exists email text;

create table if not exists whatsapp_integrations (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null unique references condominiums(id) on delete cascade,
  phone_number_id text not null,
  access_token text not null,
  business_account_id text,
  template_name text not null default 'aviso_condominio',
  template_language text not null default 'pt_BR',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists unit_types (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  name text not null,
  fee_cents integer not null check (fee_cents > 0),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (condominium_id, name)
);

create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (condominium_id, name)
);

create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  block_id uuid not null references blocks(id) on delete cascade,
  number text not null,
  unit_type_id uuid references unit_types(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (block_id, number)
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role user_role not null default 'proprietario',
  condominium_id uuid references condominiums(id) on delete set null,
  full_name text,
  cpf text,
  email text,
  phone text,
  unit text,
  unit_type_id uuid references unit_types(id) on delete set null,
  street text,
  address_number text,
  address_complement text,
  neighborhood text,
  city text,
  state char(2),
  postal_code text,
  created_at timestamptz not null default now()
);

alter table users add column if not exists cpf text;
alter table users add column if not exists unit_type_id uuid references unit_types(id) on delete set null;
alter table users add column if not exists street text;
alter table users add column if not exists address_number text;
alter table users add column if not exists address_complement text;
alter table users add column if not exists neighborhood text;
alter table users add column if not exists city text;
alter table users add column if not exists state char(2);
alter table users add column if not exists postal_code text;
alter table users add column if not exists login_enabled boolean not null default true;
alter table users add column if not exists billing_exempt boolean not null default false;
alter table users add column if not exists preferred_due_day smallint not null default 10 check (preferred_due_day in (10,20));
alter table users add column if not exists unit_id uuid references units(id) on delete set null;
alter table users add column if not exists must_change_password boolean not null default false;
alter table users add column if not exists deleted_at timestamptz;
alter table users add column if not exists terms_accepted_version text;
alter table users add column if not exists terms_accepted_at timestamptz;
alter table users add column if not exists tour_completed_version text;
alter table users add column if not exists tour_completed_at timestamptz;

create table if not exists user_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  unique (user_id, terms_version)
);

create table if not exists user_tour_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  tour_version text not null,
  completed_at timestamptz not null default now(),
  unique (user_id, tour_version)
);

create table if not exists unit_occupancies (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  is_representative boolean not null default false,
  started_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists unit_occupancies_active_user
  on unit_occupancies(unit_id, user_id) where ended_at is null;
create unique index if not exists unit_occupancies_one_representative
  on unit_occupancies(unit_id) where ended_at is null and is_representative = true;

-- Posse de unidade, separada de moradia (unit_occupancies acima). Um
-- proprietário que não mora na unidade não deve virar "morador" para fins
-- de avisos/enquetes/ocorrências, mas precisa ver (não pagar/gerenciar) os
-- débitos daquela unidade — daí a tabela dedicada.
create table if not exists unit_ownerships (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  owner_user_id uuid not null references users(id) on delete cascade,
  started_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists unit_ownerships_active_owner
  on unit_ownerships(unit_id, owner_user_id) where ended_at is null;

create table if not exists polls (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','open','closed','canceled')),
  closes_at timestamptz,
  created_by uuid not null references users(id) on delete restrict,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  label text not null,
  position smallint not null check (position >= 0),
  unique (poll_id, position)
);

create table if not exists poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  option_id uuid not null references poll_options(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (poll_id, user_id)
);

create index if not exists polls_condominium_idx on polls(condominium_id, status, created_at desc);
create index if not exists poll_options_poll_idx on poll_options(poll_id, position);
create index if not exists poll_votes_poll_idx on poll_votes(poll_id, option_id);

create table if not exists reservable_spaces (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  name text not null,
  description text,
  rules text,
  capacity integer check (capacity is null or capacity > 0),
  available_from time not null default '08:00',
  available_until time not null default '23:00',
  active boolean not null default true,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (condominium_id, name)
);
alter table reservable_spaces add column if not exists available_from time not null default '08:00';
alter table reservable_spaces add column if not exists available_until time not null default '23:00';

create table if not exists space_reservations (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  space_id uuid not null references reservable_spaces(id) on delete restrict,
  requested_by uuid not null references users(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  purpose text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','canceled')),
  reviewed_by uuid references users(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists space_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  space_id uuid not null references reservable_spaces(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists reservable_spaces_condo_idx on reservable_spaces(condominium_id, active, name);
create index if not exists space_reservations_schedule_idx on space_reservations(space_id, starts_at, ends_at) where status in ('pending','approved');
create index if not exists space_schedule_blocks_idx on space_schedule_blocks(space_id, starts_at, ends_at);

-- A tipologia pertence à unidade. Migra vínculos antigos e remove a cópia da pessoa.
update units target
set unit_type_id = legacy.unit_type_id
from users legacy
where legacy.unit_id = target.id
  and target.unit_type_id is null
  and legacy.unit_type_id is not null;
update users set unit_type_id = null where unit_id is not null and unit_type_id is not null;

-- Perfis extras de um mesmo login (ex.: síndico que também é proprietário
-- de uma unidade). O perfil "padrão" continua sendo role/condominium_id
-- direto na linha de `users`; esta tabela só guarda os adicionais, trocados
-- manualmente via POST /auth/switch-profile. MVP: mesmo condomínio da
-- pessoa (ver check abaixo não cobre isso — validado na rota de concessão).
create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role user_role not null,
  condominium_id uuid not null references condominiums(id) on delete cascade,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (role <> 'admin_geral')
);

create unique index if not exists user_profiles_unique
  on user_profiles(user_id, role, condominium_id);

create table if not exists refresh_tokens (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Perfil ativo desta sessão (null = padrão). Sem isso, um /auth/refresh em
-- segundo plano (o app já faz isso silenciosamente) reverteria o usuário
-- para o perfil padrão no meio de uma sessão trocada via switch-profile.
alter table refresh_tokens add column if not exists active_profile_id uuid references user_profiles(id) on delete set null;

create table if not exists password_reset_tokens (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_tokens_user_idx
  on password_reset_tokens(user_id, created_at desc);
create index if not exists users_email_normalized_idx
  on users(lower(email)) where email is not null;

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid references condominiums(id) on delete cascade,
  description text not null,
  category text not null default 'geral',
  amount_cents integer not null check (amount_cents > 0),
  due_date date not null,
  status expense_status not null default 'open',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid references condominiums(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  expense_id uuid references expenses(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  due_date date not null,
  status invoice_status not null default 'pending_provider',
  provider text not null default 'inter',
  external_id text,
  digitable_line text,
  pdf_url text,
  barcode text,
  pix_copy_paste text,
  paid_at timestamptz,
  paid_amount_cents integer,
  batch_id uuid,
  created_at timestamptz not null default now()
);

alter table invoices add column if not exists barcode text;
alter table invoices add column if not exists pix_copy_paste text;
alter table invoices add column if not exists paid_at timestamptz;
alter table invoices add column if not exists paid_amount_cents integer;
alter table invoices add column if not exists batch_id uuid;
alter table invoices add column if not exists reference_month date;
alter table invoices add column if not exists cancellation_reason text;

-- Marca quando o lembrete de "vence em 3 dias" já foi enviado, para o job
-- diário nunca notificar o mesmo boleto duas vezes. O aviso de "venceu" não
-- precisa de marcador equivalente: a própria transição de status pending_provider/issued
-- -> overdue só acontece uma vez (idempotente pelo WHERE), então dispara a notificação nesse momento.
alter table invoices add column if not exists due_soon_notified_at timestamptz;

create table if not exists debt_agreements (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  debtor_user_id uuid not null references users(id) on delete restrict,
  unit_id uuid references units(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','sent','accepted','active','at_risk','breached','settled','rejected','expired','canceled')),
  original_total_cents integer not null check (original_total_cents > 0),
  negotiated_total_cents integer not null check (negotiated_total_cents > 0),
  down_payment_cents integer not null default 0 check (down_payment_cents >= 0),
  installment_count integer not null check (installment_count between 1 and 60),
  first_due_date date not null,
  notes text,
  valid_until date,
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references users(id) on delete set null,
  breached_at timestamptz,
  breach_reason text,
  settled_at timestamptz,
  canceled_all_boletos_at timestamptz,
  cancellation_reason text,
  recalculated_total_cents integer,
  days_late_at_cancellation integer,
  fine_percent_at_cancellation numeric,
  daily_interest_percent_at_cancellation numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table debt_agreements add column if not exists canceled_all_boletos_at timestamptz;
alter table debt_agreements add column if not exists cancellation_reason text;
alter table debt_agreements add column if not exists recalculated_total_cents integer;
alter table debt_agreements add column if not exists days_late_at_cancellation integer;
alter table debt_agreements add column if not exists fine_percent_at_cancellation numeric;
alter table debt_agreements add column if not exists daily_interest_percent_at_cancellation numeric;

create table if not exists debt_agreement_items (
  agreement_id uuid not null references debt_agreements(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete restrict,
  principal_cents integer not null,
  fine_cents integer not null,
  interest_cents integer not null,
  frozen_total_cents integer not null,
  frozen_at date not null,
  primary key (agreement_id,invoice_id)
);

create table if not exists debt_agreement_installments (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references debt_agreements(id) on delete cascade,
  installment_number integer not null,
  amount_cents integer not null check (amount_cents > 0),
  due_date date not null,
  invoice_id uuid references invoices(id) on delete set null,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  unique(agreement_id,installment_number)
);

alter table debt_agreement_installments add column if not exists cancellation_reason text;

create table if not exists debt_communications (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  agreement_id uuid references debt_agreements(id) on delete set null,
  user_id uuid not null references users(id) on delete cascade,
  invoice_ids uuid[] not null default '{}',
  channel text not null check (channel in ('whatsapp','app','email')),
  message text not null,
  status text not null default 'prepared' check (status in ('prepared','sent','delivered','read','failed')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table invoices add column if not exists invoice_type text not null default 'regular';
alter table invoices add column if not exists agreement_id uuid references debt_agreements(id) on delete set null;
alter table invoices drop constraint if exists invoices_invoice_type_check;
alter table invoices add constraint invoices_invoice_type_check check (invoice_type in ('regular','agreement','legacy'));

alter table invoices add column if not exists negotiation_type text;
alter table invoices add column if not exists judicial_process_number text;
alter table invoices add column if not exists notes text;
alter table invoices drop constraint if exists invoices_negotiation_type_check;
alter table invoices add constraint invoices_negotiation_type_check check (negotiation_type is null or negotiation_type in ('private','judicial'));
create index if not exists debt_agreements_condominium_idx on debt_agreements(condominium_id,status,created_at desc);
create index if not exists debt_communications_user_idx on debt_communications(user_id,created_at desc);

-- Edição/exclusão manual de débitos e acordos (Gestão de débitos): soft-delete
-- auditável, nunca DELETE físico, para preservar rastreabilidade de dados
-- financeiros.
alter table invoices add column if not exists deleted_at timestamptz;
alter table invoices add column if not exists deleted_by uuid references users(id) on delete set null;
alter table invoices add column if not exists deletion_reason text;

alter table debt_agreements add column if not exists deleted_at timestamptz;
alter table debt_agreements add column if not exists deleted_by uuid references users(id) on delete set null;

alter table debt_agreement_installments add column if not exists canceled_at timestamptz;
alter table debt_agreement_installments add column if not exists canceled_by uuid references users(id) on delete set null;

-- Trilha de auditoria de edições, pagamentos parciais e exclusões manuais de
-- um débito (invoice), sempre com motivo e autor.
create table if not exists invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  condominium_id uuid not null references condominiums(id) on delete cascade,
  type text not null check (type in ('edit','partial_payment','delete')),
  amount_cents integer,
  previous_amount_cents integer,
  previous_due_date date,
  previous_status invoice_status,
  reason text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists invoice_adjustments_invoice_idx on invoice_adjustments(invoice_id, created_at desc);

create table if not exists billing_settings (
  condominium_id uuid primary key references condominiums(id) on delete cascade,
  description_template text not null default 'Taxa condominial - {tipologia}',
  receive_boleto boolean not null default true,
  receive_pix boolean not null default true,
  allow_after_due boolean not null default true,
  days_after_due integer not null default 30 check (days_after_due between 0 and 60),
  fine_type text not null default 'NONE' check (fine_type in ('NONE', 'PERCENT', 'FIXED')),
  fine_value numeric(12,2) not null default 0,
  interest_type text not null default 'NONE' check (interest_type in ('NONE', 'PERCENT_MONTH', 'FIXED')),
  interest_value numeric(12,2) not null default 0,
  discount_type text not null default 'NONE' check (discount_type in ('NONE', 'PERCENT', 'FIXED')),
  discount_value numeric(12,2) not null default 0,
  discount_days integer not null default 0 check (discount_days between 0 and 60),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists billing_batches (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  due_date date not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'processing', 'completed', 'partial', 'canceled')),
  total_items integer not null default 0,
  total_amount_cents bigint not null default 0,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table billing_batches alter column due_date drop not null;
alter table billing_batches add column if not exists reference_month date;
alter table billing_batches add column if not exists beneficiary_name text;
alter table billing_batches add column if not exists beneficiary_document text;

alter table billing_batches drop constraint if exists billing_batches_status_check;
alter table billing_batches add constraint billing_batches_status_check
  check (status in ('draft', 'validated', 'confirmed', 'processing', 'completed', 'partial', 'canceled'));

create table if not exists billing_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references billing_batches(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  document text not null,
  payer_name text,
  amount_cents integer,
  due_date date,
  source_row integer,
  status text not null default 'pending' check (status in ('pending','valid','invalid','duplicate','confirmed')),
  issues jsonb not null default '[]'::jsonb,
  spreadsheet_data jsonb,
  created_at timestamptz not null default now(),
  unique(batch_id, document)
);
alter table billing_batch_items add column if not exists invoice_id uuid references invoices(id) on delete set null;
alter table billing_batch_items drop constraint if exists billing_batch_items_status_check;
alter table billing_batch_items add constraint billing_batch_items_status_check
  check (status in ('pending','valid','invalid','duplicate','confirmed','processing','issued','failed','canceled'));
-- Uma mesma competência pode ter vários lotes (inclusive emissões individuais).
-- A proteção contra cobrança duplicada permanece por pessoa em invoices_user_reference_active.
drop index if exists billing_batches_condominium_reference_active;
create index if not exists billing_batches_condominium_reference_idx
  on billing_batches(condominium_id,reference_month) where reference_month is not null;
create unique index if not exists invoices_user_reference_active
  on invoices(user_id,reference_month) where reference_month is not null and status <> 'canceled';

create table if not exists billing_audit_events (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  batch_id uuid references billing_batches(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  event_type text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create table if not exists person_billing_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  condominium_id uuid not null references condominiums(id) on delete cascade,
  amount_override_cents integer,
  description text,
  receive_boleto boolean not null default true,
  receive_pix boolean not null default true,
  allow_after_due boolean not null default true,
  days_after_due integer not null default 30,
  fine_type text not null default 'NONE',
  fine_value numeric(12,2) not null default 0,
  interest_type text not null default 'NONE',
  interest_value numeric(12,2) not null default 0,
  discount_type text not null default 'NONE',
  discount_value numeric(12,2) not null default 0,
  discount_days integer not null default 0,
  source text not null default 'manual',
  updated_at timestamptz not null default now()
);

create table if not exists invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  event_type text not null,
  provider_status text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists invoice_events_invoice_id_idx on invoice_events(invoice_id, created_at desc);
create unique index if not exists invoices_external_id_unique on invoices(external_id) where external_id is not null;

-- Production safety guard: once a CPF is reserved for an Inter issuance, a
-- second request is rejected even when requests arrive concurrently.
create table if not exists inter_issuance_guards (
  payer_cpf char(11) primary key,
  user_id uuid not null references users(id) on delete restrict,
  invoice_id uuid,
  reservation_key uuid,
  reserved_at timestamptz not null default now()
);
alter table inter_issuance_guards add column if not exists reservation_key uuid;

create table if not exists inter_integrations (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null unique references condominiums(id) on delete cascade,
  client_id text not null,
  client_secret text not null,
  cert_path text not null,
  key_path text not null,
  cert_passphrase text,
  base_url text not null default 'https://cdpj.partners.bancointer.com.br',
  token_path text not null default '/oauth/v2/token',
  scopes text not null default 'boleto-cobranca.write boleto-cobranca.read',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Catálogo administrável de bancos. adapter_key identifica o código que sabe
-- conversar com a API do banco; pode ficar nulo enquanto o adaptador não existe.
create table if not exists banks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  adapter_key text check (adapter_key is null or adapter_key in ('inter', 'banco_do_brasil', 'bradesco')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into banks(name,code,adapter_key) values
  ('Banco Inter','inter','inter'),
  ('Banco do Brasil','banco_do_brasil','banco_do_brasil'),
  ('Bradesco','bradesco','bradesco')
on conflict(code) do nothing;

-- Configurações bancárias são administradas independentemente dos condomínios.
-- O vínculo abaixo define qual configuração cada condomínio utiliza.
create table if not exists bank_configurations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null check (provider in ('inter', 'banco_do_brasil', 'bradesco', 'outro')),
  client_id text,
  client_secret text,
  cert_path text,
  key_path text,
  cert_passphrase text,
  base_url text,
  token_path text,
  scopes text,
  extra_config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table bank_configurations add column if not exists bank_id uuid references banks(id) on delete restrict;

create table if not exists condominium_bank_configurations (
  condominium_id uuid primary key references condominiums(id) on delete cascade,
  bank_configuration_id uuid not null references bank_configurations(id) on delete restrict,
  linked_by uuid references users(id) on delete set null,
  linked_at timestamptz not null default now()
);
-- Controla, por condomínio, se a busca de boletos no banco vinculado traz
-- todo o histórico ('all') ou só a partir de um mês inicial ('from_period',
-- guardado em boleto_sync_start_period como o primeiro dia do mês).
alter table condominium_bank_configurations add column if not exists
  boleto_sync_mode text not null default 'all' check (boleto_sync_mode in ('all','from_period'));
alter table condominium_bank_configurations add column if not exists
  boleto_sync_start_period date;

-- Preserva automaticamente as integrações Banco Inter já existentes, inclusive
-- a configuração do Templum, sem copiar ou expor segredos para o frontend.
insert into bank_configurations (
  id, name, provider, client_id, client_secret, cert_path, key_path,
  cert_passphrase, base_url, token_path, scopes, enabled, created_at, updated_at
)
select i.id, c.name || ' - Banco Inter', 'inter', i.client_id, i.client_secret,
       i.cert_path, i.key_path, i.cert_passphrase, i.base_url, i.token_path,
       i.scopes, i.enabled, i.created_at, i.updated_at
from inter_integrations i
join condominiums c on c.id = i.condominium_id
on conflict (id) do nothing;

insert into condominium_bank_configurations (condominium_id, bank_configuration_id, linked_at)
select condominium_id, id, updated_at from inter_integrations
on conflict (condominium_id) do nothing;

update bank_configurations bc set bank_id=b.id
from banks b where bc.bank_id is null and b.code=bc.provider;

create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  fcm_token text not null unique,
  platform text,
  updated_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid references condominiums(id) on delete cascade,
  title text not null,
  body text not null,
  target_role user_role,
  created_by uuid references users(id) on delete set null,
  provider_status text not null,
  created_at timestamptz not null default now()
);

create table if not exists notification_recipients (
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  primary key(notification_id,user_id)
);

alter table notifications add column if not exists audience_type text not null default 'general';
alter table notifications add column if not exists target_user_id uuid references users(id) on delete set null;
create index if not exists notification_recipients_user_idx on notification_recipients(user_id,read_at,delivered_at desc);

create table if not exists resident_reports (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  created_by uuid not null references users(id) on delete cascade,
  category text not null,
  subject text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists resident_report_messages (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references resident_reports(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists resident_reports_scope_idx on resident_reports(condominium_id,created_by,updated_at desc);
create index if not exists resident_report_messages_idx on resident_report_messages(report_id,created_at);

create table if not exists accountability_reports (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  reference_month date not null,
  period_start date not null,
  period_end date not null,
  paid_units integer not null default 0 check (paid_units >= 0),
  exempt_units integer not null default 0 check (exempt_units >= 0),
  unpaid_units integer not null default 0 check (unpaid_units >= 0),
  received_amount_cents bigint not null check (received_amount_cents >= 0),
  source text not null default 'manual' check (source in ('manual','pdf')),
  source_file_name text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (condominium_id, reference_month)
);
create index if not exists accountability_reports_scope_idx
  on accountability_reports(condominium_id,reference_month desc);
alter table accountability_reports add column if not exists bank_balance_cents bigint;
alter table accountability_reports add column if not exists city text;
alter table accountability_reports add column if not exists sindico_name text;
alter table accountability_reports add column if not exists subsindico_name text;
alter table accountability_reports add column if not exists fiscal_council_1_name text;
alter table accountability_reports add column if not exists fiscal_council_2_name text;

create table if not exists accountability_expenses (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references accountability_reports(id) on delete cascade,
  provider text not null,
  purpose text not null,
  service_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists accountability_expenses_report_idx
  on accountability_expenses(report_id,position,created_at);

create table if not exists accountability_expense_attachments (
 expense_id uuid primary key references accountability_expenses(id) on delete cascade,
 condominium_id uuid not null references condominiums(id) on delete cascade,
 reference_month date not null, file_name text not null,
 mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 file_size integer not null check (file_size > 0 and file_size <= 10485760), content bytea not null,
 uploaded_by uuid references users(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists accountability_attachments_scope_idx on accountability_expense_attachments(condominium_id,reference_month);
alter table accountability_expense_attachments add column if not exists kind text not null default 'proof' check (kind in ('receipt','proof'));
do $$ begin
  if not exists (
    select 1 from information_schema.key_column_usage
    where table_name='accountability_expense_attachments' and constraint_name='accountability_expense_attachments_pkey' and column_name='kind'
  ) then
    alter table accountability_expense_attachments drop constraint accountability_expense_attachments_pkey;
    alter table accountability_expense_attachments add primary key (expense_id, kind);
  end if;
end $$;

create table if not exists mobile_releases (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('android','ios')),
  version text not null,
  build_number text not null,
  release_notes text,
  external_url text,
  file_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  active boolean not null default true,
  published_by uuid references users(id) on delete set null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (external_url is not null or file_path is not null)
);
create index if not exists mobile_releases_latest_idx
  on mobile_releases(platform,active,published_at desc);

-- invoices_user_reference_active originalmente bloqueava qualquer segunda
-- cobrança ativa por morador/mês, para evitar que a emissão em lote gerasse
-- mensalidade duplicada. Isso também impedia, sem querer, que uma cobrança
-- avulsa real do banco (multa, rateio, taxa extra) coexistisse com a
-- mensalidade do mesmo mês. A proteção contra duplicidade na emissão interna
-- continua válida: agora só vale para cobranças que ainda não têm
-- external_id (ou seja, ainda não confirmadas no banco). Cobranças já
-- vinculadas a um external_id são cada uma unicamente identificada pelo
-- próprio external_id (invoices_external_id_unique) e podem coexistir.
drop index if exists invoices_user_reference_active;
create unique index if not exists invoices_user_reference_active
  on invoices(user_id,reference_month) where reference_month is not null and status <> 'canceled' and external_id is null;

-- Armazenamento dos anexos da prestação de contas no Google Drive do próprio
-- condomínio (pasta compartilhada com a conta operadora), por condomínio.
-- Opcional: sem essa coluna preenchida, os anexos continuam em bytea no
-- Postgres (comportamento anterior, retrocompatível).
alter table condominiums add column if not exists google_drive_folder_id text;
alter table accountability_expense_attachments add column if not exists drive_file_id text;
alter table accountability_expense_attachments alter column content drop not null;

-- Planos de cobrança da própria plataforma aos condomínios (não confundir com
-- billing_settings, que é a cobrança do condomínio aos moradores). A métrica
-- de cobrança é o usuário ativo do condomínio, por pessoa (não por unidade
-- cadastrada); o critério exato é escolhido por plano em active_user_metric:
-- 'registered' conta todo cadastro não excluído (deleted_at is null),
-- 'login_enabled' conta só quem também tem o acesso habilitado.
create table if not exists platform_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan_type text not null check (plan_type in ('per_active_user','tiered_bracket')),
  price_per_active_user_cents integer check (price_per_active_user_cents is null or price_per_active_user_cents > 0),
  minimum_price_cents integer not null default 0 check (minimum_price_cents >= 0),
  active boolean not null default true,
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table platform_plans add column if not exists
  active_user_metric text not null default 'registered'
  check (active_user_metric in ('login_enabled','registered'));

create table if not exists platform_plan_tiers (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references platform_plans(id) on delete cascade,
  min_active_users integer not null check (min_active_users >= 0),
  max_active_users integer check (max_active_users is null or max_active_users >= min_active_users),
  price_cents integer not null check (price_cents > 0),
  created_at timestamptz not null default now(),
  unique (plan_id, min_active_users)
);

-- Status da assinatura do condomínio na plataforma (independe do plano
-- vinculado): condomínios suspensos/cancelados saem da receita projetada.
alter table condominiums add column if not exists platform_status text not null default 'active';
alter table condominiums drop constraint if exists condominiums_platform_status_check;
alter table condominiums add constraint condominiums_platform_status_check
  check (platform_status in ('active','suspended','canceled'));

create table if not exists condominium_plan_subscriptions (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  plan_id uuid not null references platform_plans(id) on delete restrict,
  started_at date not null default current_date,
  ended_at date,
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists condominium_plan_subscriptions_active_idx
  on condominium_plan_subscriptions(condominium_id) where ended_at is null;

-- Data em que a cobrança de fato começa a valer para esse vínculo de plano
-- (período de adaptação/carência antes disso). Default: 1 mês grátis a
-- partir do vínculo; admin geral pode sobrescrever por condomínio.
alter table condominium_plan_subscriptions add column if not exists
  billing_starts_at date not null default (current_date + interval '1 month')::date;

-- Histórico de faturas da plataforma cobradas de cada condomínio. Uma
-- linha por condomínio/mês (reference_month), gerada sob demanda quando o
-- síndico/subsíndico usa o app após a data de billing_starts_at ter
-- passado — a unique constraint evita gerar/enviar a mesma fatura duas
-- vezes no mesmo mês.
create table if not exists platform_invoices (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  plan_id uuid not null references platform_plans(id) on delete restrict,
  reference_month date not null,
  active_users integer not null,
  amount_cents integer not null,
  status text not null default 'pending' check (status in ('pending','sent','paid','canceled')),
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (condominium_id, reference_month)
);

-- Cobranças adicionais esporádicas por unidade (ex.: tag de portaria):
-- somam à taxa condominial normal no lote mensal enquanto houver parcela
-- pendente para o mês. Vinculadas à unidade (não ao morador), porque a
-- obrigação continua na unidade mesmo se o morador mudar.
create table if not exists unit_extra_charges (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  description text not null,
  total_amount_cents integer not null check (total_amount_cents > 0),
  installment_count integer not null check (installment_count between 1 and 60),
  first_reference_month date not null,
  status text not null default 'active' check (status in ('active','finished','canceled')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists unit_extra_charge_installments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references unit_extra_charges(id) on delete cascade,
  installment_number integer not null,
  amount_cents integer not null check (amount_cents > 0),
  reference_month date not null,
  status text not null default 'pending' check (status in ('pending','applied','canceled')),
  invoice_id uuid references invoices(id) on delete set null,
  applied_at timestamptz,
  canceled_at timestamptz,
  canceled_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (charge_id, installment_number)
);

create index if not exists unit_extra_charge_installments_lookup_idx
  on unit_extra_charge_installments(reference_month, status) where status = 'pending';
create index if not exists unit_extra_charges_unit_idx on unit_extra_charges(unit_id, status);

-- Valor manual opcional para um item de lote (usado principalmente na
-- emissão individual em Gestão de cobranças). Quando preenchido, substitui
-- por completo o cálculo padrão (tipologia + cobranças adicionais) para
-- aquele boleto — é o valor que efetivamente vai para o banco.
alter table billing_batch_items add column if not exists amount_override_cents integer;

-- Log de auditoria de ações de síndico/subsíndico, visível só para
-- admin_geral, navegável por condomínio. actor_role/actor_name ficam
-- congelados no momento da ação (não via join), para o registro
-- continuar legível mesmo se a pessoa for excluída ou renomeada depois.
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  actor_role text not null,
  actor_name text not null,
  feature text not null check (feature in (
    'pessoas','tipologias','blocos_unidades','prestacao_contas',
    'gestao_cobrancas','gestao_debitos','historico_acordos',
    'config_enviar_cobrancas','cobrancas_adicionais',
    'regimento','ocorrencias','notificacoes_infracao'
  )),
  action text not null,
  entity_id text,
  description text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_condominium_idx on audit_log(condominium_id, created_at desc);
create index if not exists audit_log_feature_idx on audit_log(condominium_id, feature, created_at desc);

-- audit_log já existe em bancos antigos — "create table if not exists" acima
-- não reaplica a lista de features numa tabela pré-existente, então o
-- constraint precisa ser recriado explicitamente sempre que uma feature nova é adicionada.
alter table audit_log drop constraint if exists audit_log_feature_check;
alter table audit_log add constraint audit_log_feature_check check (feature in (
  'pessoas','tipologias','blocos_unidades','prestacao_contas',
  'gestao_cobrancas','gestao_debitos','historico_acordos',
  'config_enviar_cobrancas','cobrancas_adicionais',
  'regimento','ocorrencias','notificacoes_infracao'
));

-- ============================================================
-- Regimento interno / Livro de Ocorrências / Notificação de Infração.
--
-- Feature de plataforma: cada condomínio configura seu próprio regimento em
-- regulation_articles (multa, prazo, juros, correção, reincidência), sempre
-- isolado por condominium_id. infraction_notices congela (article_snapshot)
-- os parâmetros do artigo e a taxa condominial vigentes no instante da
-- emissão — edições posteriores no artigo nunca afetam notificações já
-- emitidas, só as futuras.
-- ============================================================
create table if not exists regulation_articles (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  article_number text not null,
  description text not null,
  base_fine_percent numeric not null check (base_fine_percent >= 0),
  payment_deadline_days integer not null check (payment_deadline_days > 0),
  late_interest_percent_month numeric not null default 0 check (late_interest_percent_month >= 0),
  monetary_correction_index text not null default 'FIXED' check (monetary_correction_index in ('IGPM','INPC','FIXED')),
  fixed_monthly_correction_percent numeric check (fixed_monthly_correction_percent >= 0),
  reiteration_daily_percent numeric not null default 0 check (reiteration_daily_percent >= 0),
  acknowledgment_tolerance_days integer check (acknowledgment_tolerance_days is null or acknowledgment_tolerance_days >= 0),
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regulation_articles_fixed_index_chk
    check (monetary_correction_index <> 'FIXED' or fixed_monthly_correction_percent is not null)
);
create index if not exists regulation_articles_condo_idx on regulation_articles(condominium_id, active, article_number);

create table if not exists occurrences (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  unit_id uuid references units(id) on delete set null,
  related_unit_id uuid references units(id) on delete set null,
  reported_by uuid not null references users(id) on delete cascade,
  category text not null check (category in ('barulho','dano','manutencao','seguranca','conduta','outros')),
  description text not null,
  status text not null default 'aberta' check (status in ('aberta','em_analise','respondida','resolvida','arquivada')),
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists occurrences_condo_idx on occurrences(condominium_id, status, created_at desc);

create table if not exists occurrence_updates (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references occurrences(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists occurrence_updates_idx on occurrence_updates(occurrence_id, created_at);

-- Anexos livres (N por ocorrência) — mesmo padrão dual de storage (bytea
-- inline OU Google Drive) usado em accountability_expense_attachments, sem
-- coluna "kind" (aqui não há slots fixos).
create table if not exists occurrence_attachments (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references occurrences(id) on delete cascade,
  condominium_id uuid not null references condominiums(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  file_size integer not null,
  content bytea,
  drive_file_id text,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists occurrence_attachments_idx on occurrence_attachments(occurrence_id, created_at);

create table if not exists infraction_notices (
  id uuid primary key default gen_random_uuid(),
  condominium_id uuid not null references condominiums(id) on delete cascade,
  unit_id uuid not null references units(id) on delete restrict,
  article_id uuid not null references regulation_articles(id) on delete restrict,
  occurrence_id uuid references occurrences(id) on delete set null,
  issued_by uuid not null references users(id) on delete set null,
  description text not null,
  is_recurrence boolean not null default false,
  previous_notice_id uuid references infraction_notices(id) on delete set null,
  -- Snapshot imutável dos parâmetros do artigo e da taxa condominial vigente
  -- no instante da emissão. Nunca é reescrito após a criação da linha — é o
  -- que garante que editar o artigo depois não altera notificações já emitidas.
  article_snapshot jsonb not null,
  taxa_condominial_cents_snapshot integer not null check (taxa_condominial_cents_snapshot > 0),
  base_fine_amount_cents integer not null,
  final_fine_amount_cents integer,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_auto boolean not null default false,
  due_date date,
  ongoing_since date,
  ceased_at date,
  status text not null default 'rascunho'
    check (status in ('rascunho','enviada','em_defesa','confirmada','paga','cancelada')),
  defense_text text,
  defense_submitted_at timestamptz,
  cancellation_reason text,
  billing_charge_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists infraction_notices_condo_idx on infraction_notices(condominium_id, status, created_at desc);
create index if not exists infraction_notices_unit_article_idx on infraction_notices(condominium_id, unit_id, article_id, status);

alter table invoices add column if not exists infraction_notice_id uuid references infraction_notices(id) on delete set null;
alter table invoices drop constraint if exists invoices_invoice_type_check;
alter table invoices add constraint invoices_invoice_type_check check (invoice_type in ('regular','agreement','legacy','infraction'));

alter table infraction_notices drop constraint if exists infraction_notices_billing_charge_fk;
alter table infraction_notices add constraint infraction_notices_billing_charge_fk
  foreign key (billing_charge_id) references invoices(id) on delete set null;

-- Índices econômicos (IGPM/INPC) — plataforma inteira, mantidos manualmente
-- pelo admin_geral, mês a mês. Nunca um valor fixo no código: se o mês
-- necessário não estiver cadastrado, a confirmação da notificação bloqueia
-- em vez de assumir 0%.
create table if not exists economic_indexes (
  id uuid primary key default gen_random_uuid(),
  index_name text not null check (index_name in ('IGPM','INPC')),
  reference_month date not null,
  monthly_percent numeric not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (index_name, reference_month)
);

-- Controle de funcionalidades por condomínio, configurado pelo admin_geral.
-- Um condomínio sem linha nesta tabela tem tudo ativo por padrão — nunca é
-- inserida uma linha default na migração, só quando o admin_geral mexe pela
-- primeira vez nas funcionalidades daquele condomínio (upsert).
create table if not exists condominium_features (
  condominium_id uuid primary key references condominiums(id) on delete cascade,
  pessoas boolean not null default true,
  tipologias boolean not null default true,
  blocos_unidades boolean not null default true,
  prestacao_contas boolean not null default true,
  gestao_cobrancas boolean not null default true,
  gestao_debitos boolean not null default true,
  historico_acordos boolean not null default true,
  config_enviar_cobrancas boolean not null default true,
  cobrancas_adicionais boolean not null default true,
  avisos_comunicacao boolean not null default true,
  relatos_solicitacoes boolean not null default true,
  enquetes boolean not null default false,
  reserva_espacos boolean not null default false,
  regimento_ocorrencias boolean not null default true,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table condominium_features add column if not exists enquetes boolean not null default true;
alter table condominium_features add column if not exists reserva_espacos boolean not null default true;
alter table condominium_features alter column enquetes set default false;
alter table condominium_features alter column reserva_espacos set default false;
