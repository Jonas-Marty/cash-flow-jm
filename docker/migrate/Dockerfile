FROM postgres:16-alpine
COPY docker/migrate/run-migrations.sh /usr/local/bin/run-migrations.sh
RUN chmod +x /usr/local/bin/run-migrations.sh
COPY supabase/migrations /migrations
ENTRYPOINT ["run-migrations.sh"]
