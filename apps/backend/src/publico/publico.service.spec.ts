import { DataSource } from 'typeorm';
import { PublicoService, categoriaPublica } from './publico.service';

describe('categoriaPublica', () => {
  it.each([
    ['Adiantamentos a Funcionários', 'Saída', 'Funcionários'],
    ['Funcionarios 2026', 'Saída', 'Funcionários'],
    ['Cozinha 2026', 'Saída', 'Alimentação'],
    ['Celia 2026', 'Saída', 'Material Escolar e Manutenção'],
    ['Qualquer Coisa', 'Saída', 'Outros'],
    ['Celia 2026', 'Entrada', 'Doações'],
    ['Uniformes', 'Entrada', 'Venda de Uniformes'],
  ])('%s (%s) -> %s', (interna, tipo, publica) => {
    expect(categoriaPublica(interna, tipo)).toBe(publica);
  });
});

describe('PublicoService.getPrestacaoContas', () => {
  const lancamentos = [
    { data: '2026-08-31', tipo: 'Saída', valor: '1500', categoria: 'Funcionarios 2026' },
    { data: '2026-08-03', tipo: 'Saída', valor: '200', categoria: 'Adiantamentos a Funcionários' },
    { data: '2026-08-10', tipo: 'Saída', valor: '80.5', categoria: 'Cozinha 2026' },
    { data: '2026-08-12', tipo: 'Entrada', valor: '100', categoria: 'Celia 2026' },
  ];

  function criarServico() {
    const query = jest.fn()
      .mockResolvedValueOnce([{ mes: '2026-08', tipo: 'Saída', total: '1780.5' }, { mes: '2026-08', tipo: 'Entrada', total: '100' }])
      .mockResolvedValueOnce(lancamentos)
      .mockResolvedValueOnce([{ total: '10' }])
      .mockResolvedValueOnce([{ total: '2', nomes: 'Ballet, Futebol' }])
      .mockResolvedValueOnce([{ total: '3' }]);
    return { svc: new PublicoService({ query } as unknown as DataSource), query };
  }

  it('filtra só lançamentos realizados de Entrada/Saída', async () => {
    const { svc, query } = criarServico();
    await svc.getPrestacaoContas('2026', '08');
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('status = ANY($3)');
    expect(params[2]).toEqual(['Pago', 'Confirmado', 'Concluído']);
    expect(params[1]).toEqual(['Entrada', 'Saída']);
    expect(sql).not.toMatch(/\bnome\b|descricao/);
  });

  it('consolida funcionários numa linha sem data e não expõe campos de texto livre', async () => {
    const { svc } = criarServico();
    const r = await svc.getPrestacaoContas('2026', '08');

    expect(r.movimentacoes).toEqual([
      { data: '2026-08-10', tipo: 'Saída', categoria: 'Alimentação', valor: 80.5 },
      { data: '2026-08-12', tipo: 'Entrada', categoria: 'Doações', valor: 100 },
      { data: null, tipo: 'Saída', categoria: 'Funcionários', valor: 1700 },
    ]);
    for (const m of r.movimentacoes) {
      expect(Object.keys(m).sort()).toEqual(['categoria', 'data', 'tipo', 'valor']);
    }
    expect(r.resumo.totalDespesas).toBe(1780.5);
    expect(r.resumo.totalReceitas).toBe(100);
    expect(r.porMes).toEqual([{ mes: '2026-08', receitas: 100, despesas: 1780.5, saldo: -1680.5 }]);
  });
});
