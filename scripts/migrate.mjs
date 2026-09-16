// ===========================================================================
//  SUPABASE MIGRATION RUNNER
//  Runs at build time on Netlify. Applies every .sql file in /migrations that
//  has not been applied before, in filename order, then records it.
//
//  Needs two environment variables:
//    SUPABASE_ACCESS_TOKEN  — Supabase personal access token
//    SUPABASE_PROJECT_REF   — the project ref (e.g. sjpmebbduueftxquqxip)
//  Without them it skips quietly, so a deploy never fails for want of a token.
// ===========================================================================
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF   = process.env.SUPABASE_PROJECT_REF;

if (!TOKEN || !REF) {
  console.log("[migrate] SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF not set — skipping.");
  process.exit(0);
}

async function runSql(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    { method: "POST",
      headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

try {
  // Ledger of what has already run. Created on first use.
  await runSql(`create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz default now()
    );`);

  const done = new Set(
    (await runSql("select name from _migrations;") || []).map(r => r.name));

  let files = [];
  try { files = (await readdir(DIR)).filter(f => f.endsWith(".sql")).sort(); }
  catch { console.log("[migrate] no migrations directory — nothing to do."); process.exit(0); }

  const pending = files.filter(f => !done.has(f));
  if (!pending.length) {
    console.log(`[migrate] up to date (${files.length} applied).`);
    process.exit(0);
  }

  for (const f of pending) {
    const sql = await readFile(join(DIR, f), "utf8");
    if (!sql.trim()) continue;
    console.log(`[migrate] applying ${f} …`);
    await runSql(sql);
    await runSql(`insert into _migrations (name) values ('${f.replace(/'/g, "''")}')
                  on conflict (name) do nothing;`);
    console.log(`[migrate] ✓ ${f}`);
  }
  console.log(`[migrate] done — ${pending.length} applied.`);
} catch (e) {
  // A broken migration must fail the deploy loudly rather than ship a site
  // whose database does not match its code.
  console.error("[migrate] FAILED:", e.message);
  process.exit(1);
}
// migration runner enabled
