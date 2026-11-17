const {readFileSync,existsSync}=require('node:fs');
const {resolve}=require('node:path');
const {Client}=require('pg');
(async()=>{
 const root=resolve(__dirname,'..');
 if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
 if(!process.env.DATABASE_URL)throw Error('Configure DATABASE_URL');
 const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
 try{await client.connect();await client.query(readFileSync(resolve(root,'migrations/021_short_creation.sql'),'utf8'));console.log('Migration 021: Criar Short pronta.');}finally{await client.end();}
})().catch(e=>{console.error('Falha na migration Criar Short:',e.code??'erro');process.exitCode=1;});
