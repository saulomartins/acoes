import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import multer from 'multer';
import ExcelJS from 'exceljs';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
router.use(authenticate);

const scopedCondominiumId = (req: any) => req.user?.role === 'admin_geral' ? req.query.condominiumId || req.body?.condominiumId : req.user?.condominiumId;

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = scopedCondominiumId(req);
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });
  const [blocks, units] = await Promise.all([
    query(`select id, condominium_id, name, active from blocks where condominium_id=$1 order by name`, [condominiumId]),
    query(`select u.id,u.condominium_id,u.block_id,u.number,u.unit_type_id,u.active,b.name block_name,ut.name unit_type_name,
                  o.user_id representative_user_id,ru.full_name representative_name,
                  coalesce(json_agg(json_build_object('user_id',oc.user_id,'full_name',cu.full_name,'cpf',cu.cpf,'role',cu.role,'is_representative',oc.is_representative)
                    order by cu.full_name) filter (where oc.id is not null),'[]') residents
           from units u join blocks b on b.id=u.block_id left join unit_types ut on ut.id=u.unit_type_id
           left join unit_occupancies o on o.unit_id=u.id and o.ended_at is null and o.is_representative=true
           left join users ru on ru.id=o.user_id
           left join unit_occupancies oc on oc.unit_id=u.id and oc.ended_at is null
           left join users cu on cu.id=oc.user_id
           where u.condominium_id=$1
           group by u.id,b.name,ut.name,o.user_id,ru.full_name order by b.name,u.number`, [condominiumId]),
  ]);
  return res.json({ blocks: blocks.rows, units: units.rows });
}));

router.post('/blocks', authorize('admin_geral','sindico','subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = scopedCondominiumId(req); const name = String(req.body?.name || '').trim();
  if (!condominiumId || !name) return res.status(400).json({ message: 'Condomínio e nome do bloco são obrigatórios.' });
  const result = await query(`insert into blocks(condominium_id,name) values($1,$2) returning *`, [condominiumId,name]);
  return res.status(201).json({ block: result.rows[0] });
}));

router.delete('/blocks/:id', authorize('sindico','subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const block = await query(`select id from blocks where id=$1 and condominium_id=$2`, [req.params.id,condominiumId]);
  if (!block.rows[0]) return res.status(404).json({ message: 'Bloco não encontrado.' });
  const used = await query(`select 1 from units u join unit_occupancies o on o.unit_id=u.id where u.block_id=$1 limit 1`, [req.params.id]);
  if (used.rows[0]) return res.status(409).json({ message: 'Este bloco possui unidades com histórico de moradores e não pode ser excluído.' });
  await query(`delete from blocks where id=$1 and condominium_id=$2`, [req.params.id,condominiumId]);
  return res.json({ message: 'Bloco excluído.' });
}));

router.patch('/blocks/:id', authorize('sindico','subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId; const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Informe o nome do bloco.' });
  const result = await query(`update blocks set name=$1 where id=$2 and condominium_id=$3 returning *`,[name,req.params.id,condominiumId]);
  if (!result.rows[0]) return res.status(404).json({ message:'Bloco não encontrado.' });
  return res.json({ block:result.rows[0],message:'Bloco atualizado.' });
}));

router.post('/', authorize('admin_geral','sindico','subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = scopedCondominiumId(req); const { blockId, unitTypeId } = req.body ?? {}; const number = String(req.body?.number || '').trim();
  if (!condominiumId || !blockId || !number || !unitTypeId) return res.status(400).json({ message: 'Bloco, número e tipologia do apartamento são obrigatórios.' });
  const block = await query(`select id from blocks where id=$1 and condominium_id=$2 and active=true`, [blockId,condominiumId]);
  if (!block.rows[0]) return res.status(400).json({ message: 'Bloco inválido.' });
  if (unitTypeId) { const type = await query(`select id from unit_types where id=$1 and condominium_id=$2 and active=true`,[unitTypeId,condominiumId]); if (!type.rows[0]) return res.status(400).json({ message:'Tipologia inválida.' }); }
  const result = await query(`insert into units(condominium_id,block_id,number,unit_type_id) values($1,$2,$3,$4) returning *`,[condominiumId,blockId,number,unitTypeId||null]);
  return res.status(201).json({ unit: result.rows[0] });
}));

