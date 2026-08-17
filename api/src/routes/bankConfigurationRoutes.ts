import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import { getInterAccessToken, type InterIntegrationConfig } from '../services/interService';

const router = Router();
router.use(authenticate, authorize('admin_geral'));

router.get('/providers', asyncHandler(async (_req, res) => {
  const result = await query<any>(`select id,name,code,adapter_key,active,created_at,updated_at from banks order by name`);
  return res.json({ providers: result.rows.map((bank:any) => ({
    id: bank.id, code: bank.code, name: bank.name, adapterKey: bank.adapter_key, active: bank.active,
    operational: bank.adapter_key === 'inter',
    requiredFields: bank.adapter_key === 'inter' ? ['clientId','clientSecret','certPath','keyPath'] : ['clientId','clientSecret'],
  })) });
}));

router.post('/banks', asyncHandler(async (req, res) => {
  const name=String(req.body?.name||'').trim();
  const code=String(req.body?.code||name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  if(!name||!code)return res.status(400).json({message:'Informe o nome do banco.'});
  const result=await query(`insert into banks(id,name,code,adapter_key,active) values($1,$2,$3,null,true) returning *`,[randomUUID(),name,code]);
  return res.status(201).json({bank:result.rows[0]});
}));

router.put('/banks/:id', asyncHandler(async(req,res)=>{
  const name=String(req.body?.name||'').trim();if(!name)return res.status(400).json({message:'Informe o nome do banco.'});
  const result=await query(`update banks set name=$2,active=$3,updated_at=now() where id=$1 returning *`,[req.params.id,name,Boolean(req.body?.active)]);
  if(!result.rows[0])return res.status(404).json({message:'Banco não encontrado.'});return res.json({bank:result.rows[0]});
}));

router.get('/', asyncHandler(async (_req, res) => {
  const result = await query(
    `select b.id, b.name, b.provider, b.bank_id, bk.name as bank_name, bk.code as bank_code, bk.adapter_key,
            b.client_id, b.cert_path, b.key_path,
            b.base_url, b.token_path, b.scopes, b.extra_config, b.enabled,
            b.created_at, b.updated_at,
            coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'purpose', cb.purpose))
              filter (where c.id is not null), '[]'::json) as condominiums
     from bank_configurations b
     left join banks bk on bk.id=b.bank_id
     left join condominium_bank_configurations cb on cb.bank_configuration_id = b.id
     left join condominiums c on c.id = cb.condominium_id
     group by b.id,bk.id
     order by b.name`,
  );
  return res.json({ configurations: result.rows });
}));

const validate = (body: any, provider: string, hasStoredSecret = false) => {
  if (!body.bankId) return 'Selecione um banco cadastrado.';
  if (!String(body.name || '').trim()) return 'Informe um nome para a configuração.';
  if (provider === 'inter') {
    if (!String(body.clientId || '').trim() || !String(body.certPath || '').trim() || !String(body.keyPath || '').trim()) {
      return 'Banco Inter exige Client ID, certificado e chave privada.';
    }
    if (!hasStoredSecret && !String(body.clientSecret || '').trim()) return 'Banco Inter exige Client Secret.';
  }
  return null;
};

router.post('/', asyncHandler(async (req, res) => {
  const bank=await query<any>(`select id,coalesce(adapter_key,'outro') provider from banks where id=$1 and active=true`,[req.body?.bankId]);
  if(!bank.rows[0])return res.status(400).json({message:'Banco cadastrado inválido ou inativo.'});
  const provider=bank.rows[0].provider;
  const error = validate(req.body,provider);
  if (error) return res.status(400).json({ message: error });
  const body = req.body;
  const result = await query(
    `insert into bank_configurations (id,name,provider,bank_id,client_id,client_secret,cert_path,key_path,
       cert_passphrase,base_url,token_path,scopes,extra_config,enabled,created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning id,name,provider,bank_id,client_id,cert_path,key_path,base_url,token_path,scopes,extra_config,enabled,created_at,updated_at`,
    [randomUUID(), String(body.name).trim(),provider,body.bankId, body.clientId || null, body.clientSecret || null,
      body.certPath || null, body.keyPath || null, body.certPassphrase || null, body.baseUrl || null,
      body.tokenPath || null, body.scopes || null, JSON.stringify(body.extraConfig || {}),
      typeof body.enabled === 'boolean' ? body.enabled : true, req.user?.id],
  );
  return res.status(201).json({ configuration: result.rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const current = await query<{client_secret:string|null}>(`select client_secret from bank_configurations where id=$1`, [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ message: 'Configuração bancária não encontrada.' });
  const bank=await query<any>(`select id,coalesce(adapter_key,'outro') provider from banks where id=$1`,[req.body?.bankId]);
  if(!bank.rows[0])return res.status(400).json({message:'Banco cadastrado inválido.'});
  const provider=bank.rows[0].provider;
  const error = validate(req.body,provider, Boolean(current.rows[0].client_secret));
  if (error) return res.status(400).json({ message: error });
  const body = req.body;
  const result = await query(
    `update bank_configurations set name=$2,provider=$3,bank_id=$4,client_id=$5,
       client_secret=coalesce($6,client_secret),cert_path=$7,key_path=$8,cert_passphrase=coalesce($9,cert_passphrase),
       base_url=$10,token_path=$11,scopes=$12,extra_config=$13,enabled=$14,updated_at=now()
     where id=$1
     returning id,name,provider,client_id,cert_path,key_path,base_url,token_path,scopes,extra_config,enabled,created_at,updated_at`,
    [req.params.id, String(body.name).trim(),provider,body.bankId, body.clientId || null, body.clientSecret || null,
      body.certPath || null, body.keyPath || null, body.certPassphrase || null, body.baseUrl || null,
      body.tokenPath || null, body.scopes || null, JSON.stringify(body.extraConfig || {}), Boolean(body.enabled)],
  );
  return res.json({ configuration: result.rows[0] });
}));

router.post('/:id/test', asyncHandler(async (req, res) => {
  const result = await query<any>(`select * from bank_configurations where id=$1`, [req.params.id]);
  const row = result.rows[0];
  if (!row) return res.status(404).json({ message: 'Configuração bancária não encontrada.' });
  if (row.provider !== 'inter') return res.status(501).json({ message: 'O adaptador deste banco ainda não foi implementado.' });
  const integration: InterIntegrationConfig = {
    id: row.id, clientId: row.client_id, clientSecret: row.client_secret, certPath: row.cert_path,
    keyPath: row.key_path, certPassphrase: row.cert_passphrase, baseUrl: row.base_url,
    tokenPath: row.token_path, scopes: row.scopes, enabled: row.enabled,
  };
  const token = await getInterAccessToken(integration);
  if (!token) return res.status(400).json({ message: 'Configuração desabilitada ou incompleta.' });
  return res.json({ ok: true });
}));

router.put('/condominiums/:condominiumId/link', asyncHandler(async (req, res) => {
  const configurationId = String(req.body?.configurationId || '');
  const rawPurposes: unknown = Array.isArray(req.body?.purposes) ? req.body.purposes : [req.body?.purpose];
  const purposes = Array.from(new Set(
    (rawPurposes as unknown[]).map(p => (p === 'extrato' ? 'extrato' : 'boleto')),
  ));
  if (purposes.length === 0) {
    return res.status(400).json({ message: 'Selecione ao menos uma finalidade (cobrança ou extrato).' });
  }
  const syncMode = req.body?.syncMode === 'from_period' ? 'from_period' : 'all';
  const syncStartPeriod = String(req.body?.syncStartPeriod || '');
  if (purposes.includes('boleto') && syncMode === 'from_period' && !/^\d{4}-\d{2}-01$/.test(syncStartPeriod)) {
    return res.status(400).json({ message: 'Informe um período inicial válido (mês/ano) para a busca de boletos.' });
  }
  const [condominium, configuration] = await Promise.all([
    query(`select id from condominiums where id=$1`, [req.params.condominiumId]),
    query(`select id from bank_configurations where id=$1`, [configurationId]),
  ]);
  if (!condominium.rows[0]) return res.status(404).json({ message: 'Condomínio não encontrado.' });
  if (!configuration.rows[0]) return res.status(404).json({ message: 'Configuração bancária não encontrada.' });

  // Ao restringir a busca a partir de um período, o admin geral também pediu
  // para excluir permanentemente (não só deixar de buscar) o que já estava
  // importado antes desse mês, inclusive boletos pagos. Boletos vinculados a
  // um acordo de débito negociado (debt_agreement_items, ON DELETE RESTRICT)
  // são preservados — apagá-los quebraria o parcelamento em andamento.
  // Essa limpeza só faz sentido para o vínculo de boleto: um vínculo de
  // extrato não importa boletos, então não há nada para apagar.
  // As finalidades marcadas são gravadas na mesma transação: se uma falhar,
  // nenhuma fica vinculada (evita o condomínio ficar com cobrança linkada e
  // extrato não, ou vice-versa, por uma falha no meio do caminho).
  const result = await withTransaction(async client => {
    let deleted = 0;
    let preserved = 0;
    for (const purpose of purposes) {
      await client.query(
        `insert into condominium_bank_configurations(condominium_id,purpose,bank_configuration_id,linked_by,linked_at,boleto_sync_mode,boleto_sync_start_period)
         values($1,$2,$3,$4,now(),$5,$6) on conflict(condominium_id,purpose) do update set
           bank_configuration_id=excluded.bank_configuration_id,linked_by=excluded.linked_by,linked_at=now(),
           boleto_sync_mode=excluded.boleto_sync_mode,boleto_sync_start_period=excluded.boleto_sync_start_period`,
        [req.params.condominiumId, purpose, configurationId, req.user?.id, syncMode, syncMode === 'from_period' ? syncStartPeriod : null],
      );
      if (purpose !== 'boleto' || syncMode !== 'from_period') continue;

      const preservedResult = await client.query<{ count: number }>(
        `select count(*)::int as count from invoices i
         where i.condominium_id=$1 and i.due_date < $2
           and exists (select 1 from debt_agreement_items dai where dai.invoice_id = i.id)`,
        [req.params.condominiumId, syncStartPeriod],
      );
      const deletedResult = await client.query(
        `delete from invoices
         where condominium_id=$1 and due_date < $2
           and not exists (select 1 from debt_agreement_items dai where dai.invoice_id = invoices.id)
         returning id`,
        [req.params.condominiumId, syncStartPeriod],
      );
      deleted += deletedResult.rows.length;
      preserved += preservedResult.rows[0]?.count || 0;
    }
    return { deleted, preserved };
  });

  return res.json({ ok: true, deleted: result.deleted, preserved: result.preserved });
}));

router.delete('/condominiums/:condominiumId/link', asyncHandler(async (req, res) => {
  const purpose = req.query.purpose === 'extrato' ? 'extrato' : 'boleto';
  await query(`delete from condominium_bank_configurations where condominium_id=$1 and purpose=$2`, [req.params.condominiumId, purpose]);
  return res.status(204).send();
}));

export default router;
