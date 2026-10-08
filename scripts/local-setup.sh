#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
chmod 700 .local
PG_BIN="${PG_BIN:-/usr/lib/postgresql/18/bin}"
if [ ! -x "$PG_BIN/initdb" ]; then
  echo 'Set PG_BIN to a PostgreSQL bin directory, or use the Docker Compose stack.'
  exit 1
fi
if [ ! -f .local/postgres/PG_VERSION ]; then
  "$PG_BIN/initdb" -D "$PWD/.local/postgres" --auth-local=trust --auth-host=scram-sha-256 --username=sparecash --pwfile=<(node -e "const fs=require('fs'),c=require('crypto'); const p=c.randomBytes(24).toString('hex');fs.writeFileSync('.local/db-password',p,{mode:0o600});process.stdout.write(p)") >/dev/null
fi
if ! "$PG_BIN/pg_ctl" -D "$PWD/.local/postgres" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$PWD/.local/postgres" -l "$PWD/.local/postgres.log" -o "-p 55432 -h 127.0.0.1 -k $PWD/.local" start >/dev/null
fi
node --input-type=module <<'JS'
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
if(!fs.existsSync('.env')){
 const url=`postgresql://sparecash:${fs.readFileSync('.local/db-password','utf8')}@127.0.0.1:55432/sparecash`;
 fs.writeFileSync('.env',`DATABASE_URL=${url}\n`,{mode:0o600});
}
const contents = fs.readFileSync('.env', 'utf8');
if (!parse(contents).OWNER_PASSWORD) {
  const previousPath = ['.local/runtime/owner-password.txt', '.local/owner-password.txt'].find(path => fs.existsSync(path));
  const password = process.env.OWNER_PASSWORD || (previousPath ? fs.readFileSync(previousPath, 'utf8').trim() : randomBytes(18).toString('base64url'));
  fs.appendFileSync('.env', `\nOWNER_PASSWORD=${JSON.stringify(password)}\n`, { mode: 0o600 });
  fs.chmodSync('.env', 0o600);
}
JS
PGPASSWORD="$(cat .local/db-password)" "$PG_BIN/psql" -h 127.0.0.1 -p 55432 -U sparecash -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='sparecash'" | rg -q 1 || PGPASSWORD="$(cat .local/db-password)" "$PG_BIN/createdb" -h 127.0.0.1 -p 55432 -U sparecash sparecash
npm run db:generate
npm run db:migrate
npx tsx scripts/local-settings.ts
npm run db:seed
printf 'Local PostgreSQL and environment are ready. Owner password: OWNER_PASSWORD in .env\n'
