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

-- A tipologia pertence à unidade. Migra vínculos antigos e remove a cópia da pessoa.
update units target
set unit_type_id = legacy.unit_type_id
from users legacy
where legacy.unit_id = target.id
  and target.unit_type_id is null
  and legacy.unit_type_id is not null;
update users set unit_type_id = null where unit_id is not null and unit_type_id is not null;

create table if not exists refresh_tokens (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now(),
  unique(agreement_id,installment_number)
);

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
alter table invoices add constraint invoices_invoice_type_check check (invoice_type in ('regular','agreement'));
create index if not exists debt_agreements_condominium_idx on debt_agreements(condominium_id,status,created_at desc);
create index if not exists debt_communications_user_idx on debt_communications(user_id,created_at desc);

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
