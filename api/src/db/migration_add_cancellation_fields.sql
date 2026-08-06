-- Migration: Add cancellation reason fields for debt agreements and boletos

-- Add cancellation_reason to debt_agreements table
alter table debt_agreements add column if not exists cancellation_reason text;

-- Add cancellation_reason to debt_agreement_installments table
alter table debt_agreement_installments add column if not exists cancellation_reason text;

-- Add cancellation_reason to invoices table
alter table invoices add column if not exists cancellation_reason text;

-- Add column to track if agreement was canceled due to all boletos being canceled
alter table debt_agreements add column if not exists canceled_all_boletos_at timestamptz;
alter table debt_agreements add column if not exists recalculated_total_cents integer;
alter table debt_agreements add column if not exists days_late_at_cancellation integer;
alter table debt_agreements add column if not exists fine_percent_at_cancellation numeric;
alter table debt_agreements add column if not exists daily_interest_percent_at_cancellation numeric;

-- Create index for querying agreements with cancellation reason
create index if not exists debt_agreements_cancellation_idx on debt_agreements(condominium_id, status, canceled_all_boletos_at) where status = 'canceled';

commit;
