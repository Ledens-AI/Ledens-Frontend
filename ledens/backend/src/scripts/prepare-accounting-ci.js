import pg from 'pg';
import fs from 'node:fs/promises';
const url=new URL(process.env.DATABASE_URL||'postgres://invalid/invalid');
if(process.env.ALLOW_TEST_DATABASE_SETUP!=='yes'||url.pathname!=='/ledens_auth_test')throw new Error('Only the dedicated empty CI database is allowed');
const pool=new pg.Pool({connectionString:url.href});
try{
 const fixture=(await fs.readFile(new URL('../../test/finance-fixture.sql',import.meta.url),'utf8'))
   .split('\n').filter(line=>!line.startsWith('CREATE TABLE public.')).join('\n');
 await pool.query(fixture);
 await pool.query('CREATE DATABASE ledens_finance_test');
 await pool.query('CREATE DATABASE ledens_finance_ui_test');
}finally{await pool.end();}
