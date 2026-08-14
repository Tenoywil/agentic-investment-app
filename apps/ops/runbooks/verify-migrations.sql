-- Run this against production. Every row should say ok.
select 'listing_status enum'  as thing, (to_regtype('listing_status') is not null) as ok
union all
select 'instruments.listing_status column',
       exists(select 1 from information_schema.columns
               where table_name='instruments' and column_name='listing_status')
union all
select 'partner_upsert_instrument fn',
       exists(select 1 from pg_proc where proname='partner_upsert_instrument')
union all
select 'partner_toggle_instrument fn',
       exists(select 1 from pg_proc where proname='partner_toggle_instrument')
union all
select 'ccn_app may execute upsert',
       has_function_privilege('ccn_app','partner_upsert_instrument(uuid,text,instrument_type,text,currency,bigint,text,text,text,risk_rating,text,text)','execute')
union all
select 'fx_rates.as_of (0016)',
       exists(select 1 from information_schema.columns
               where table_name='fx_rates' and column_name='as_of')
union all
select 'orders.unit_price_minor (0019)',
       exists(select 1 from information_schema.columns
               where table_name='orders' and column_name='unit_price_minor')
union all
select 'partner_client_holdings fn (0018)',
       exists(select 1 from pg_proc where proname='partner_client_holdings');
