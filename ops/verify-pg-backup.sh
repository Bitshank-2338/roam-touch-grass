#!/bin/sh
# Run only inside the disposable PostgreSQL test container.
set -eu
test "${POSTGRES_DB:-}" = roamtest
test "${POSTGRES_USER:-}" = roamtest
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=roamtest PGPASSWORD="$POSTGRES_PASSWORD"
target="roamtest_restore_$(date +%s)"
dump="/tmp/$target.dump"
pg_dump --dbname=roamtest --format=custom --file="$dump"
createdb "$target"
pg_restore --exit-on-error --dbname="$target" "$dump"
for table in posts reports devices hearts comments moderation_audit trend_snapshots geoapify_usage; do
 sql="SELECT md5(COALESCE(string_agg(t::text, '' ORDER BY t::text), '')) FROM public.$table t"
 source_hash=$(psql --dbname=roamtest -tAc "$sql")
 restored_hash=$(psql --dbname="$target" -tAc "$sql")
 test "$source_hash" = "$restored_hash"
done
printf '%s\n' 'PostgreSQL dump/restore verified across all eight application tables.'
