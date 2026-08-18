alter table public.ai_endpoints add column if not exists health_mode text not null default 'real';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_endpoints_health_mode_check') then
    alter table public.ai_endpoints add constraint ai_endpoints_health_mode_check check (health_mode in ('fast','model_listed','real'));
  end if;
end $$;
update public.ai_endpoints set health_mode = 'real' where health_mode is null;