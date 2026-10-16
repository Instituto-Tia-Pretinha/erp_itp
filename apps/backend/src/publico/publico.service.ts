import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// Prestação de contas é pública (sem auth): só sai o que foi efetivamente pago/recebido,
// sempre com categoria genérica. Nada de nome, descrição ou plano de contas interno —
// salários, vales e fornecedores identificariam pessoas (LGPD).
const STATUS_REALIZADO = ['Pago', 'Confirmado', 'Concluído'];
const TIPOS_PUBLICOS = ['Entrada', 'Saída'];
export const CATEGORIA_FUNCIONARIOS = 'Funcionários';

const normalizar = (txt?: string | null) =>
  (txt ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function categoriaPublica(categoria: string | null | undefined, tipo: string): string {
  const c = normalizar(categoria);
  if (tipo === 'Entrada') {
    if (c.includes('uniform')) return 'Venda de Uniformes';
    if (c.includes('evento')) return 'Eventos Beneficentes';
    return 'Doações';
  }
  if (c.includes('funcionari') || c.includes('salario') || c.includes('folha')) return CATEGORIA_FUNCIONARIOS;
  if (c.includes('cozinha') || c.includes('aliment')) return 'Alimentação';
  if (c.includes('material') || c.includes('celia')) return 'Material Escolar e Manutenção';
  if (c.includes('evento')) return 'Eventos';
  return 'Outros';
}

@Injectable()
export class PublicoService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async getPrestacaoContas(ano?: string, mes?: string) {
    const anoFiltro = ano ?? new Date().getFullYear().toString();
    // mes no formato '04' ou '2026-04'
    const mesFiltro = mes ? mes.padStart(2, '0').slice(-2) : null;
    const filtroMes = mesFiltro ? `AND EXTRACT(MONTH FROM data) = ${parseInt(mesFiltro)}` : '';

    const [
      porMes,
      lancamentos,
      alunos,
      cursos,
      voluntarios,
    ] = await Promise.all([
      // Por mês (sempre do ano inteiro para mostrar evolução)
      this.ds.query<{ mes: string; tipo: string; total: string }[]>(`
        SELECT
          TO_CHAR(data, 'YYYY-MM') AS mes,
          tipo_movimentacao AS tipo,
          SUM(valor)::numeric AS total
        FROM movimentacoes_financeiras
        WHERE deleted_at IS NULL
          AND EXTRACT(YEAR FROM data) = $1
          AND tipo_movimentacao = ANY($2)
          AND status = ANY($3)
        GROUP BY mes, tipo_movimentacao
        ORDER BY mes ASC
      `, [anoFiltro, TIPOS_PUBLICOS, STATUS_REALIZADO]),

      // Lançamentos realizados do período — só data, tipo, categoria interna (mapeada abaixo) e valor
      this.ds.query<{ data: string; tipo: string; valor: string; categoria: string }[]>(`
        SELECT
          TO_CHAR(data, 'YYYY-MM-DD') AS data,
          tipo_movimentacao AS tipo,
          valor::numeric AS valor,
          COALESCE(plano_contas, categoria, '') AS categoria
        FROM movimentacoes_financeiras
        WHERE deleted_at IS NULL
          AND EXTRACT(YEAR FROM data) = $1
          ${filtroMes}
          AND tipo_movimentacao = ANY($2)
          AND status = ANY($3)
        ORDER BY data DESC
      `, [anoFiltro, TIPOS_PUBLICOS, STATUS_REALIZADO]),

      // Alunos ativos
      this.ds.query<{ total: string }[]>(`
        SELECT COUNT(*) AS total FROM alunos WHERE ativo = true
      `),

      // Cursos ativos
      this.ds.query<{ total: string; nomes: string }[]>(`
        SELECT COUNT(*) AS total, STRING_AGG(nome, ', ' ORDER BY nome) AS nomes
        FROM materias WHERE status = 'Ativo'
      `),

      // Voluntários ativos no módulo Gente
      this.ds.query<{ total: string }[]>(`
        SELECT COUNT(*) AS total FROM gente_colaboradores WHERE ativo = true
      `),
    ]);

    const mesesMap: Record<string, { mes: string; receitas: number; despesas: number; saldo: number }> = {};
    for (const row of porMes) {
      mesesMap[row.mes] ??= { mes: row.mes, receitas: 0, despesas: 0, saldo: 0 };
      const v = parseFloat(row.total ?? '0');
      if (row.tipo === 'Entrada') mesesMap[row.mes].receitas += v;
      else mesesMap[row.mes].despesas += v;
    }
    const porMesAgrupado = Object.values(mesesMap).map(m => ({ ...m, saldo: m.receitas - m.despesas }));

    // Pagamentos a funcionários viram uma linha consolidada, sem data — valor e dia
    // de um pagamento individual já identificariam a pessoa.
    let totalFuncionarios = 0;
    const movimentacoes: { data: string | null; tipo: string; categoria: string; valor: number }[] = [];
    for (const r of lancamentos) {
      const categoria = categoriaPublica(r.categoria, r.tipo);
      const valor = parseFloat(r.valor ?? '0');
      if (categoria === CATEGORIA_FUNCIONARIOS) totalFuncionarios += valor;
      else movimentacoes.push({ data: r.data, tipo: r.tipo, categoria, valor });
    }
    if (totalFuncionarios > 0) {
      movimentacoes.push({ data: null, tipo: 'Saída', categoria: CATEGORIA_FUNCIONARIOS, valor: totalFuncionarios });
    }

    const porCategoriaMap = new Map<string, { categoria: string; tipo: string; valor: number }>();
    for (const m of movimentacoes) {
      const chave = `${m.tipo}|${m.categoria}`;
      const atual = porCategoriaMap.get(chave) ?? { categoria: m.categoria, tipo: m.tipo, valor: 0 };
      atual.valor += m.valor;
      porCategoriaMap.set(chave, atual);
    }

    const totalReceitas = movimentacoes.filter(m => m.tipo === 'Entrada').reduce((s, m) => s + m.valor, 0);
    const totalDespesas = movimentacoes.filter(m => m.tipo === 'Saída').reduce((s, m) => s + m.valor, 0);
    const totalAlunos = parseInt(alunos[0]?.total ?? '0');

    return {
      ano: anoFiltro,
      mes: mesFiltro,
      atualizadoEm: new Date().toISOString(),
      resumo: {
        alunosAtivos: totalAlunos,
        cursosAtivos: parseInt(cursos[0]?.total ?? '0'),
        nomesCursos: cursos[0]?.nomes ?? '',
        voluntarios: parseInt(voluntarios[0]?.total ?? '0'),
        totalReceitas,
        totalDespesas,
        saldo: totalReceitas - totalDespesas,
        totalInvestido: totalDespesas,
        beneficiarios: totalAlunos,
        custoMedio: totalAlunos > 0 ? totalDespesas / totalAlunos : 0,
      },
      porMes: porMesAgrupado,
      porCategoria: [...porCategoriaMap.values()].sort((a, b) => b.valor - a.valor),
      movimentacoes,
    };
  }
}
