// ===========================================================================
//  SUPABASE MIGRATION RUNNER
//  Runs at build time on Netlify. Applies every .sql file in /migrations that
//  has not been applied before, in filename order, records it, then forces
//  PostgREST to reload its schema cache.
//
//  That last step matters: DDL run through the Management API does NOT make
//  PostgREST notice new tables. Without the reload, every query returns
//  PGRST205 "could not find the table ... in the schema cache" even though
//  the table exists. The SQL Editor does this reload for you; the API does not.
//
//  Environment:
//    SUPABASE_ACCESS_TOKEN  — Supabase personal access token
//    SUPABASE_PROJECT_REF   — project ref (e.g. sjpmebbduueftxquqxip)
//  Without them it skips quietly so a deploy never fails for want of a token.
// ===========================================================================
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR   = join(ROOT, "migrations");
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF   = process.env.SUPABASE_PROJECT_REF;

const status = { ran_at: new Date().toISOString(), enabled: false,
                 applied: [], already: [], tables: {}, error: null };

async function writeStatus() {
  // Published as /migrations-status.json so the result is visible without
  // access to the build log.
  try { await writeFile(join(ROOT, "migrations-status.json"),
                        JSON.stringify(status, null, 2)); } catch {}
}

if (!TOKEN || !REF) {
  console.log("[migrate] token or project ref not set — skipping.");
  status.error = "SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF not set";
  await writeStatus();
  process.exit(0);
}
status.enabled = true;

async function runSql(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    { method: "POST",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 600)}`);
  try { return JSON.parse(text); } catch { return text; }
}

try {
  await runSql(`create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz default now()
    );`);

  const done = new Set(
    (await runSql("select name from _migrations;") || []).map(r => r.name));

  let files = [];
  try { files = (await readdir(DIR)).filter(f => f.endsWith(".sql")).sort(); }
  catch { console.log("[migrate] no migrations directory."); }

  for (const f of files) {
    if (done.has(f)) { status.already.push(f); continue; }
    const sql = await readFile(join(DIR, f), "utf8");
    if (!sql.trim()) continue;
    console.log(`[migrate] applying ${f} …`);
    await runSql(sql);
    await runSql(`insert into _migrations (name) values ('${f.replace(/'/g, "''")}')
                  on conflict (name) do nothing;`);
    status.applied.push(f);
    console.log(`[migrate] ✓ ${f}`);
  }

  // Force PostgREST to pick up any new tables. Harmless when nothing changed.
  await runSql("notify pgrst, 'reload schema';");

  // Report what actually exists, so a green build can be trusted.
  const rows = await runSql(`select table_name from information_schema.tables
     where table_schema = 'public' order by table_name;`);
  const names = (rows || []).map(r => r.table_name);
  ["trade_reps","trade_products","trade_orders",
   "export_buyers","export_products","export_orders","export_payments","export_requests"]
    .forEach(t => { status.tables[t] = names.includes(t); });

  console.log(`[migrate] done — ${status.applied.length} applied, ${status.already.length} already.`);
  console.log("[migrate] tables:", JSON.stringify(status.tables));
  await writeStatus();
} catch (e) {
  console.error("[migrate] FAILED:", e.message);
  status.error = e.message;
  await writeStatus();
  process.exit(1);
}
