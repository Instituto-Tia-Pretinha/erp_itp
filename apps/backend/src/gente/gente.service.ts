import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { GenteColaborador } from './entities/gente-colaborador.entity';
import { GenteRecibo } from './entities/gente-recibo.entity';
import { GenteVale } from './entities/gente-vale.entity';
import { GenteAdvertencia } from './entities/gente-advertencia.entity';
import { GenteSuspensao } from './entities/gente-suspensao.entity';
import { GenteFalta } from './entities/gente-falta.entity';
import { GenteCodigoAjuda } from './entities/gente-codigo-ajuda.entity';
import { GenteColaboradorCodigo } from './entities/gente-colaborador-codigo.entity';
import { GenteColaboradorLocal } from './entities/gente-colaborador-local.entity';
import { GenteFolgaSolicitacao } from './entities/gente-folga-solicitacao.entity';
import { GenteTrabalhoExterno } from './entities/gente-trabalho-externo.entity';
import { GenteColaboradorDocumento } from './entities/gente-colaborador-documento.entity';
import { GenteFeriado } from './entities/gente-feriado.entity';
import { GentePagamentoPassagem } from './entities/gente-pagamento-passagem.entity';
import { MovimentacaoFinanceira } from '../financeiro/entities/movimentacao-financeira.entity';


@Injectable()
export class GenteService {
  constructor(
    @InjectRepository(GenteColaborador) private colaboradorRepo: Repository<GenteColaborador>,
    @InjectRepository(GenteRecibo) private reciboRepo: Repository<GenteRecibo>,
    @InjectRepository(GenteVale) private valeRepo: Repository<GenteVale>,
    @InjectRepository(GenteAdvertencia) private advertenciaRepo: Repository<GenteAdvertencia>,
    @InjectRepository(GenteSuspensao) private suspensaoRepo: Repository<GenteSuspensao>,
    @InjectRepository(GenteFalta) private faltaRepo: Repository<GenteFalta>,
    @InjectRepository(GenteCodigoAjuda) private codigoRepo: Repository<GenteCodigoAjuda>,
    @InjectRepository(GenteColaboradorCodigo) private colCodigoRepo: Repository<GenteColaboradorCodigo>,
    @InjectRepository(GenteColaboradorLocal) private localRepo: Repository<GenteColaboradorLocal>,
    @InjectRepository(GenteFolgaSolicitacao) private folgaRepo: Repository<GenteFolgaSolicitacao>,
    @InjectRepository(GenteTrabalhoExterno) private trabalhoExternoRepo: Repository<GenteTrabalhoExterno>,
    @InjectRepository(GenteColaboradorDocumento) private documentoRepo: Repository<GenteColaboradorDocumento>,
    @InjectRepository(GenteFeriado) private feriadoRepo: Repository<GenteFeriado>,
    @InjectRepository(GentePagamentoPassagem) private pagamentoPassagemRepo: Repository<GentePagamentoPassagem>,
    @InjectRepository(MovimentacaoFinanceira) private movimentacaoRepo: Repository<MovimentacaoFinanceira>,
    private dataSource: DataSource,
    private supabase: SupabaseService,
  ) {}

