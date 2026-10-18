// Tests supabase/schema.sql in an in-memory Postgres (PGlite) with the small parts of Supabase it
// relies on (auth.users, auth.uid(), auth.jwt(), the anon/authenticated roles): who can see and
// change what, the invite flow, ticks, and shared calendars.
import assert from 'node:assert';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create publication supabase_realtime;
  grant usage on schema public, auth to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`);
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));

const ids = { cathy: '00000000-0000-0000-0000-00000000000c', han: '00000000-0000-0000-0000-00000000000a', eve: '00000000-0000-0000-0000-00000000000e' };
const emails = { cathy: 'Cathy@Gmail.com', han: 'han@gmail.com', eve: 'eve@gmail.com' };
for (const [who, id] of Object.entries(ids)) {
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, emails[who], JSON.stringify({ full_name: who[0].toUpperCase() + who.slice(1) })]);
}
// Runs SQL as a signed-in person (or as a signed-out visitor), like requests through Supabase's API.
async function as(who, sql, params = []) {
  await db.exec('reset role');
  const claims = who ? JSON.stringify({ sub: ids[who], email: emails[who].toLowerCase(), role: 'authenticated' }) : '{}';
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.exec(`set role ${who ? 'authenticated' : 'anon'}`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const fails = async (who, sql, params, re) => {
  let err = null;
  try { await as(who, sql, params); } catch (e) { err = e; }
  assert(err, `expected ${who} to be refused: ${sql}`);
  if (re) assert.match(err.message, re);
};

// --- sign-up makes a profile (email lower-cased, name from Google)
assert.deepEqual((await as('cathy', 'select email, name, share_calendar from profiles')), [{ email: 'cathy@gmail.com', name: 'Cathy', share_calendar: 'off' }]);
assert.equal((await as('han', 'select * from profiles')).length, 1, 'strangers only see themselves');

// --- Cathy starts a pact and invites Han by Gmail
const [{ create_pact: pact }] = await as('cathy', "select create_pact('Daily online test')");
await as('cathy', 'insert into pact_invites (pact_id, email) values ($1, $2)', [pact, 'han@gmail.com']);
await fails('eve', 'insert into pact_invites (pact_id, email) values ($1, $2)', [pact, 'eve2@gmail.com'], /row-level security/);

// --- Han sees the invite (and who sent it); Eve sees nothing
const hanInv = await as('han', 'select * from my_invites()');
assert.equal(hanInv.length, 1);
assert.deepEqual(hanInv[0].from_names, ['Cathy']);
assert.equal((await as('han', 'select * from pacts')).length, 1, 'invited people can see the pact');
assert.equal((await as('han', 'select * from pact_members')).length, 0, 'but not its members yet');
assert.deepEqual((await as('han', 'select name from profiles order by name')).map((r) => r.name), ['Cathy', 'Han'], 'and the inviter\'s name');
assert.equal((await as('eve', 'select * from my_invites()')).length, 0);
assert.equal((await as('eve', 'select * from pacts')).length, 0);
await fails('eve', 'select accept_invite($1)', [pact], /taken back/);

// --- Han accepts
await as('han', 'select accept_invite($1)', [pact]);
assert.equal((await as('han', 'select * from pact_members')).length, 2);
assert.equal((await as('cathy', 'select * from pact_invites')).length, 0, 'the invite is used up');

// --- ticks: your own only; members see each other's
await as('han', "insert into pact_days (pact_id, day, note) values ($1, '2026-10-18', 'SHL 14/18')", [pact]);
await fails('han', "insert into pact_days (pact_id, user_id, day) values ($1, $2, '2026-10-18')", [pact, ids.cathy], /row-level security/);
assert.equal((await as('cathy', 'select * from pact_days')).length, 1, 'Cathy sees Han\'s tick');
assert.equal((await as('eve', 'select * from pact_days')).length, 0);
await as('cathy', "delete from pact_days where user_id = $1", [ids.han]);
assert.equal((await as('han', 'select * from pact_days')).length, 1, 'nobody can untick someone else');

// --- shared calendars
await as('cathy', "insert into events (id, day, starts, ends, title) values ('e1', '2026-10-20', '10:00', '12:00', 'Microeconomics lecture')");
await fails('han', "insert into events (user_id, id, day) values ($1, 'x', '2026-10-20')", [ids.cathy], /row-level security/);
assert.equal((await as('han', 'select * from events')).length, 0, 'events are private by default');
assert.equal((await as('han', "select * from buddy_events('2026-10-19', '2026-10-25')")).length, 0, 'sharing is off');
await as('cathy', "update profiles set share_calendar = 'busy' where id = $1", [ids.cathy]);
let seen = await as('han', "select name, title, starts from buddy_events('2026-10-19', '2026-10-25')");
assert.deepEqual(seen.map((r) => [r.name, r.title, r.starts]), [['Cathy', '', '10:00:00']], 'busy hides the name');
await as('cathy', "update profiles set share_calendar = 'names' where id = $1", [ids.cathy]);
seen = await as('han', "select title from buddy_events('2026-10-19', '2026-10-25')");
assert.equal(seen[0].title, 'Microeconomics lecture');
assert.equal((await as('eve', "select * from buddy_events('2026-10-19', '2026-10-25')")).length, 0, 'not shared outside the pact');
await as('han', "update profiles set share_calendar = 'off' where id = $1", [ids.cathy]);
assert.equal((await as('cathy', 'select share_calendar from profiles where id = $1', [ids.cathy]))[0].share_calendar, 'names', 'nobody changes someone else\'s profile');

// --- signed-out visitors get nothing
assert.equal((await as(null, 'select * from pacts')).length, 0);
await fails(null, 'select * from my_invites()', [], /permission denied/);

// --- leaving; the last one out deletes the pact
await as('han', 'select leave_pact($1)', [pact]);
assert.equal((await as('cathy', 'select * from pact_members')).length, 1);
assert.equal((await as('cathy', 'select * from pact_days')).length, 0, 'Han\'s ticks went with Han');
await as('cathy', 'select leave_pact($1)', [pact]);
assert.equal((await db.query('select count(*)::int as n from pacts')).rows[0].n, 0);
console.log('ALL DATABASE RULE TESTS PASSED');
