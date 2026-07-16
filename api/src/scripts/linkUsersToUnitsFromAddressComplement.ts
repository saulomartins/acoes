/// <reference path="../pg.d.ts" />

import { pool, withTransaction } from '../db';

const normalizeUnit = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/\b(APARTAMENTO|APTO|APT|UNIDADE)\b/g, '')
  .replace(/[^A-Z0-9]/g, '');

type Person = { id:string; condominium_id:string; full_name:string|null; username:string; cpf:string|null; address_complement:string|null; unit_id:string|null };
type Unit = { id:string; condominium_id:string; block_name:string; number:string };

(async () => {
  const people = await pool.query<Person>(
    `select id,condominium_id,full_name,username,cpf,address_complement,unit_id
     from users
     where role in ('proprietario','inquilino') and condominium_id is not null
       and unit_id is null and nullif(trim(coalesce(address_complement,'')),'') is not null
     order by full_name,username`,
  );
  const units = await pool.query<Unit>(
    `select u.id,u.condominium_id,b.name block_name,u.number
     from units u join blocks b on b.id=u.block_id where u.active=true`,
  );
  const byCondominium = new Map<string,Unit[]>();
  for (const unit of units.rows) byCondominium.set(unit.condominium_id,[...(byCondominium.get(unit.condominium_id)||[]),unit]);

  const report = { linked: [] as any[], unmatched: [] as any[], ambiguous: [] as any[], conflicts: [] as any[] };
  await withTransaction(async client => {
    for (const person of people.rows) {
      const key = normalizeUnit(person.address_complement);
      const candidates = (byCondominium.get(person.condominium_id)||[]).filter(unit => normalizeUnit(unit.number) === key);
      const summary = { userId:person.id, person:person.full_name||person.username, complement:person.address_complement };
      if (!key || candidates.length === 0) { report.unmatched.push(summary); continue; }
      if (candidates.length > 1) { report.ambiguous.push({ ...summary, units:candidates.map(unit=>`${unit.block_name} / ${unit.number}`) }); continue; }
      const unit = candidates[0];
      if (person.cpf) {
        const duplicate = await client.query(
          `select id from users where unit_id=$1 and id<>$2 and regexp_replace(coalesce(cpf,''),'[^0-9]','','g')=regexp_replace($3,'[^0-9]','','g')`,
          [unit.id,person.id,person.cpf],
        );
        if (duplicate.rows[0]) { report.conflicts.push({ ...summary, unit:`${unit.block_name} / ${unit.number}`, reason:'CPF já vinculado à unidade' }); continue; }
      }
      await client.query(`update users set unit_id=$1,unit=$2,unit_type_id=null where id=$3`,[unit.id,unit.number,person.id]);
      await client.query(
        `insert into unit_occupancies(unit_id,user_id,is_representative) values($1,$2,false)
         on conflict (unit_id,user_id) where ended_at is null do nothing`,
        [unit.id,person.id],
      );
      report.linked.push({ ...summary, unit:`${unit.block_name} / ${unit.number}` });
    }
  });
  console.log(JSON.stringify({ candidates:people.rows.length,...report },null,2));
})().catch(error => { console.error(error); process.exitCode=1; }).finally(async()=>pool.end());