router.post('/imports/excel', authorize('sindico','subsindico'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Selecione um arquivo Excel.' });
  if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ message: 'O arquivo deve estar no formato .xlsx.' });
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(req.file.buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return res.status(400).json({ message: 'A planilha não possui abas.' });
  const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  let headerRow = 0; let blockColumn = 0; let unitColumn = 0; let typeColumn = 0;
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 10); rowNumber += 1) {
    sheet.getRow(rowNumber).eachCell((cell, column) => {
      const header = normalize(cell.text);
      if (header === 'bloco') blockColumn = column;
      if (header === 'unidade' || header === 'apartamento') unitColumn = column;
      if (header === 'tipologia' || header === 'tipo' || header === 'tipo de condominio' || header === 'tipo do condominio') typeColumn = column;
    });
    if (blockColumn && unitColumn && typeColumn) { headerRow = rowNumber; break; }
    blockColumn = 0; unitColumn = 0; typeColumn = 0;
  }
  if (!headerRow) return res.status(400).json({ message: 'Use as colunas "Bloco", "Unidade" e "Tipologia" (ou "Tipo de Condominio") na planilha.' });

  const rows: Array<{ row: number; block: string; unit: string; type: string }> = [];
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber); const block = row.getCell(blockColumn).text.trim(); const unit = row.getCell(unitColumn).text.trim(); const type = row.getCell(typeColumn).text.trim();
    if (!block && !unit && !type) continue;
    rows.push({ row: rowNumber, block, unit, type });
  }
  if (!rows.length) return res.status(400).json({ message: 'Nenhuma unidade preenchida foi encontrada.' });

  const result = await withTransaction(async client => {
    const existingBlocks = await client.query<{id:string;name:string}>(`select id,name from blocks where condominium_id=$1`, [condominiumId]);
    const blocks = new Map(existingBlocks.rows.map(block => [normalize(block.name), block.id]));
    const existingTypes = await client.query<{id:string;name:string}>(`select id,name from unit_types where condominium_id=$1 and active=true`, [condominiumId]);
    const types = new Map(existingTypes.rows.map(type => [normalize(type.name), type.id]));
    let createdBlocks = 0; let createdUnits = 0; let duplicates = 0; const issues: Array<{row:number;message:string}> = [];
    const seen = new Set<string>();
    for (const item of rows) {
      if (!item.block || !item.unit || !item.type) { issues.push({ row: item.row, message: 'Bloco, unidade e tipologia são obrigatórios.' }); continue; }
      const unitTypeId = types.get(normalize(item.type));
      if (!unitTypeId) { issues.push({ row:item.row,message:`Tipologia "${item.type}" não está cadastrada no condomínio.` }); continue; }
      let blockId = blocks.get(normalize(item.block));
      if (!blockId) {
        const created = await client.query<{id:string}>(`insert into blocks(condominium_id,name) values($1,$2) returning id`, [condominiumId,item.block]);
        blockId = created.rows[0].id; blocks.set(normalize(item.block),blockId); createdBlocks += 1;
      }
      const key = `${blockId}:${normalize(item.unit)}`;
      if (seen.has(key)) { duplicates += 1; issues.push({ row:item.row,message:'Unidade repetida na planilha.' }); continue; }
      seen.add(key);
      const exists = await client.query<{id:string;unit_type_id:string|null}>(`select id,unit_type_id from units where block_id=$1 and lower(number)=lower($2)`,[blockId,item.unit]);
      if (exists.rows[0]) { await client.query(`update units set unit_type_id=$1 where id=$2`,[unitTypeId,exists.rows[0].id]); duplicates += 1; continue; }
      await client.query(`insert into units(condominium_id,block_id,number,unit_type_id) values($1,$2,$3,$4)`,[condominiumId,blockId,item.unit,unitTypeId]); createdUnits += 1;
    }
    return { total: rows.length, createdBlocks, createdUnits, duplicates, invalid: issues.length, issues };
  });
  return res.status(201).json(result);
}));

router.delete('/:id', authorize('sindico','subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId;
  const unit = await query(`select id from units where id=$1 and condominium_id=$2`, [req.params.id,condominiumId]);
  if (!unit.rows[0]) return res.status(404).json({ message: 'Apartamento não encontrado.' });
  const used = await query(`select 1 from unit_occupancies where unit_id=$1 limit 1`, [req.params.id]);
  if (used.rows[0]) return res.status(409).json({ message: 'Este apartamento possui histórico de moradores e não pode ser excluído.' });
  await query(`delete from units where id=$1 and condominium_id=$2`, [req.params.id,condominiumId]);
  return res.json({ message: 'Apartamento excluído.' });
}));

router.patch('/:id', authorize('sindico','subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId; const { blockId, unitTypeId } = req.body ?? {}; const number = String(req.body?.number || '').trim();
  if (!blockId || !number || !unitTypeId) return res.status(400).json({ message:'Bloco, número e tipologia são obrigatórios.' });
  const [block,type] = await Promise.all([
    query(`select id from blocks where id=$1 and condominium_id=$2 and active=true`,[blockId,condominiumId]),
    query(`select id from unit_types where id=$1 and condominium_id=$2 and active=true`,[unitTypeId,condominiumId]),
  ]);
  if (!block.rows[0]) return res.status(400).json({ message:'Bloco inválido.' });
  if (!type.rows[0]) return res.status(400).json({ message:'Tipologia inválida.' });
  const result = await query(`update units set block_id=$1,number=$2,unit_type_id=$3 where id=$4 and condominium_id=$5 returning *`,[blockId,number,unitTypeId,req.params.id,condominiumId]);
  if (!result.rows[0]) return res.status(404).json({ message:'Apartamento não encontrado.' });
  await query(`update users set unit=$1,unit_type_id=null where unit_id=$2`,[number,req.params.id]);
  return res.json({ unit:result.rows[0],message:'Apartamento atualizado.' });
}));

router.patch('/:id/representative', authorize('sindico','subsindico'), asyncHandler(async (req, res) => {
  const condominiumId = req.user?.condominiumId; const userId = req.body?.userId || null;
  const unit = await query(`select id from units where id=$1 and condominium_id=$2`,[req.params.id,condominiumId]);
  if (!unit.rows[0]) return res.status(404).json({ message:'Unidade não encontrada.' });
  if (userId) { const resident = await query(`select id from unit_occupancies where unit_id=$1 and user_id=$2 and ended_at is null`,[req.params.id,userId]); if (!resident.rows[0]) return res.status(400).json({ message:'Selecione um morador atual desta unidade.' }); }
  await withTransaction(async client => { await client.query(`update unit_occupancies set is_representative=false where unit_id=$1 and ended_at is null`,[req.params.id]); if(userId) await client.query(`update unit_occupancies set is_representative=true where unit_id=$1 and user_id=$2 and ended_at is null`,[req.params.id,userId]); });
  return res.json({ message:'Representante atualizado.' });
}));

export default router;