  async onModuleInit() {
    const run = async (sql: string) => { try { await this.dataSource.query(sql); } catch { /* idempotente */ } };

    await run(`
      CREATE TABLE IF NOT EXISTS gente_colaborador_documentos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        colaborador_id UUID NOT NULL,
        nome TEXT NOT NULL,
        url TEXT,
        vencimento DATE,
        observacao TEXT,
        criado_por_id TEXT,
        criado_por_nome TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await run(`ALTER TABLE gente_colaborador_documentos ADD COLUMN IF NOT EXISTS categoria TEXT DEFAULT 'pessoal'`);
    await run(`ALTER TABLE IF EXISTS gente_vales ADD COLUMN IF NOT EXISTS ficha_url TEXT`);
    await run(`ALTER TABLE IF EXISTS gente_colaboradores ADD COLUMN IF NOT EXISTS dias_home_office JSONB`);
    await run(`
      CREATE TABLE IF NOT EXISTS gente_feriados (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        data DATE NOT NULL UNIQUE,
        descricao TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'institucional',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  // ── Feriados ──────────────────────────────────────────────────────────────

  async listarFeriados(ano?: number) {
    const rows = await this.feriadoRepo.find({ order: { data: 'ASC' } });
    if (!ano) return rows;
    return rows.filter(f => f.data.startsWith(String(ano)));
  }

  async criarFeriado(dto: { data: string; descricao: string; tipo?: string }) {
    const existing = await this.feriadoRepo.findOneBy({ data: dto.data });
    if (existing) {
      await this.feriadoRepo.update(existing.id, { descricao: dto.descricao, tipo: dto.tipo ?? 'institucional' });
      return this.feriadoRepo.findOneBy({ id: existing.id });
    }
    return this.feriadoRepo.save(this.feriadoRepo.create({ ...dto, tipo: dto.tipo ?? 'institucional' }));
  }

  async deletarFeriado(id: string) { await this.feriadoRepo.delete(id); return { ok: true }; }

  /** Retorna Set de datas (YYYY-MM-DD) de feriados no intervalo [inicioISO, fimISO] */
  private async _feriadosNoIntervalo(inicioISO: string, fimISO: string): Promise<Set<string>> {
    const rows: Array<{ data: string }> = await this.dataSource.query(
      `SELECT data::text FROM gente_feriados WHERE data >= $1::date AND data <= $2::date`,
      [inicioISO, fimISO],
    );
    return new Set(rows.map(r => String(r.data).slice(0, 10)));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async enrichColaborador(col: GenteColaborador) {
    const [func] = await this.dataSource.query(
      `SELECT id, nome, cargo, email, cpf, celular, rg, orgao_emissor_rg,
              TO_CHAR(data_emissao_rg, 'YYYY-MM-DD') AS data_emissao_rg,
              estado_civil, pais,
              TO_CHAR(data_nascimento, 'YYYY-MM-DD') AS data_nascimento,
              cep, logradouro, numero_residencia,
              complemento, bairro, cidade, estado, telefone_emergencia_1, telefone_emergencia_2,
              sexo, raca_cor, escolaridade,
              possui_deficiencia, deficiencia_descricao,
              possui_alergias, alergias_descricao,
              usa_medicamentos, medicamentos_descricao,
              possui_plano_saude, plano_saude, numero_sus,
              interesse_cursos, genero,
              pertence_comunidade_tradicional, comunidade_tradicional,
              possui_cad_unico, baixo_idh,
              matricula, ativo, foto FROM funcionarios WHERE id = $1`,
      [col.funcionario_id],
    );
    if (func?.foto) func.foto = await this.supabase.resolveUrl(func.foto);
    return { ...col, funcionario: func ?? null };
  }

  // ── Colaboradores ──────────────────────────────────────────────────────────

  async listarColaboradores() {
    const colaboradores = await this.colaboradorRepo.find({ where: { ativo: true }, order: { createdAt: 'DESC' } });
    if (!colaboradores.length) return [];
    const ids = colaboradores.map(c => c.funcionario_id);
    const funcionarios: any[] = await this.dataSource.query(
      `SELECT id, nome, cargo, email, cpf, celular, rg, orgao_emissor_rg,
              TO_CHAR(data_emissao_rg, 'YYYY-MM-DD') AS data_emissao_rg,
              estado_civil, pais,
              TO_CHAR(data_nascimento, 'YYYY-MM-DD') AS data_nascimento,
              cep, logradouro, numero_residencia,
              complemento, bairro, cidade, estado, telefone_emergencia_1, telefone_emergencia_2,
              sexo, raca_cor, escolaridade,
              possui_deficiencia, deficiencia_descricao,
              possui_alergias, alergias_descricao,
              usa_medicamentos, medicamentos_descricao,
              possui_plano_saude, plano_saude, numero_sus,
              interesse_cursos, genero,
              pertence_comunidade_tradicional, comunidade_tradicional,
              possui_cad_unico, baixo_idh,
              matricula, ativo, foto FROM funcionarios WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    await Promise.all(funcionarios.map(async f => {
      if (f.foto) f.foto = await this.supabase.resolveUrl(f.foto);
    }));
    const funcMap: Record<string, any> = {};
    funcionarios.forEach(f => (funcMap[f.id] = f));
    return colaboradores.map(c => ({ ...c, funcionario: funcMap[c.funcionario_id] ?? null }));
  }

  async buscarColaborador(id: string) {
    const col = await this.colaboradorRepo.findOne({ where: { id } });
    if (!col) throw new NotFoundException('Colaborador não encontrado.');
    return this.enrichColaborador(col);
  }

  async criarColaborador(dto: any) {
    const existe = await this.colaboradorRepo.findOne({ where: { funcionario_id: dto.funcionario_id } });
    if (existe) throw new BadRequestException('Este funcionário já está cadastrado no módulo Gente.');
    const col = this.colaboradorRepo.create(dto);
    return this.colaboradorRepo.save(col);
  }

  /** Cria funcionário + colaborador em um único passo (sem precisar ir ao Cadastro Básico) */
  async criarFuncionarioEColaborador(funcDto: any, colDto: any, criadoPorId: string) {
    let func: any;

    // 1. Se CPF fornecido, verifica se já existe para reutilizar em vez de duplicar
    if (funcDto.cpf) {
      const cpfNorm = String(funcDto.cpf).replace(/\D/g, '');
      const [existente] = await this.dataSource.query(
        `SELECT id, nome, cargo, matricula FROM funcionarios
         WHERE REGEXP_REPLACE(cpf, '[^0-9]', '', 'g') = $1 LIMIT 1`,
        [cpfNorm],
      );
      if (existente) {
        // Verifica se já tem colaborador
        const jaCol = await this.colaboradorRepo.findOne({ where: { funcionario_id: existente.id } });
        if (jaCol) throw new BadRequestException(`${existente.nome} já está cadastrado no módulo Gente (CPF duplicado).`);
        func = existente;
      }
    }

    // 2. Cria funcionário se não encontrou pelo CPF
    if (!func) {
      const now = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const rows: any[] = await this.dataSource.query(
        `SELECT COUNT(*) as total FROM funcionarios WHERE matricula LIKE $1`,
        [`ITP-FUNC-${yyyymm}-%`],
      );
      const seq = String(Number(rows[0]?.total ?? 0) + 1).padStart(3, '0');
      const matricula = `ITP-FUNC-${yyyymm}-${seq}`;

      const [inserted] = await this.dataSource.query(
        `INSERT INTO funcionarios (
          nome, cargo, email, cpf, celular, data_nascimento, sexo, genero, raca_cor, escolaridade,
          cep, logradouro, numero_residencia, complemento, bairro, cidade, estado, pais,
          estado_civil, rg, orgao_emissor_rg, data_emissao_rg,
          telefone_emergencia_1, telefone_emergencia_2,
          possui_deficiencia, deficiencia_descricao,
          possui_alergias, alergias_descricao,
          usa_medicamentos, medicamentos_descricao,
          possui_plano_saude, plano_saude, numero_sus,
          interesse_cursos, pertence_comunidade_tradicional, comunidade_tradicional,
          possui_cad_unico, baixo_idh,
          matricula, ativo
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,true
        ) RETURNING id, nome, cargo, matricula`,
        [
          funcDto.nome, funcDto.cargo || null, funcDto.email || null, funcDto.cpf || null,
          funcDto.celular || null, funcDto.data_nascimento || null, funcDto.sexo || null,
          funcDto.genero || null, funcDto.raca_cor || null, funcDto.escolaridade || null,
          funcDto.cep || null, funcDto.logradouro || null, funcDto.numero_residencia || null,
          funcDto.complemento || null, funcDto.bairro || null, funcDto.cidade || null,
          funcDto.estado || null, funcDto.pais || 'Brasil',
          funcDto.estado_civil || null, funcDto.rg || null,
          funcDto.orgao_emissor_rg || null, funcDto.data_emissao_rg || null,
          funcDto.telefone_emergencia_1 || null, funcDto.telefone_emergencia_2 || null,
          funcDto.possui_deficiencia ?? false, funcDto.deficiencia_descricao || null,
          funcDto.possui_alergias ?? false, funcDto.alergias_descricao || null,
          funcDto.usa_medicamentos ?? false, funcDto.medicamentos_descricao || null,
          funcDto.possui_plano_saude ?? false, funcDto.plano_saude || null, funcDto.numero_sus || null,
          funcDto.interesse_cursos ?? false, funcDto.pertence_comunidade_tradicional ?? false,
          funcDto.comunidade_tradicional || null,
          funcDto.possui_cad_unico ?? false, funcDto.baixo_idh ?? false,
          matricula,
        ],
      );
      func = inserted;
    }

    // 3. Cria colaborador vinculado
    const col = this.colaboradorRepo.create({
      funcionario_id: func.id,
      tipo: colDto.tipo ?? 'voluntario',
      horario_entrada: colDto.horario_entrada ?? '08:00',
      horario_saida: colDto.horario_saida ?? '17:00',
      dias_trabalho: colDto.dias_trabalho ?? ['seg', 'ter', 'qua', 'qui', 'sex'],
      raio_metros: colDto.raio_metros ?? 100,
      latitude_permitida: colDto.latitude_permitida ?? -22.8597901,
      longitude_permitida: colDto.longitude_permitida ?? -43.3308139,
      jornada_flexivel: colDto.jornada_flexivel ?? false,
      horas_dia_flex: colDto.horas_dia_flex ?? null,
      horario_flexivel_semana: colDto.horario_flexivel_semana ?? null,
    });
    const saved = await this.colaboradorRepo.save(col);
    return { ...saved, funcionario: func };
  }

  async editarColaborador(id: string, dto: any) {
    const colunas = ['tipo','horario_entrada','horario_saida','dias_trabalho',
      'latitude_permitida','longitude_permitida','raio_metros','ativo',
      'jornada_flexivel','horas_dia_flex','horario_flexivel_semana','valor_passagem',
      'dias_home_office','pagamento_isento'];
    const payload: any = {};
    colunas.forEach(k => { if (dto[k] !== undefined) payload[k] = dto[k]; });
    if (Object.keys(payload).length) await this.colaboradorRepo.update(id, payload);
    return this.buscarColaborador(id);
  }

  async uploadFotoColaborador(colaboradorId: string, fotoDataUrl: string) {
    const col = await this.colaboradorRepo.findOne({ where: { id: colaboradorId } });
    if (!col) throw new NotFoundException('Colaborador não encontrado.');
    const match = fotoDataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) throw new BadRequestException('Formato inválido');
    const mime = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const storagePath = await this.supabase.upload(buffer, `funcionarios/${col.funcionario_id}.${ext}`, mime);
    await this.dataSource.query(`UPDATE funcionarios SET foto = $1 WHERE id = $2`, [storagePath, col.funcionario_id]);
    return this.buscarColaborador(colaboradorId);
  }

  async editarFuncionarioViaGente(colaboradorId: string, dto: any) {
    const col = await this.colaboradorRepo.findOne({ where: { id: colaboradorId } });
    if (!col) throw new NotFoundException('Colaborador não encontrado.');
    if (!col.funcionario_id) throw new BadRequestException('Colaborador sem funcionário vinculado — não é possível atualizar dados cadastrais.');
    const campos = ['nome','cargo','email','cpf','celular','rg','orgao_emissor_rg','data_emissao_rg',
      'estado_civil','pais','data_nascimento','cep','logradouro','numero_residencia',
      'complemento','bairro','cidade','estado','telefone_emergencia_1','telefone_emergencia_2',
      'sexo','raca_cor','escolaridade',
      'possui_deficiencia','deficiencia_descricao',
      'possui_alergias','alergias_descricao',
      'usa_medicamentos','medicamentos_descricao',
      'possui_plano_saude','plano_saude','numero_sus',
      'interesse_cursos','genero',
      'pertence_comunidade_tradicional','comunidade_tradicional',
      'possui_cad_unico','baixo_idh'];
    // Sanitiza: string vazia → null (evita erro em colunas DATE/NUMERIC)
    // Normaliza timestamps ISO → YYYY-MM-DD para colunas DATE
    const dateFields = new Set(['data_nascimento', 'data_emissao_rg']);
    const sanitizado: any = {};
    campos.forEach(c => {
      if (dto[c] === undefined) return;
      let val = dto[c] === '' ? null : dto[c];
      if (val && typeof val === 'string' && dateFields.has(c) && val.length > 10) val = val.slice(0, 10);
      sanitizado[c] = val;
    });
    const keys = Object.keys(sanitizado);
    if (!keys.length) return this.buscarColaborador(colaboradorId);
    const sets = keys.map((c, i) => `${c} = $${i + 2}`);
    const vals = keys.map(c => sanitizado[c]);
    const updated = await this.dataSource.query(
      `UPDATE funcionarios SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
      [col.funcionario_id, ...vals],
    );
    if (!updated?.length) throw new NotFoundException('Funcionário não encontrado na base de dados — dado pode ter sido excluído.');
    return this.buscarColaborador(colaboradorId);
  }

  // ── Resumo Financeiro ─────────────────────────────────────────────────────

  async resumoFinanceiro(mes: string) {
    const colaboradores = await this.colaboradorRepo.find({ where: { ativo: true } });
    const mesInicio = `${mes}-01`;
    const mesFim = new Date(Number(mes.split('-')[0]), Number(mes.split('-')[1]), 0).toISOString().split('T')[0];
    const feriadosMes = await this._feriadosNoIntervalo(mesInicio, mesFim);

    const rows = await Promise.all(colaboradores.map(async col => {
      const [func] = await this.dataSource.query(
        `SELECT id, nome, cargo, foto FROM funcionarios WHERE id = $1`, [col.funcionario_id]);
      if (!func) return null;

      const codigosCol = await this.listarCodigosColaborador(col.id);
      const totalVR = codigosCol.reduce((s, cc) => s + Number(cc.valor_efetivo ?? 0), 0);
      const totalProventos = totalVR;

      // Vales pendentes (não descontados, do mês corrente ou acumulados)
      const valesPendentes: any[] = await this.dataSource.query(
        `SELECT COALESCE(SUM(valor),0) AS total, COUNT(*) AS qtd FROM gente_vales
         WHERE colaborador_id = $1 AND descontado = false AND data <= $2`,
        [col.id, mesFim],
      );
      const totalVales = Number(valesPendentes[0]?.total ?? 0);
      const qtdVales = Number(valesPendentes[0]?.qtd ?? 0);

      // Outros descontos: advertências com valor_desconto e faltas com desconto no mês
      const advertenciasRows: any[] = await this.dataSource.query(
        `SELECT COALESCE(SUM(valor_desconto),0) AS total, COUNT(*) AS qtd
         FROM gente_advertencias
         WHERE colaborador_id = $1 AND valor_desconto > 0 AND data >= $2 AND data <= $3`,
        [col.id, mesInicio, mesFim],
      );
      const totalAdv = Number(advertenciasRows[0]?.total ?? 0);
      const qtdAdv = Number(advertenciasRows[0]?.qtd ?? 0);

      const faltasRows: any[] = await this.dataSource.query(
        `SELECT percentual_desconto FROM gente_faltas
         WHERE colaborador_id = $1 AND com_desconto = true AND tipo = 'falta' AND data >= $2 AND data <= $3`,
        [col.id, mesInicio, mesFim],
      );
      const totalFaltas = faltasRows.reduce((s, f) => {
        const pct = Number(f.percentual_desconto ?? 100) / 100;
        return s + Math.round(totalProventos * pct * 100) / 100;
      }, 0);
      const qtdFaltas = faltasRows.length;

      const suspensoesRows: any[] = await this.dataSource.query(
        `SELECT data_inicio::text, data_fim::text FROM gente_suspensoes
         WHERE colaborador_id = $1 AND com_desconto = true AND data_inicio <= $2 AND data_fim >= $3`,
        [col.id, mesFim, mesInicio],
      );
      const totalSuspensoes = suspensoesRows.reduce((s, sus) => {
        const ini = new Date(sus.data_inicio > mesInicio ? sus.data_inicio : mesInicio);
        const fim = new Date(sus.data_fim < mesFim ? sus.data_fim : mesFim);
        const dias = Math.max(0, Math.round((fim.getTime() - ini.getTime()) / 86400000) + 1);
        return s + Math.round((totalProventos / 30) * dias * 100) / 100;
      }, 0);
      const qtdSuspensoes = suspensoesRows.length;

      const totalOutrosDescontos = totalAdv + totalFaltas + totalSuspensoes;
      const qtdOutrosDescontos = qtdAdv + qtdFaltas + qtdSuspensoes;

      // Recibo do mês
      const recibo: any[] = await this.dataSource.query(
        `SELECT id, status, valor FROM gente_recibos WHERE colaborador_id = $1 AND mes_referencia = $2 LIMIT 1`,
        [col.id, mes],
      );

      return {
        colaborador_id: col.id,
        nome: func.nome,
        cargo: func.cargo,
        foto: func.foto,
        total_vr: totalVR,
        total_proventos: totalProventos,
        vales_pendentes: totalVales,
        qtd_vales_pendentes: qtdVales,
        outros_descontos: totalOutrosDescontos,
        qtd_outros_descontos: qtdOutrosDescontos,
        total_descontos: totalVales + totalOutrosDescontos,
        liquido: totalProventos - totalVales - totalOutrosDescontos,
        recibo_id: recibo[0]?.id ?? null,
        recibo_status: recibo[0]?.status ?? null,
        pagamento_isento: !!col.pagamento_isento,
      };
    }));

    const lista = rows.filter(Boolean);
    return {
      mes,
      colaboradores: lista,
      totais: {
        total_folha: lista.reduce((s, r) => s + r!.total_proventos, 0),
        total_vales: lista.reduce((s, r) => s + r!.vales_pendentes, 0),
        total_outros_descontos: lista.reduce((s, r) => s + r!.outros_descontos, 0),
        total_liquido: lista.reduce((s, r) => s + r!.liquido, 0),
      },
    };
  }

  async removerColaborador(id: string) {
    await this.colaboradorRepo.update(id, { ativo: false });
    return { ok: true };
  }

  async funcionariosDisponiveis() {
    const vinculados = await this.colaboradorRepo.find({ select: ['funcionario_id'] });
    const ids = vinculados.map(c => c.funcionario_id);
    if (!ids.length) {
      return this.dataSource.query(`SELECT id, nome, cargo, cpf, matricula FROM funcionarios WHERE ativo = true ORDER BY nome`);
    }
    return this.dataSource.query(
      `SELECT id, nome, cargo, cpf, matricula FROM funcionarios WHERE ativo = true AND id <> ALL($1::uuid[]) ORDER BY nome`,
      [ids],
    );
  }

  // ── Códigos de Ajuda de Custo (VRX) ──────────────────────────────────────

  async listarCodigos() {
    return this.codigoRepo.find({ order: { codigo: 'ASC' } });
  }

  async criarCodigo(dto: any) {
    // Auto-gera código VRxxx
    const ultimo: any[] = await this.dataSource.query(
      `SELECT codigo FROM gente_codigos_ajuda ORDER BY codigo DESC LIMIT 1`,
    );
    let proximo = 1;
    if (ultimo.length && ultimo[0].codigo?.match(/^VR(\d+)$/)) {
      proximo = parseInt(ultimo[0].codigo.replace('VR', ''), 10) + 1;
    }
    const codigo = `VR${String(proximo).padStart(3, '0')}`;
    return this.codigoRepo.save(this.codigoRepo.create({ ...dto, codigo }));
  }

  async editarCodigo(id: string, dto: any) {
    await this.codigoRepo.update(id, dto);
    return this.codigoRepo.findOneBy({ id });
  }

  async deletarCodigo(id: string) {
    await this.codigoRepo.delete(id);
    return { ok: true };
  }

  // ── Códigos por colaborador ───────────────────────────────────────────────

  async listarCodigosColaborador(colaborador_id: string) {
    const links = await this.colCodigoRepo.find({ where: { colaborador_id, ativo: true } });
    if (!links.length) return [];
    const codigoIds = links.map(l => l.codigo_id);
    const codigos = await this.codigoRepo.find({ where: codigoIds.map(id => ({ id })) as any });
    const codigoMap: Record<string, any> = {};
    codigos.forEach(c => (codigoMap[c.id] = c));
    return links.map(l => ({
      ...l,
      codigo: codigoMap[l.codigo_id] ?? null,
      valor_efetivo: l.valor_personalizado ?? codigoMap[l.codigo_id]?.valor_base ?? 0,
    }));
  }

  async atribuirCodigoColaborador(colaborador_id: string, codigo_id: string, valor_personalizado?: number) {
    const existente = await this.colCodigoRepo.findOne({ where: { colaborador_id, codigo_id } });
    if (existente) {
      await this.colCodigoRepo.update(existente.id, { ativo: true, valor_personalizado: valor_personalizado ?? undefined });
      return this.colCodigoRepo.findOneBy({ id: existente.id });
    }
    return this.colCodigoRepo.save(this.colCodigoRepo.create({ colaborador_id, codigo_id, valor_personalizado: valor_personalizado ?? undefined }));
  }

  async removerCodigoColaborador(id: string) {
    await this.colCodigoRepo.update(id, { ativo: false });
    return { ok: true };
  }

  // ── Cálculo de Folha ──────────────────────────────────────────────────────

  async calcularFolha(mes_referencia: string, criado_por_id: string, criado_por_nome: string) {
    // mes_referencia: YYYY-MM
    const colaboradores = await this.colaboradorRepo.find({ where: { ativo: true } });
    const resultados: any[] = [];

    for (const col of colaboradores) {
      const [func] = await this.dataSource.query(
        `SELECT id, nome, cargo, matricula FROM funcionarios WHERE id = $1`,
        [col.funcionario_id],
      );
      if (!func) continue;

      const mesRef = mes_referencia.slice(2).replace('-', '/').toUpperCase();
      const proventos: any[] = [];
      const codigosCol = await this.listarCodigosColaborador(col.id);
      codigosCol.forEach(cc => proventos.push({
        codigo: cc.codigo?.codigo ?? '',
        descricao: cc.codigo?.descricao ?? '',
        referencia: mesRef,
        valor: Number(cc.valor_efetivo),
      }));
      if (col.valor_passagem && Number(col.valor_passagem) > 0) {
        const [ano, mes] = mes_referencia.split('-').map(Number);
        const mesInicioVT = `${mes_referencia}-01`;
        const mesFimVT = new Date(ano, mes, 0).toISOString().split('T')[0];
        const feriadosMesVT = await this._feriadosNoIntervalo(mesInicioVT, mesFimVT);
        const diasTrab = this._contarDiasTrabalho(col.dias_trabalho ?? [], ano, mes, feriadosMesVT);
        const vtMensal = Number(col.valor_passagem) * diasTrab;
        if (vtMensal > 0) {
          proventos.push({ codigo: 'VT', descricao: `VALE TRANSPORTE (${diasTrab}x)`, referencia: mesRef, valor: vtMensal });
        }
      }
      const totalProventos = proventos.reduce((s, p) => s + p.valor, 0);

      // Descontos: vales não descontados do mês + advertências graves
      const mesInicio = `${mes_referencia}-01`;
      const mesFim = new Date(Number(mes_referencia.split('-')[0]), Number(mes_referencia.split('-')[1]), 0)
        .toISOString().split('T')[0];

      // Resetar vales do recibo anterior ao regenerar
      const recAnterior = await this.reciboRepo.findOne({ where: { colaborador_id: col.id, mes_referencia } });
      if (recAnterior?.observacao) {
        try {
          const obs = JSON.parse(recAnterior.observacao);
          const valeIds: string[] = (obs.descontos ?? []).filter((d: any) => d.vale_id).map((d: any) => d.vale_id);
          for (const vid of valeIds) {
            await this.valeRepo.update(vid, { descontado: false });
          }
        } catch { /* ignorar JSON inválido */ }
      }

      // Vales pendentes até o fim do mês (inclui meses anteriores não descontados)
      const valesDoMes = await this.valeRepo
        .createQueryBuilder('v')
        .where('v.colaborador_id = :id', { id: col.id })
        .andWhere('v.descontado = false')
        .andWhere('v.data <= :fim', { fim: mesFim })
        .getMany();

      const descontos: any[] = valesDoMes.map(v => ({
        codigo: 'VALE',
        descricao: `Vale ${v.tipo.toUpperCase()}${v.descricao ? ' — ' + v.descricao : ''}`,
        referencia: mes_referencia.slice(2).replace('-', '/').toUpperCase(),
        valor: Number(v.valor),
        vale_id: v.id,
      }));

      // Advertências com valor_desconto no mês
      const advertenciasDoMes = await this.advertenciaRepo
        .createQueryBuilder('a')
        .where('a.colaborador_id = :id', { id: col.id })
        .andWhere('a.valor_desconto IS NOT NULL')
        .andWhere('a.valor_desconto > 0')
        .andWhere('a.data >= :inicio', { inicio: mesInicio })
        .andWhere('a.data <= :fim', { fim: mesFim })
        .getMany();

      for (const a of advertenciasDoMes) {
        descontos.push({
          codigo: 'ADV',
          descricao: `Advertência ${a.nivel.toUpperCase()} — ${a.motivo.substring(0, 40)}`,
          referencia: mes_referencia.slice(2).replace('-', '/').toUpperCase(),
          valor: Math.round(Number(a.valor_desconto) * 100) / 100,
        });
      }

      // Faltas com desconto no mês
      const faltasDoMes = await this.faltaRepo
        .createQueryBuilder('f')
        .where('f.colaborador_id = :id', { id: col.id })
        .andWhere('f.com_desconto = true')
        .andWhere('f.tipo = :tipo', { tipo: 'falta' })
        .andWhere('f.data >= :inicio', { inicio: mesInicio })
        .andWhere('f.data <= :fim', { fim: mesFim })
        .getMany();

      for (const f of faltasDoMes) {
        const pct = Number(f.percentual_desconto ?? 100) / 100;
        const valorDesc = Math.round(totalProventos * pct * 100) / 100;
        if (valorDesc > 0) {
          descontos.push({
            codigo: 'FALTA',
            descricao: `Falta ${f.data}${f.motivo ? ' — ' + f.motivo.substring(0, 30) : ''}`,
            referencia: mes_referencia.slice(2).replace('-', '/').toUpperCase(),
            valor: valorDesc,
          });
        }
      }

      // Suspensões com desconto que se sobrepõem ao mês
      const suspensoesDoMes = await this.suspensaoRepo
        .createQueryBuilder('s')
        .where('s.colaborador_id = :id', { id: col.id })
        .andWhere('s.com_desconto = true')
        .andWhere('s.data_inicio <= :fim', { fim: mesFim })
        .andWhere('s.data_fim >= :inicio', { inicio: mesInicio })
        .getMany();

      for (const s of suspensoesDoMes) {
        const ini = new Date(s.data_inicio > mesInicio ? s.data_inicio : mesInicio);
        const fim2 = new Date(s.data_fim < mesFim ? s.data_fim : mesFim);
        const dias = Math.max(0, Math.round((fim2.getTime() - ini.getTime()) / 86400000) + 1);
        if (dias > 0) {
          descontos.push({
            codigo: 'SUSP',
            descricao: `Suspensão ${dias}d — ${s.motivo.substring(0, 30)}`,
            referencia: mes_referencia.slice(2).replace('-', '/').toUpperCase(),
            valor: Math.round((totalProventos / 30) * dias * 100) / 100,
          });
        }
      }

      const totalDescontos = descontos.reduce((s, d) => s + d.valor, 0);
      const liquido = totalProventos - totalDescontos;

      // Marca vales como descontados (sem criar Receita — adiantamento já é Saída, o desconto é a compensação)
      for (const v of valesDoMes) {
        await this.valeRepo.update(v.id, { descontado: true });
      }

      // Gera recibo
      const reciboExistente = await this.reciboRepo.findOne({
        where: { colaborador_id: col.id, mes_referencia },
      });

      const reciboData: any = {
        colaborador_id: col.id,
        mes_referencia,
        valor: liquido,
        descricao: `Folha ${mes_referencia}`,
        status: 'pendente',
        observacao: JSON.stringify({ proventos, descontos, totalProventos, totalDescontos }),
        criado_por_id,
        criado_por_nome,
      };

      let recibo: any;
      if (reciboExistente) {
        await this.reciboRepo.update(reciboExistente.id, reciboData);
        recibo = { ...reciboExistente, ...reciboData };
      } else {
        recibo = await this.reciboRepo.save(this.reciboRepo.create(reciboData));
      }

      // Cria (ou atualiza) Saída de salário líquido no financeiro
      try {
        const [ano, mes] = mes_referencia.split('-');
        const mesesAbr = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
        const competencia = `${mesesAbr[parseInt(mes, 10) - 1]}/${ano}`;
        const movId = reciboExistente?.movimentacao_id;
        if (movId) {
          await this.movimentacaoRepo.update(movId, { valor: liquido });
        } else {
          const mov = await this.movimentacaoRepo.save(this.movimentacaoRepo.create({
            nome: `Salário — ${func.nome}`,
            tipo_movimentacao: 'Saída',
            plano_contas: 'Funcionarios 2026',
            categoria: 'Salário',
            forma_pagamento: 'PIX',
            valor: liquido,
            data: mes_referencia + '-01',
            status: 'Pendente',
            competencia,
            descricao: `Salário líquido ${mes_referencia} — ${func.nome}`,
            usuario_nome: criado_por_nome ?? null,
          }));
          await this.reciboRepo.update(recibo.id, { movimentacao_id: mov.id });
          recibo.movimentacao_id = mov.id;
        }
      } catch { /* não bloqueia a folha */ }

      resultados.push({
        colaborador_id: col.id,
        funcionario_nome: func.nome,
        funcionario_cargo: func.cargo,
        matricula: func.matricula,
        proventos,
        descontos,
        totalProventos,
        totalDescontos,
        liquido,
        recibo_id: recibo.id,
      });
    }

    return { mes_referencia, total_colaboradores: resultados.length, resultados };
  }

  private _contarDiasTrabalho(diasSemana: string[], ano: number, mes: number, feriados: Set<string> = new Set()): number {
    const mapa: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
    const alvos = new Set((diasSemana ?? []).map(d => mapa[d]).filter(n => n !== undefined));
    const totalDias = new Date(ano, mes, 0).getDate();
    let count = 0;
    for (let d = 1; d <= totalDias; d++) {
      const date = new Date(ano, mes - 1, d);
      const iso = `${ano}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      if (alvos.has(date.getDay()) && !feriados.has(iso)) count++;
    }
    return count;
  }

  private async _computarFolhaColaborador(col: any, mes_referencia: string) {
    const [func] = await this.dataSource.query(
      `SELECT id, nome, cargo, matricula FROM funcionarios WHERE id = $1`,
      [col.funcionario_id],
    );
    if (!func) return null;

    const mesRef = mes_referencia.slice(2).replace('-', '/').toUpperCase();
    const proventos: any[] = [];
    const codigosCol = await this.listarCodigosColaborador(col.id);
    codigosCol.forEach(cc => proventos.push({
      codigo: cc.codigo?.codigo ?? '',
      descricao: cc.codigo?.descricao ?? '',
      referencia: mesRef,
      valor: Number(cc.valor_efetivo),
    }));
    const mesInicio = `${mes_referencia}-01`;
    const mesFim = new Date(Number(mes_referencia.split('-')[0]), Number(mes_referencia.split('-')[1]), 0)
      .toISOString().split('T')[0];

    // Vales pendentes até o fim do mês (inclui meses anteriores não descontados)
    const valesDoMes = await this.valeRepo
      .createQueryBuilder('v')
      .where('v.colaborador_id = :id', { id: col.id })
      .andWhere('v.descontado = false')
      .andWhere('v.data <= :fim', { fim: mesFim })
      .getMany();

    const descontos: any[] = valesDoMes.map(v => ({
      codigo: 'VALE',
      descricao: `Vale ${v.tipo.toUpperCase()}${v.descricao ? ' — ' + v.descricao : ''}`,
      referencia: mesRef,
      valor: Number(v.valor),
      vale_id: v.id,
    }));

    // Advertências com valor_desconto no mês
    const advertenciasDoMes = await this.advertenciaRepo
      .createQueryBuilder('a')
      .where('a.colaborador_id = :id', { id: col.id })
      .andWhere('a.valor_desconto IS NOT NULL')
      .andWhere('a.valor_desconto > 0')
      .andWhere('a.data >= :inicio', { inicio: mesInicio })
      .andWhere('a.data <= :fim', { fim: mesFim })
      .getMany();

    for (const a of advertenciasDoMes) {
      descontos.push({
        codigo: 'ADV',
        descricao: `Advertência ${a.nivel.toUpperCase()} — ${a.motivo.substring(0, 40)}`,
        referencia: mesRef,
        valor: Math.round(Number(a.valor_desconto) * 100) / 100,
      });
    }

    const totalProventos = proventos.reduce((s, p) => s + p.valor, 0);

    // Faltas com desconto no mês (calculado sobre totalProventos / 30 por dia)
    const faltasDoMes = await this.faltaRepo
      .createQueryBuilder('f')
      .where('f.colaborador_id = :id', { id: col.id })
      .andWhere('f.com_desconto = true')
      .andWhere('f.tipo = :tipo', { tipo: 'falta' })
      .andWhere('f.data >= :inicio', { inicio: mesInicio })
      .andWhere('f.data <= :fim', { fim: mesFim })
      .getMany();

    for (const f of faltasDoMes) {
      const pct = Number(f.percentual_desconto ?? 100) / 100;
      const valorDesc = Math.round((totalProventos / 30) * pct * 100) / 100;
      if (valorDesc > 0) {
        descontos.push({
          codigo: 'FALTA',
          descricao: `Falta ${f.data}${f.motivo ? ' — ' + f.motivo.substring(0, 30) : ''}`,
          referencia: mesRef,
          valor: valorDesc,
        });
      }
    }

    // Suspensões com desconto que se sobrepõem ao mês
    const suspensoesDoMes = await this.suspensaoRepo
      .createQueryBuilder('s')
      .where('s.colaborador_id = :id', { id: col.id })
      .andWhere('s.com_desconto = true')
      .andWhere('s.data_inicio <= :fim', { fim: mesFim })
      .andWhere('s.data_fim >= :inicio', { inicio: mesInicio })
      .getMany();

    for (const s of suspensoesDoMes) {
      const ini = new Date(s.data_inicio > mesInicio ? s.data_inicio : mesInicio);
      const fim = new Date(s.data_fim < mesFim ? s.data_fim : mesFim);
      const dias = Math.max(0, Math.round((fim.getTime() - ini.getTime()) / 86400000) + 1);
      if (dias > 0) {
        const valorDesc = Math.round((totalProventos / 30) * dias * 100) / 100;
        descontos.push({
          codigo: 'SUSP',
          descricao: `Suspensão ${dias}d — ${s.motivo.substring(0, 30)}`,
          referencia: mesRef,
          valor: valorDesc,
        });
      }
    }

    const totalDescontos = descontos.reduce((s, d) => s + d.valor, 0);
    const liquido = totalProventos - totalDescontos;

    return { col, func, proventos, descontos, valesDoMes, totalProventos, totalDescontos, liquido, mesRef };
  }

  async previewFolhaColaborador(colaborador_id: string, mes_referencia: string) {
    const col = await this.colaboradorRepo.findOne({ where: { id: colaborador_id, ativo: true } });
    if (!col) throw new NotFoundException('Colaborador não encontrado.');
    const r = await this._computarFolhaColaborador(col, mes_referencia);
    if (!r) throw new NotFoundException('Funcionário não encontrado.');
    const reciboExistente = await this.reciboRepo.findOne({ where: { colaborador_id, mes_referencia } });
    return {
      colaborador_id,
      mes_referencia,
      funcionario: { nome: r.func.nome, cargo: r.func.cargo, matricula: r.func.matricula },
      proventos: r.proventos,
      descontos: r.descontos,
      totalProventos: r.totalProventos,
      totalDescontos: r.totalDescontos,
      liquido: r.liquido,
      recibo_existente: reciboExistente ? { id: reciboExistente.id, status: reciboExistente.status } : null,
    };
  }

  async calcularFolhaColaborador(colaborador_id: string, mes_referencia: string, criado_por_id: string, criado_por_nome: string) {
    const col = await this.colaboradorRepo.findOne({ where: { id: colaborador_id, ativo: true } });
    if (!col) throw new NotFoundException('Colaborador não encontrado.');

    // Ao regenerar, resetar vales do recibo anterior para que sejam re-incluídos
    const reciboAnterior = await this.reciboRepo.findOne({ where: { colaborador_id, mes_referencia } });
    if (reciboAnterior?.observacao) {
      try {
        const obs = JSON.parse(reciboAnterior.observacao);
        const valeIds: string[] = (obs.descontos ?? []).filter((d: any) => d.vale_id).map((d: any) => d.vale_id);
        for (const vid of valeIds) {
          await this.valeRepo.update(vid, { descontado: false });
        }
      } catch { /* ignorar JSON inválido */ }
    }

    const r = await this._computarFolhaColaborador(col, mes_referencia);
    if (!r) throw new NotFoundException('Funcionário não encontrado.');

    // Marca vales como descontados (sem criar Receita)
    for (const v of r.valesDoMes) {
      await this.valeRepo.update(v.id, { descontado: true });
    }

    const reciboExistente = await this.reciboRepo.findOne({ where: { colaborador_id, mes_referencia } });
    const reciboData: any = {
      colaborador_id,
      mes_referencia,
      valor: r.liquido,
      descricao: `Folha ${mes_referencia}`,
      status: 'pendente',
      observacao: JSON.stringify({ proventos: r.proventos, descontos: r.descontos, totalProventos: r.totalProventos, totalDescontos: r.totalDescontos }),
      criado_por_id,
      criado_por_nome,
    };

    let recibo: any;
    if (reciboExistente) {
      await this.reciboRepo.update(reciboExistente.id, reciboData);
      recibo = { ...reciboExistente, ...reciboData };
    } else {
      recibo = await this.reciboRepo.save(this.reciboRepo.create(reciboData));
    }

    // Cria (ou atualiza) Saída de salário líquido no financeiro
    try {
      const [ano, mes] = mes_referencia.split('-');
      const mesesAbr = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
      const competencia = `${mesesAbr[parseInt(mes, 10) - 1]}/${ano}`;
      const movId = reciboExistente?.movimentacao_id;
      if (movId) {
        await this.movimentacaoRepo.update(movId, { valor: r.liquido });
      } else {
        const mov = await this.movimentacaoRepo.save(this.movimentacaoRepo.create({
          nome: `Salário — ${r.func.nome}`,
          tipo_movimentacao: 'Saída',
          plano_contas: 'Funcionarios 2026',
          categoria: 'Salário',
          forma_pagamento: 'PIX',
          valor: r.liquido,
          data: mes_referencia + '-01',
          status: 'Pendente',
          competencia,
          descricao: `Salário líquido ${mes_referencia} — ${r.func.nome}`,
          usuario_nome: criado_por_nome ?? null,
        }));
        await this.reciboRepo.update(recibo.id, { movimentacao_id: mov.id });
        recibo.movimentacao_id = mov.id;
      }
    } catch { /* não bloqueia a folha */ }

    return {
      funcionario_nome: r.func.nome,
      proventos: r.proventos,
      descontos: r.descontos,
      totalProventos: r.totalProventos,
      totalDescontos: r.totalDescontos,
      liquido: r.liquido,
      recibo_id: recibo.id,
    };
  }

  async buscarReciboCompleto(recibo_id: string) {
    const recibo = await this.reciboRepo.findOneBy({ id: recibo_id });
    if (!recibo) throw new NotFoundException('Recibo não encontrado.');
    const col = await this.colaboradorRepo.findOneBy({ id: recibo.colaborador_id });
    const [func] = col
      ? await this.dataSource.query(
          `SELECT id, nome, cargo, matricula, cpf, foto FROM funcionarios WHERE id = $1`,
          [col.funcionario_id],
        )
      : [null];

    let detalhes: any = {};
    try { detalhes = JSON.parse(recibo.observacao ?? '{}'); } catch {}

    // Gera número de código do colaborador (baseado na sequência da matrícula)
    const codigoNum = func?.matricula?.split('-').pop()?.padStart(5, '0') ?? '00001';

    return {
      ...recibo,
      colaborador: col,
      funcionario: func,
      codigo_colaborador: codigoNum,
      ...detalhes,
    };
  }


  // ── Locais permitidos ─────────────────────────────────────────────────────

  async listarLocais(colaborador_id: string) {
    return this.localRepo.find({ where: { colaborador_id }, order: { createdAt: 'ASC' } });
  }

  async criarLocal(dto: { colaborador_id: string; nome: string; latitude: number; longitude: number; raio_metros?: number }) {
    return this.localRepo.save(this.localRepo.create(dto));
  }

  async editarLocal(id: string, dto: Partial<{ nome: string; latitude: number; longitude: number; raio_metros: number }>) {
    await this.localRepo.update(id, dto);
    return this.localRepo.findOneBy({ id });
  }

  async deletarLocal(id: string) { await this.localRepo.delete(id); return { ok: true }; }

  // ── Recibos ───────────────────────────────────────────────────────────────

  async listarRecibos(colaborador_id?: string, mes_referencia?: string) {
    const where: any = {};
    if (colaborador_id) where.colaborador_id = colaborador_id;
    if (mes_referencia) where.mes_referencia = mes_referencia;
    return this.reciboRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async criarRecibo(dto: any) { return this.reciboRepo.save(this.reciboRepo.create(dto)); }
  async editarRecibo(id: string, dto: any) {
    const recibo = await this.reciboRepo.findOneBy({ id });
    if (recibo?.movimentacao_id && dto.status === 'pago') {
      const dataPagamento = dto.data_pagamento ?? new Date().toISOString().split('T')[0];
      await this.movimentacaoRepo.update(recibo.movimentacao_id, { status: 'Pago', data: dataPagamento });
    }
    await this.reciboRepo.update(id, dto);
    return this.reciboRepo.findOneBy({ id });
  }
  async deletarRecibo(id: string) {
    const recibo = await this.reciboRepo.findOneBy({ id });
    // A Saída de salário gerada pela folha precisa sair junto: sem isso ela ficava
    // Pendente e órfã, e regerar a folha criava outra — salário duplicado no financeiro.
    // Se já foi paga, mantém: o dinheiro saiu de fato.
    if (recibo?.movimentacao_id) {
      const mov = await this.movimentacaoRepo.findOneBy({ id: recibo.movimentacao_id });
      if (mov && mov.status !== 'Pago') await this.movimentacaoRepo.softDelete(mov.id);
    }
    await this.reciboRepo.delete(id);
    return { ok: true };
  }

  // ── Vales ─────────────────────────────────────────────────────────────────

  async listarVales(colaborador_id?: string) {
    const where: any = {};
    if (colaborador_id) where.colaborador_id = colaborador_id;
    return this.valeRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async criarVale(dto: any) {
    const vale = await this.valeRepo.save(this.valeRepo.create(dto)) as unknown as import('./entities/gente-vale.entity').GenteVale;

    // Gerar movimentação de saída no financeiro
    if (dto.valor) {
      try {
        const col = await this.colaboradorRepo.findOneBy({ id: dto.colaborador_id });
        let nomeColaborador = 'Colaborador';
        if (col?.funcionario_id) {
          const [func] = await this.dataSource.query(
            `SELECT nome FROM funcionarios WHERE id = $1`, [col.funcionario_id],
          );
          if (func?.nome) nomeColaborador = func.nome;
        }
        const tipoLabel: Record<string, string> = {
          alimentacao: 'Alimentação', transporte: 'Transporte', adiantamento: 'Adiantamento', outro: 'Vale',
        };
        const isAdiantamento = dto.tipo === 'adiantamento';
        const mov = await this.movimentacaoRepo.save(this.movimentacaoRepo.create({
          nome: `${tipoLabel[dto.tipo] ?? 'Vale'} — ${nomeColaborador}`,
          tipo_movimentacao: 'Saída',
          plano_contas: isAdiantamento ? 'Adiantamentos a Funcionários' : 'Funcionarios 2026',
          categoria: tipoLabel[dto.tipo] ?? 'Vale',
          forma_pagamento: dto.forma_pagamento ?? 'PIX',
          valor: Number(dto.valor),
          data: dto.data ?? new Date().toISOString().split('T')[0],
          status: 'Pago',
          descricao: dto.descricao ? `Vale: ${dto.descricao}` : `Vale liberado para ${nomeColaborador}`,
          usuario_nome: dto.criado_por_nome ?? null,
        }));
        await this.valeRepo.update(vale.id, { movimentacao_saida_id: mov.id });
        vale.movimentacao_saida_id = mov.id;
      } catch { /* não bloqueia o vale se financeiro falhar */ }
    }

    // Auto-criar documento vinculado quando há ficha de solicitação
    if (dto.ficha_url) {
      try {
        const tipoLabelDoc: Record<string, string> = {
          alimentacao: 'Alimentação', transporte: 'Transporte', adiantamento: 'Adiantamento', outro: 'Vale',
        };
        await this.documentoRepo.save(this.documentoRepo.create({
          colaborador_id: dto.colaborador_id,
          nome: `Ficha de Vale — ${tipoLabelDoc[dto.tipo] ?? 'Vale'} · ${dto.data}`,
          url: dto.ficha_url,
          categoria: 'vale',
          criado_por_id: dto.criado_por_id,
          criado_por_nome: dto.criado_por_nome,
        }));
      } catch { /* não bloqueia o vale se documento falhar */ }
    }

    return vale;
  }
  async editarVale(id: string, dto: any) { await this.valeRepo.update(id, dto); return this.valeRepo.findOneBy({ id }); }
  async deletarVale(id: string) { await this.valeRepo.delete(id); return { ok: true }; }

  // ── Advertências ──────────────────────────────────────────────────────────

  async listarAdvertencias(colaborador_id?: string) {
    const where: any = {};
    if (colaborador_id) where.colaborador_id = colaborador_id;
    return this.advertenciaRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async criarAdvertencia(dto: any) { return this.advertenciaRepo.save(this.advertenciaRepo.create(dto)); }
  async editarAdvertencia(id: string, dto: any) { await this.advertenciaRepo.update(id, dto); return this.advertenciaRepo.findOneBy({ id }); }
  async deletarAdvertencia(id: string) { await this.advertenciaRepo.delete(id); return { ok: true }; }

  // ── Suspensões ────────────────────────────────────────────────────────────

  async listarSuspensoes(colaborador_id?: string) {
    const where: any = {};
    if (colaborador_id) where.colaborador_id = colaborador_id;
    return this.suspensaoRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async criarSuspensao(dto: any) { return this.suspensaoRepo.save(this.suspensaoRepo.create(dto)); }
  async editarSuspensao(id: string, dto: any) { await this.suspensaoRepo.update(id, dto); return this.suspensaoRepo.findOneBy({ id }); }
  async deletarSuspensao(id: string) { await this.suspensaoRepo.delete(id); return { ok: true }; }

  // ── Faltas ────────────────────────────────────────────────────────────────

  async listarFaltas(colaborador_id?: string) {
    const where: any = {};
    if (colaborador_id) where.colaborador_id = colaborador_id;
    return this.faltaRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async criarFalta(dto: any) {
    if (dto.data_fim === '' || dto.data_fim === null || dto.data_fim === undefined) {
      // Atestados/afastamentos sem data_fim explícita: cobre ao menos o dia de início
      dto.data_fim = (dto.tipo === 'atestado' || dto.tipo === 'afastamento') ? (dto.data ?? null) : null;
    }
    return this.faltaRepo.save(this.faltaRepo.create(dto));
  }
  async editarFalta(id: string, dto: any) {
    if (dto.data_fim === '' || dto.data_fim === undefined) {
      const atual = await this.faltaRepo.findOneBy({ id });
      const tipo = dto.tipo ?? atual?.tipo;
      dto.data_fim = (tipo === 'atestado' || tipo === 'afastamento') ? (dto.data ?? atual?.data ?? null) : null;
    }
    await this.faltaRepo.update(id, dto);
    return this.faltaRepo.findOneBy({ id });
  }
  async deletarFalta(id: string) { await this.faltaRepo.delete(id); return { ok: true }; }

  // ── Documentos do colaborador ─────────────────────────────────────────────

  async listarDocumentos(colaborador_id: string) {
    return this.documentoRepo.find({ where: { colaborador_id }, order: { createdAt: 'DESC' } });
  }
  async criarDocumento(dto: any) { return this.documentoRepo.save(this.documentoRepo.create(dto)); }
  async editarDocumento(id: string, dto: any) { await this.documentoRepo.update(id, dto); return this.documentoRepo.findOneBy({ id }); }
  async deletarDocumento(id: string) { await this.documentoRepo.delete(id); return { ok: true }; }

  // ── Resumo do colaborador ─────────────────────────────────────────────────

  async resumoColaborador(id: string) {
    const [recibos, vales, advertencias, suspensoes, faltas] = await Promise.all([
      this.reciboRepo.find({ where: { colaborador_id: id }, order: { createdAt: 'DESC' } }),
      this.valeRepo.find({ where: { colaborador_id: id }, order: { createdAt: 'DESC' } }),
      this.advertenciaRepo.find({ where: { colaborador_id: id }, order: { createdAt: 'DESC' } }),
      this.suspensaoRepo.find({ where: { colaborador_id: id }, order: { createdAt: 'DESC' } }),
      this.faltaRepo.find({ where: { colaborador_id: id }, order: { createdAt: 'DESC' } }),
    ]);
    return { recibos, vales, advertencias, suspensoes, faltas };
  }

  // ── Folgas ────────────────────────────────────────────────────────────────


  async solicitarFolga(colaborador_id: string, data: string) {
    const DIAS_FOLGA_PERMITIDOS = ['seg', 'qui', 'sex']; // regra global
    const DIAS_NUM: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };

    const col = await this.colaboradorRepo.findOneBy({ id: colaborador_id });
    if (!col) throw new NotFoundException('Colaborador não encontrado.');

    const dataFolga = new Date(data + 'T12:00:00');
    const agora = new Date();
    const dataMin = new Date(agora);
    dataMin.setHours(0, 0, 0, 0);
    dataMin.setDate(dataMin.getDate() + 10);
    dataFolga.setHours(0, 0, 0, 0);
    if (dataFolga < dataMin) {
      throw new BadRequestException('A folga deve ser solicitada com no mínimo 10 dias de antecedência.');
    }

    // Dia deve ser um dia de trabalho do colaborador
    const diaStr = Object.entries(DIAS_NUM).find(([, n]) => n === dataFolga.getDay())?.[0] ?? '';
    if (!(col.dias_trabalho ?? []).includes(diaStr)) throw new BadRequestException('A folga só pode ser marcada em dias de trabalho do colaborador.');

    // Dia deve ser seg, qui ou sex
    if (!DIAS_FOLGA_PERMITIDOS.includes(diaStr)) throw new BadRequestException('Folgas só podem ser solicitadas para segunda, quinta ou sexta-feira.');

    // Calcular início e fim da semana ISO da data solicitada
    const diaDaSemana = dataFolga.getDay();
    const diffLun = (diaDaSemana === 0 ? -6 : 1 - diaDaSemana);
    const segDaSemana = new Date(dataFolga);
    segDaSemana.setDate(dataFolga.getDate() + diffLun);
    segDaSemana.setHours(0, 0, 0, 0);
    const domDaSemana = new Date(segDaSemana);
    domDaSemana.setDate(segDaSemana.getDate() + 6);
    domDaSemana.setHours(23, 59, 59, 999);

    // Máximo 1 folga por funcionário na semana
    const folgasNaSemana = await this.dataSource.query(
      `SELECT id FROM gente_folga_solicitacoes WHERE colaborador_id = $1 AND data >= $2 AND data <= $3 AND status != 'negada'`,
      [colaborador_id, segDaSemana.toISOString().split('T')[0], domDaSemana.toISOString().split('T')[0]],
    );
    if (folgasNaSemana.length > 0) throw new BadRequestException('Você já possui uma folga solicitada nesta semana.');

    // Máximo 2 folgas por semana no total (todos os funcionários)
    const totalNaSemana = await this.dataSource.query(
      `SELECT id FROM gente_folga_solicitacoes WHERE data >= $1 AND data <= $2 AND status != 'negada'`,
      [segDaSemana.toISOString().split('T')[0], domDaSemana.toISOString().split('T')[0]],
    );
    if (totalNaSemana.length >= 2) throw new BadRequestException('Já existem 2 folgas aprovadas/pendentes nesta semana. Limite semanal atingido.');

    // Máximo 2 folgas por colaborador por mês
    const [yy, mm] = data.slice(0, 7).split('-').map(Number);
    const mesInicio = `${data.slice(0, 7)}-01`;
    const mesFim = new Date(yy, mm, 0).toISOString().split('T')[0];
    const folgasMes = await this.dataSource.query(
      `SELECT id FROM gente_folga_solicitacoes WHERE colaborador_id = $1 AND data >= $2 AND data <= $3 AND status != 'negada'`,
      [colaborador_id, mesInicio, mesFim],
    );
    if (folgasMes.length >= 2) throw new BadRequestException('Você já atingiu o limite de 2 folgas neste mês.');

    const folga = this.folgaRepo.create({ colaborador_id, data, status: 'pendente' });
    return this.folgaRepo.save(folga);
  }

  async criarFolgaAdmin(colaborador_id: string, data: string, respondido_por: string) {
    const col = await this.colaboradorRepo.findOneBy({ id: colaborador_id });
    if (!col) throw new NotFoundException('Colaborador não encontrado.');
    const folga = this.folgaRepo.create({ colaborador_id, data, status: 'aprovada', respondido_por, respondido_em: new Date() });
    return this.folgaRepo.save(folga);
  }

  async consultarDisponibilidadeFolgas(colaborador_id: string) {
    const DIAS_FOLGA = ['seg', 'qui', 'sex'];
    const DIAS_NUM: Record<string, number> = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
    const DIAS_LABEL: Record<string, string> = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo' };

    const col = await this.colaboradorRepo.findOneBy({ id: colaborador_id });
    if (!col) throw new NotFoundException('Colaborador não encontrado.');

    const agora = new Date();
    const dataMin = new Date(agora);
    dataMin.setHours(0, 0, 0, 0);
    dataMin.setDate(dataMin.getDate() + 10);

    const datas: any[] = [];
    const cur = new Date(dataMin);

    for (let i = 0; i < 35; i++) {
      const diaStr = Object.entries(DIAS_NUM).find(([, n]) => n === cur.getDay())?.[0] ?? '';
      if (DIAS_FOLGA.includes(diaStr) && (col.dias_trabalho ?? []).includes(diaStr)) {
        const dataISO = cur.toISOString().split('T')[0];
        const diffLun = cur.getDay() === 0 ? -6 : 1 - cur.getDay();
        const seg = new Date(cur); seg.setDate(cur.getDate() + diffLun); seg.setHours(0, 0, 0, 0);
        const dom = new Date(seg); dom.setDate(seg.getDate() + 6);
        const segISO = seg.toISOString().split('T')[0];
        const domISO = dom.toISOString().split('T')[0];

        const [total, funcSemana] = await Promise.all([
          this.dataSource.query(`SELECT id FROM gente_folga_solicitacoes WHERE data >= $1 AND data <= $2 AND status != 'negada'`, [segISO, domISO]),
          this.dataSource.query(`SELECT id FROM gente_folga_solicitacoes WHERE colaborador_id = $1 AND data >= $2 AND data <= $3 AND status != 'negada'`, [colaborador_id, segISO, domISO]),
        ]);

        const semanaCheia = total.length >= 2;
        const jaTemNaSemana = funcSemana.length > 0;
        datas.push({
          data: dataISO,
          dia: DIAS_LABEL[diaStr] ?? diaStr,
          disponivel: !semanaCheia && !jaTemNaSemana,
          motivo: jaTemNaSemana ? 'Você já tem folga nesta semana' : semanaCheia ? `${total.length}/2 vagas ocupadas` : null,
          vagas_semana: Math.max(0, 2 - total.length),
        });
      }
      cur.setDate(cur.getDate() + 1);
    }

    // Folgas já marcadas no mês atual
    const mesAtualISO = agora.toISOString().slice(0, 7);
    const [yy, mm] = mesAtualISO.split('-').map(Number);
    const mesInicioISO = `${mesAtualISO}-01`;
    const mesFimISO = new Date(yy, mm, 0).toISOString().split('T')[0];
    const folgasMesAtual = await this.dataSource.query(
      `SELECT id FROM gente_folga_solicitacoes WHERE colaborador_id = $1 AND data >= $2 AND data <= $3 AND status != 'negada'`,
      [colaborador_id, mesInicioISO, mesFimISO],
    );

    return { datas, folgas_mes_atual: folgasMesAtual.length, limite_mes: 2 };
  }

  async confirmarRealizacaoFolga(id: string, realizada: boolean) {
    await this.folgaRepo.update(id, { realizada });
    return this.folgaRepo.findOneBy({ id });
  }

  async folgasPendentesConfirmacao(colaborador_id: string) {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const ontemISO = ontem.toISOString().split('T')[0];
    return this.dataSource.query(
      `SELECT * FROM gente_folga_solicitacoes WHERE colaborador_id = $1 AND status = 'aprovada' AND data <= $2 AND realizada IS NULL ORDER BY data ASC`,
      [colaborador_id, ontemISO],
    );
  }

  async listarFolgas(colaborador_id?: string) {
    const rows = await this.dataSource.query(
      `SELECT f.*, gc.funcionario_id,
              fn.nome as funcionario_nome, fn.matricula
       FROM gente_folga_solicitacoes f
       JOIN gente_colaboradores gc ON gc.id = f.colaborador_id
       JOIN funcionarios fn ON fn.id = gc.funcionario_id
       ${colaborador_id ? 'WHERE f.colaborador_id = $1' : ''}
       ORDER BY f.data ASC`,
      colaborador_id ? [colaborador_id] : [],
    );
    return rows;
  }

  async responderFolga(id: string, status: 'aprovada' | 'negada', respondido_por: string) {
    await this.folgaRepo.update(id, { status, respondido_por, respondido_em: new Date() });
    return this.folgaRepo.findOneBy({ id });
  }

  // ── Trabalho externo ──────────────────────────────────────────────────────

  async habilitarTrabalhoExterno(colaborador_id: string, data: string, autorizado_por: string, autorizado_por_id?: string) {
    // Revogar qualquer autorização anterior para essa data
    await this.trabalhoExternoRepo.update({ colaborador_id, data }, { ativo: false });
    const reg = this.trabalhoExternoRepo.create({ colaborador_id, data, autorizado_por, autorizado_por_id, ativo: true });
    return this.trabalhoExternoRepo.save(reg);
  }

  async listarTrabalhoExterno(colaborador_id?: string) {
    const where: any = { ativo: true };
    if (colaborador_id) where.colaborador_id = colaborador_id;
    return this.trabalhoExternoRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async revogarTrabalhoExterno(id: string) {
    await this.trabalhoExternoRepo.update(id, { ativo: false });
    return { ok: true };
  }

  // ── Admin: mesclar colaborador duplicado ──────────────────────────────────

  async mesclarColaboradorDuplicado(matriculaCorreta: string): Promise<any> {
    const matriculaNorm = matriculaCorreta.trim().toUpperCase();

    // 1. Funcionário correto (pela matrícula)
    const [funcCorreto] = await this.dataSource.query(
      `SELECT id, nome, matricula FROM funcionarios WHERE UPPER(matricula) LIKE $1 LIMIT 1`,
      [`%${matriculaNorm}`],
    );
    if (!funcCorreto) throw new NotFoundException(`Nenhum funcionário encontrado com matrícula terminando em ${matriculaNorm}`);

    // 2. Colaborador correto
    const [colCorreto] = await this.dataSource.query(
      `SELECT id FROM gente_colaboradores WHERE funcionario_id = $1 LIMIT 1`,
      [funcCorreto.id],
    );
    if (!colCorreto) throw new NotFoundException(`Funcionário ${funcCorreto.nome} não possui colaborador vinculado`);

    // 3. Colaboradores duplicados (mesmo nome, funcionário diferente)
    const duplicatas = await this.dataSource.query(
      `SELECT gc.id AS col_id, f.id AS func_id, f.nome, f.matricula
       FROM gente_colaboradores gc
       JOIN funcionarios f ON f.id = gc.funcionario_id
       WHERE LOWER(f.nome) = LOWER($1)
         AND gc.id != $2`,
      [funcCorreto.nome, colCorreto.id],
    );

    if (!duplicatas.length) {
      return { ok: true, mensagem: 'Nenhuma duplicata encontrada', correto: { colaborador_id: colCorreto.id, ...funcCorreto } };
    }

    const log: string[] = [];

    for (const dup of duplicatas) {
      // Transferir faltas
      await this.dataSource.query(`UPDATE gente_faltas SET colaborador_id = $1 WHERE colaborador_id = $2`, [colCorreto.id, dup.col_id]);

      // Transferir folgas
      await this.dataSource.query(`UPDATE gente_folgas_solicitacoes SET colaborador_id = $1 WHERE colaborador_id = $2`, [colCorreto.id, dup.col_id]).catch(() => {});

      // Transferir recibos
      await this.dataSource.query(`UPDATE gente_recibos SET colaborador_id = $1 WHERE colaborador_id = $2`, [colCorreto.id, dup.col_id]).catch(() => {});

      // Transferir vales
      await this.dataSource.query(`UPDATE gente_vales SET colaborador_id = $1 WHERE colaborador_id = $2`, [colCorreto.id, dup.col_id]).catch(() => {});

      // Deletar colaborador duplicado
      await this.dataSource.query(`DELETE FROM gente_colaboradores WHERE id = $1`, [dup.col_id]);

      // Deletar funcionário duplicado se não tiver usuário vinculado
      const [funcDup] = await this.dataSource.query(`SELECT usuario_id FROM funcionarios WHERE id = $1`, [dup.func_id]);
      if (!funcDup?.usuario_id) {
        await this.dataSource.query(`DELETE FROM funcionarios WHERE id = $1`, [dup.func_id]);
        log.push(`Deletado funcionário duplicado ${dup.matricula} (${dup.nome}) e colaborador.`);
      } else {
        log.push(`Colaborador duplicado ${dup.col_id} deletado, mas funcionário ${dup.matricula} mantido (tem usuário vinculado).`);
      }
    }

    return {
      ok: true,
      correto: { colaborador_id: colCorreto.id, funcionario_id: funcCorreto.id, nome: funcCorreto.nome, matricula: funcCorreto.matricula },
      acoes: log,
    };
  }

  // ── Pagamentos de Passagem ────────────────────────────────────────────────

  async listarPagamentosPassagem(colaborador_id: string, mes: string) {
    return this.pagamentoPassagemRepo.find({
      where: { colaborador_id, mes_referencia: mes },
      order: { data: 'ASC' },
    });
  }

  async salvarPagamentosPassagem(
    colaborador_id: string,
    funcionario_id: string,
    mes: string,
    dias: { data: string; valor: number; status?: string }[],
  ) {
    // Upsert dia a dia
    for (const d of dias) {
      await this.dataSource.query(
        `INSERT INTO gente_pagamentos_passagem
           (colaborador_id, funcionario_id, data, valor, status, mes_referencia)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (colaborador_id, data)
         DO UPDATE SET valor = EXCLUDED.valor, status = EXCLUDED.status`,
        [colaborador_id, funcionario_id, d.data, d.valor, d.status ?? 'pago', mes],
      );
    }
    return this.listarPagamentosPassagem(colaborador_id, mes);
  }

  async removerPagamentoPassagem(id: string) {
    const p = await this.pagamentoPassagemRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    await this.pagamentoPassagemRepo.remove(p);
    return { ok: true };
  }

  async listarVtAssinaturas(mes: string) {
    const rows = await this.dataSource.query(
      `SELECT colaborador_id, mes_referencia, assinado, data_assinatura FROM gente_vt_assinaturas WHERE mes_referencia = $1`,
      [mes],
    );
    return rows;
  }

  async toggleVtAssinatura(colaborador_id: string, mes_referencia: string, assinado: boolean) {
    const data_assinatura = assinado ? new Date().toISOString().slice(0, 10) : null;
    await this.dataSource.query(
      `INSERT INTO gente_vt_assinaturas (colaborador_id, mes_referencia, assinado, data_assinatura, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (colaborador_id, mes_referencia)
       DO UPDATE SET assinado = EXCLUDED.assinado, data_assinatura = EXCLUDED.data_assinatura, updated_at = now()`,
      [colaborador_id, mes_referencia, assinado, data_assinatura],
    );
    return { ok: true, assinado, data_assinatura };
  }
}
