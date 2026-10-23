'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '@/services/api';
import { escapeHtml } from '@/lib/utils';
import {
  Package, PackagePlus, PackageMinus, AlertTriangle, RefreshCw,
  Plus, Search, Edit2, Trash2, X, CheckCircle2, History,
  ClipboardList, Link2, Tag, BarChart3, DollarSign, ShoppingCart, Calculator, Printer,
} from 'lucide-react';

type Produto = {
  id: string; nome: string; categoria: string; unidade_medida: string;
  quantidade_atual: number; estoque_minimo: number; ativo: boolean;
  valor_compra?: number | null;
};
type Movimento = {
  id: string; tipo: 'entrada' | 'baixa'; quantidade: number;
  observacao?: string; usuario_nome?: string; createdAt: string; preco_pago?: number | null;
  produto?: { nome: string; unidade_medida: string };
};
type CategoriaInsumo = { id: string; nome: string; createdAt: string };

type Aba = 'visao' | 'produtos' | 'movimentos' | 'categorias' | 'valor';

const UN_MEDIDAS = ['un', 'kg', 'g', 'L', 'mL', 'cx', 'pct', 'saco', 'par', 'fardo', 'rolo', 'ds'];

function fmt(n: number | string) {
  const v = Number(n);
  return isNaN(v) ? '0' : v % 1 === 0 ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
}
function fmtMoeda(n: number | string | null | undefined) {
  if (n == null) return '—';
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function emAlerta(p: Produto) {
  return Number(p.estoque_minimo) > 0 && Number(p.quantidade_atual) <= Number(p.estoque_minimo);
}
function pctEstoque(p: Produto): number {
  if (Number(p.estoque_minimo) <= 0) return 100;
  const pct = (Number(p.quantidade_atual) / Number(p.estoque_minimo)) * 100;
  return Math.min(pct, 200);
}

export default function EstoquePage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [categorias, setCategorias] = useState<CategoriaInsumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErro, setLoadErro] = useState('');
  const [aba, setAba] = useState<Aba>('visao');
  const [busca, setBusca] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [showInativos, setShowInativos] = useState(false);
  const [buscaMov, setBuscaMov] = useState('');
  const [filtroTipoMov, setFiltroTipoMov] = useState<'' | 'entrada' | 'baixa'>('');
  const [mostrarColetor, setMostrarColetor] = useState(false);
  const coletorUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/estoque/coletor?token=${process.env.NEXT_PUBLIC_COLETOR_TOKEN || 'itp-coletor-2026'}`
    : '';

  const [modalProduto, setModalProduto] = useState<{ aberto: boolean; editando: Produto | null }>({ aberto: false, editando: null });
  const [formProduto, setFormProduto] = useState<any>({ categoria: '', unidade_medida: 'un', estoque_minimo: 0, quantidade_atual: 0 });
  const [modalMov, setModalMov] = useState<{ aberto: boolean; tipo: 'entrada' | 'baixa'; produto: Produto | null }>({ aberto: false, tipo: 'entrada', produto: null });
  const [formMov, setFormMov] = useState<any>({ quantidade: '', observacao: '' });
  const [modalCategoria, setModalCategoria] = useState<{ aberto: boolean; editando: CategoriaInsumo | null }>({ aberto: false, editando: null });
  const [formCategoria, setFormCategoria] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [simulacao, setSimulacao] = useState<Record<string, string>>({}); // produto_id → qty
  const [buscaCotacao, setBuscaCotacao] = useState('');
  const [cotacaoSelecionados, setCotacaoSelecionados] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true); setLoadErro('');
    try {
      const [rP, rM, rC] = await Promise.all([
        api.get('/estoque/produtos'),
        api.get('/estoque/movimentos?limit=200'),
        api.get('/estoque/categorias'),
      ]);
      setProdutos(rP.data); setMovimentos(rM.data); setCategorias(rC.data);
    } catch (e: any) {
      const status = e.response?.status;
      const msg = e.response?.data?.message || e.message || 'Erro ao carregar';
      setLoadErro(status === 403 ? 'Sem permissão para acessar o estoque.' : `[${status ?? 'ERR'}] ${msg}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const nomCategorias = useMemo(() => categorias.map(c => c.nome), [categorias]);
  const alertas = useMemo(() => produtos.filter(p => p.ativo && emAlerta(p)), [produtos]);

  const produtosFiltrados = useMemo(() => {
    return produtos.filter(p => {
      if (!showInativos && !p.ativo) return false;
      if (filtroCategoria && p.categoria !== filtroCategoria) return false;
      if (busca && !p.nome.toLowerCase().includes(busca.toLowerCase()) && !(p.categoria || '').toLowerCase().includes(busca.toLowerCase())) return false;
      return true;
    });
  }, [produtos, busca, filtroCategoria, showInativos]);

  const stats = useMemo(() => ({
    total: produtos.filter(p => p.ativo).length,
    alertas: alertas.length,
    categorias: categorias.length,
    movHoje: movimentos.filter(m => {
      const d = new Date(m.createdAt); const hoje = new Date();
      return d.getDate() === hoje.getDate() && d.getMonth() === hoje.getMonth() && d.getFullYear() === hoje.getFullYear();
    }).length,
  }), [produtos, alertas, categorias, movimentos]);

  // ── Produto CRUD ──────────────────────────────────────────────────────────
  const abrirNovo = () => { setFormProduto({ categoria: nomCategorias[0] ?? '', unidade_medida: 'un', estoque_minimo: 0, quantidade_atual: 0 }); setErro(''); setModalProduto({ aberto: true, editando: null }); };
  const abrirEditar = (p: Produto) => { setFormProduto({ nome: p.nome, categoria: p.categoria, unidade_medida: p.unidade_medida, estoque_minimo: p.estoque_minimo, quantidade_atual: p.quantidade_atual, valor_compra: p.valor_compra ?? '' }); setErro(''); setModalProduto({ aberto: true, editando: p }); };

  const salvarProduto = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true); setErro('');
    try {
      if (modalProduto.editando) {
        await api.patch(`/estoque/produtos/${modalProduto.editando.id}`, formProduto);
      } else {
        await api.post('/estoque/produtos', formProduto);
      }
      setModalProduto({ aberto: false, editando: null }); load();
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || 'Erro ao salvar.';
      setErro(status === 403 ? 'Sem permissão. Apenas Direção e Administração podem criar/editar produtos.' : `[${status ?? 'ERR'}] ${msg}`);
    }
    setSalvando(false);
  };

  const deletarProduto = async (p: Produto) => {
    if (!confirm(`Desativar "${p.nome}"?`)) return;
    try { await api.delete(`/estoque/produtos/${p.id}`); load(); }
    catch (err: any) { alert(err.response?.data?.message || 'Erro.'); }
  };

  // ── Movimentos ────────────────────────────────────────────────────────────
  const abrirMov = (tipo: 'entrada' | 'baixa', produto: Produto) => { setFormMov({ quantidade: '', observacao: '', preco_pago: '' }); setErro(''); setModalMov({ aberto: true, tipo, produto }); };

  const salvarMov = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true); setErro('');
    if (!modalMov.produto) return;
    try {
      const body: any = { quantidade: Number(formMov.quantidade), observacao: formMov.observacao };
      if (modalMov.tipo === 'entrada' && formMov.preco_pago) body.preco_pago = Number(formMov.preco_pago);
      await api.post(`/estoque/produtos/${modalMov.produto.id}/${modalMov.tipo}`, body);
      setModalMov({ aberto: false, tipo: 'entrada', produto: null }); load();
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || 'Erro ao registrar.';
      setErro(status === 403 ? 'Sem permissão para este movimento.' : `[${status ?? 'ERR'}] ${msg}`);
    }
    setSalvando(false);
  };

  // ── Categorias CRUD ───────────────────────────────────────────────────────
  const abrirNovaCategoria = () => { setFormCategoria(''); setErro(''); setModalCategoria({ aberto: true, editando: null }); };
  const abrirEditarCategoria = (c: CategoriaInsumo) => { setFormCategoria(c.nome); setErro(''); setModalCategoria({ aberto: true, editando: c }); };

  const salvarCategoria = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true); setErro('');
    try {
      if (modalCategoria.editando) {
        await api.patch(`/estoque/categorias/${modalCategoria.editando.id}`, { nome: formCategoria });
      } else {
        await api.post('/estoque/categorias', { nome: formCategoria });
      }
      setModalCategoria({ aberto: false, editando: null }); load();
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || 'Erro.';
      setErro(status === 403 ? 'Sem permissão para gerenciar categorias.' : `[${status ?? 'ERR'}] ${msg}`);
    }
    setSalvando(false);
  };

  const deletarCategoria = async (c: CategoriaInsumo) => {
    if (!confirm(`Excluir categoria "${c.nome}"?`)) return;
    try { await api.delete(`/estoque/categorias/${c.id}`); load(); }
    catch (err: any) { alert(err.response?.data?.message || 'Erro.'); }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#131b2e] p-4 md:p-6 font-sans antialiased text-slate-900 dark:text-slate-100">
      <div className="max-w-[1400px] mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter italic text-slate-900 dark:text-white">Estoque<span className="text-green-600">.ITP</span></h1>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Controle de Produtos e Movimentações</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setMostrarColetor(v => !v)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-black text-[10px] uppercase hover:border-green-400 hover:text-green-600 transition-all">
              <Link2 size={13} /> Link Coletor
            </button>
            <button onClick={load} disabled={loading} className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-green-600 hover:border-green-400 transition-all disabled:opacity-60">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={abrirNovo} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-black text-xs uppercase tracking-widest transition-all shadow-sm">
              <Plus size={14} /> Novo Produto
            </button>
          </div>
        </div>

        {mostrarColetor && (
          <div className="bg-white dark:bg-slate-800 border border-green-200 dark:border-green-700/40 rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <Link2 size={16} className="text-green-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-green-600 mb-1">Link da Tela de Coletor</p>
              <p className="font-mono text-xs text-slate-600 dark:text-slate-300 break-all">{coletorUrl}</p>
            </div>
            <button onClick={() => navigator.clipboard.writeText(coletorUrl)} className="px-3 py-1.5 bg-green-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-green-700 transition-colors flex-shrink-0">Copiar</button>
          </div>
        )}

        {loadErro && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 rounded-2xl p-4 flex items-center gap-3">
            <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
            <p className="text-sm font-bold text-red-600 dark:text-red-400">{loadErro}</p>
          </div>
        )}

        {/* KPI CARDS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard label="Produtos Ativos" value={stats.total} icon={<Package size={18} />} color="bg-green-600" />
          <KPICard label="Categorias" value={stats.categorias} icon={<Tag size={18} />} color="bg-blue-600" />
          <KPICard label="Em Alerta" value={stats.alertas} icon={<AlertTriangle size={18} />} color={stats.alertas > 0 ? 'bg-red-500' : 'bg-slate-400'} />
          <KPICard label="Mov. Hoje" value={stats.movHoje} icon={<History size={18} />} color="bg-purple-600" />
        </div>

        {/* BANNER ALERTAS */}
        {alertas.length > 0 && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={15} className="text-red-500" />
              <p className="text-[11px] font-black uppercase tracking-widest text-red-600 dark:text-red-400">Alertas de Estoque Mínimo ({alertas.length})</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {alertas.map(p => (
                <div key={p.id} className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-700/40 rounded-xl px-3 py-1.5">
                  <span className="text-xs font-black text-slate-800 dark:text-slate-200">{p.nome}</span>
                  <span className="font-mono text-xs text-red-500 font-black">{fmt(p.quantidade_atual)}</span>
                  <span className="text-[10px] text-slate-400">/ mín {fmt(p.estoque_minimo)} {p.unidade_medida}</span>
                  <button onClick={() => abrirMov('entrada', p)} className="ml-1 px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white text-[10px] font-black rounded-lg uppercase transition-colors">Entrada</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TABS NAV */}
        <div className="flex gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-1.5 w-fit">
          {([
            { id: 'visao', label: 'Visão Geral', icon: <BarChart3 size={13} /> },
            { id: 'produtos', label: 'Produtos', icon: <Package size={13} /> },
            { id: 'movimentos', label: 'Movimentos', icon: <History size={13} /> },
            { id: 'categorias', label: 'Categorias', icon: <Tag size={13} /> },
            { id: 'valor', label: 'Cotação', icon: <DollarSign size={13} /> },
          ] as { id: Aba; label: string; icon: React.ReactNode }[]).map(t => (
            <button key={t.id} onClick={() => setAba(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all ${aba === t.id ? 'bg-green-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ABAS */}
        {aba === 'visao' && (
          <VisaoTab
            loading={loading}
            produtos={produtos}
            nomCategorias={nomCategorias}
            alertas={alertas}
            categorias={categorias}
            onEntrada={p => abrirMov('entrada', p)}
            onBaixa={p => abrirMov('baixa', p)}
          />
        )}
        {aba === 'produtos' && (
          <ProdutosTab
            loading={loading}
            produtosFiltrados={produtosFiltrados}
            nomCategorias={nomCategorias}
            busca={busca}
            setBusca={setBusca}
            filtroCategoria={filtroCategoria}
            setFiltroCategoria={setFiltroCategoria}
            showInativos={showInativos}
            setShowInativos={setShowInativos}
            onEntrada={p => abrirMov('entrada', p)}
            onBaixa={p => abrirMov('baixa', p)}
            onEditar={abrirEditar}
            onDeletar={deletarProduto}
          />
        )}
        {aba === 'movimentos' && (
          <MovimentosTab
            loading={loading}
            movimentos={movimentos}
            buscaMov={buscaMov}
            setBuscaMov={setBuscaMov}
            filtroTipoMov={filtroTipoMov}
            setFiltroTipoMov={setFiltroTipoMov}
          />
        )}
        {aba === 'categorias' && (
          <CategoriasTab
            loading={loading}
            categorias={categorias}
            produtos={produtos}
            onNova={abrirNovaCategoria}
            onEditar={abrirEditarCategoria}
            onDeletar={deletarCategoria}
          />
        )}
        {aba === 'valor' && (
          <CotacaoTab
            produtos={produtos}
            simulacao={simulacao}
            setSimulacao={setSimulacao}
            buscaCotacao={buscaCotacao}
            setBuscaCotacao={setBuscaCotacao}
            cotacaoSelecionados={cotacaoSelecionados}
            setCotacaoSelecionados={setCotacaoSelecionados}
          />
        )}

      </div>

      {/* MODAL: Criar / Editar Produto */}
      {modalProduto.aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="bg-green-600 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3"><Package size={18} className="text-white" /><p className="text-sm font-black text-white">{modalProduto.editando ? 'Editar Produto' : 'Novo Produto'}</p></div>
              <button onClick={() => setModalProduto({ aberto: false, editando: null })} className="text-white/70 hover:text-white"><X size={16} /></button>
            </div>
            <form onSubmit={salvarProduto} className="px-6 py-5 space-y-4">
              {erro && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl px-3 py-2">{erro}</div>}
              <FInput label="Nome *" value={formProduto.nome ?? ''} onChange={v => setFormProduto((p: any) => ({ ...p, nome: v }))} required />
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Categoria *</label>
                <div className="flex gap-2">
                  <select value={formProduto.categoria ?? ''} onChange={e => setFormProduto((p: any) => ({ ...p, categoria: e.target.value }))} required
                    className="flex-1 border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-green-400">
                    <option value="" disabled>Selecione...</option>
                    {nomCategorias.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button type="button" title="Nova categoria" onClick={() => { setModalProduto({ aberto: false, editando: null }); setAba('categorias'); abrirNovaCategoria(); }}
                    className="px-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-500 hover:text-green-600 hover:border-green-400 transition-colors">
                    <Plus size={14} />
                  </button>
                </div>
                {nomCategorias.length === 0 && <p className="text-[10px] text-orange-500 mt-1 font-bold">Nenhuma categoria. Crie uma primeiro na aba Categorias.</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Un. Medida</label>
                  <select value={formProduto.unidade_medida ?? 'un'} onChange={e => setFormProduto((p: any) => ({ ...p, unidade_medida: e.target.value }))}
                    className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-green-400">
                    {UN_MEDIDAS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <FInput label="Estoque Mínimo" type="number" step="0.001" value={String(formProduto.estoque_minimo ?? 0)} onChange={v => setFormProduto((p: any) => ({ ...p, estoque_minimo: v }))} />
              </div>
              {!modalProduto.editando && (
                <FInput label="Quantidade Inicial" type="number" step="0.001" value={String(formProduto.quantidade_atual ?? 0)} onChange={v => setFormProduto((p: any) => ({ ...p, quantidade_atual: v }))} />
              )}
              <FInput label="Custo Unitário (R$) — opcional" type="number" step="0.01" value={String(formProduto.valor_compra ?? '')} onChange={v => setFormProduto((p: any) => ({ ...p, valor_compra: v }))} placeholder="0,00" />
              <button type="submit" disabled={salvando}
                className="w-full py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-colors flex items-center justify-center gap-2">
                {salvando ? <><RefreshCw size={13} className="animate-spin" /> Salvando...</> : <><CheckCircle2 size={13} /> {modalProduto.editando ? 'Salvar' : 'Criar Produto'}</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Entrada / Baixa */}
      {modalMov.aberto && modalMov.produto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className={`px-6 py-4 flex items-center justify-between ${modalMov.tipo === 'entrada' ? 'bg-green-600' : 'bg-orange-500'}`}>
              <div className="flex items-center gap-3">
                {modalMov.tipo === 'entrada' ? <PackagePlus size={18} className="text-white" /> : <PackageMinus size={18} className="text-white" />}
                <div>
                  <p className="text-[9px] font-black text-white/80 uppercase tracking-widest">{modalMov.tipo === 'entrada' ? 'Registrar Entrada' : 'Registrar Baixa'}</p>
                  <p className="text-sm font-black text-white truncate max-w-[240px]">{modalMov.produto.nome}</p>
                </div>
              </div>
              <button onClick={() => setModalMov({ aberto: false, tipo: 'entrada', produto: null })} className="text-white/70 hover:text-white"><X size={16} /></button>
            </div>
            <form onSubmit={salvarMov} className="px-6 py-5 space-y-4">
              {erro && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl px-3 py-2">{erro}</div>}
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 flex gap-4 text-xs">
                <div><p className="text-[9px] font-black uppercase text-slate-400">Categoria</p><p className="font-bold text-slate-700 dark:text-slate-200">{modalMov.produto.categoria}</p></div>
                <div><p className="text-[9px] font-black uppercase text-slate-400">Disponível</p><p className="font-mono font-black text-slate-800 dark:text-slate-100">{fmt(modalMov.produto.quantidade_atual)} {modalMov.produto.unidade_medida}</p></div>
                {Number(modalMov.produto.estoque_minimo) > 0 && (
                  <div><p className="text-[9px] font-black uppercase text-slate-400">Mínimo</p><p className="font-mono text-slate-600 dark:text-slate-300">{fmt(modalMov.produto.estoque_minimo)}</p></div>
                )}
              </div>
              <FInput label={`Quantidade (${modalMov.produto.unidade_medida}) *`} type="number" step="0.001" value={formMov.quantidade} onChange={v => setFormMov((p: any) => ({ ...p, quantidade: v }))} required placeholder="0" />
              {modalMov.tipo === 'entrada' && (
                <FInput label="Preço pago por unidade (R$) — opcional" type="number" step="0.01" value={formMov.preco_pago ?? ''} onChange={v => setFormMov((p: any) => ({ ...p, preco_pago: v }))} placeholder="0,00" />
              )}
              <FInput label="Observação" value={formMov.observacao} onChange={v => setFormMov((p: any) => ({ ...p, observacao: v }))} placeholder="Opcional" />
              <button type="submit" disabled={salvando}
                className={`w-full py-2.5 disabled:opacity-60 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-colors flex items-center justify-center gap-2 ${modalMov.tipo === 'entrada' ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-500 hover:bg-orange-600'}`}>
                {salvando ? <><RefreshCw size={13} className="animate-spin" /> Registrando...</> : <><CheckCircle2 size={13} /> Confirmar</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Categoria */}
      {modalCategoria.aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-xs overflow-hidden">
            <div className="bg-blue-600 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3"><Tag size={16} className="text-white" /><p className="text-sm font-black text-white">{modalCategoria.editando ? 'Editar Categoria' : 'Nova Categoria'}</p></div>
              <button onClick={() => setModalCategoria({ aberto: false, editando: null })} className="text-white/70 hover:text-white"><X size={16} /></button>
            </div>
            <form onSubmit={salvarCategoria} className="px-6 py-5 space-y-4">
              {erro && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl px-3 py-2">{erro}</div>}
              <FInput label="Nome *" value={formCategoria} onChange={setFormCategoria} required placeholder="Ex: Insumos - Cozinha" />
              <button type="submit" disabled={salvando}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-colors flex items-center justify-center gap-2">
                {salvando ? <><RefreshCw size={13} className="animate-spin" /> Salvando...</> : <><CheckCircle2 size={13} /> {modalCategoria.editando ? 'Salvar' : 'Criar'}</>}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Sub-componentes de Aba ─────────────────────────────────────────────────

interface VisaoTabProps {
  loading: boolean;
  produtos: Produto[];
  nomCategorias: string[];
  alertas: Produto[];
  categorias: CategoriaInsumo[];
  onEntrada: (p: Produto) => void;
  onBaixa: (p: Produto) => void;
}
function VisaoTab({ loading, produtos, nomCategorias, alertas, categorias, onEntrada, onBaixa }: VisaoTabProps) {
  const totalAtivos = produtos.filter(p => p.ativo).length;
  const totalCategorias = categorias.length;

  return (
    <div className="space-y-6">
      {/* Mini-dashboard de resumo */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="bg-green-100 dark:bg-green-900/30 p-2 rounded-xl text-green-600">
            <Package size={15} />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Itens ativos</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-tighter">{totalAtivos}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className={`p-2 rounded-xl ${alertas.length > 0 ? 'bg-red-100 dark:bg-red-900/30 text-red-500' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
            <AlertTriangle size={15} />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Em alerta</p>
            <p className={`text-xl font-black tracking-tighter ${alertas.length > 0 ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'}`}>{alertas.length}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-xl text-blue-600">
            <Tag size={15} />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Categorias ativas</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-tighter">{totalCategorias}</p>
          </div>
        </div>
      </div>

      {/* Cards por categoria */}
      {loading ? (
        <div className="py-16 text-center text-slate-400"><RefreshCw size={24} className="animate-spin mx-auto mb-2" /></div>
      ) : produtos.filter(p => p.ativo).length === 0 ? (
        <div className="py-16 text-center text-slate-400"><Package size={40} className="mx-auto mb-3 opacity-30" /><p className="font-black text-sm">Nenhum produto cadastrado.</p></div>
      ) : (
        nomCategorias.map(cat => {
          const prods = produtos.filter(p => p.ativo && p.categoria === cat);
          if (prods.length === 0) return null;
          return (
            <div key={cat}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">{cat}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {prods.map(p => {
                  const alerta = emAlerta(p);
                  const pct = pctEstoque(p);
                  const barColor = alerta ? 'bg-red-500' : pct < 150 ? 'bg-yellow-400' : 'bg-green-500';
                  return (
                    <div key={p.id} className={`bg-white dark:bg-slate-800 border rounded-2xl p-4 space-y-3 ${alerta ? 'border-red-300 dark:border-red-700/50' : 'border-slate-100 dark:border-slate-700'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-black text-sm text-slate-800 dark:text-slate-100 leading-tight">{p.nome}</p>
                        {alerta && <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />}
                      </div>
                      <div className="flex items-baseline gap-1">
                        <p className={`font-mono font-black text-2xl tracking-tight ${alerta ? 'text-red-500' : 'text-green-600'}`}>{fmt(p.quantidade_atual)}</p>
                        <p className="text-xs text-slate-400 font-mono">{p.unidade_medida}</p>
                      </div>
                      {Number(p.estoque_minimo) > 0 && (
                        <div>
                          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                            <span>Mín: {fmt(p.estoque_minimo)} {p.unidade_medida}</span>
                            <span className={alerta ? 'text-red-500 font-black' : 'text-green-600 font-bold'}>{alerta ? '⚠ Abaixo' : 'OK'}</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        </div>
                      )}
                      <div className="flex gap-1.5 pt-1">
                        <button onClick={() => onEntrada(p)} className="flex-1 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-[10px] font-black uppercase transition-colors flex items-center justify-center gap-1">
                          <PackagePlus size={11} /> Entrada
                        </button>
                        <button onClick={() => onBaixa(p)} className="flex-1 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-black uppercase transition-colors flex items-center justify-center gap-1">
                          <PackageMinus size={11} /> Baixa
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

interface ProdutosTabProps {
  loading: boolean;
  produtosFiltrados: Produto[];
  nomCategorias: string[];
  busca: string;
  setBusca: (v: string) => void;
  filtroCategoria: string;
  setFiltroCategoria: (v: string) => void;
  showInativos: boolean;
  setShowInativos: (v: boolean) => void;
  onEntrada: (p: Produto) => void;
  onBaixa: (p: Produto) => void;
  onEditar: (p: Produto) => void;
  onDeletar: (p: Produto) => void;
}
function ProdutosTab({ loading, produtosFiltrados, nomCategorias, busca, setBusca, filtroCategoria, setFiltroCategoria, showInativos, setShowInativos, onEntrada, onBaixa, onEditar, onDeletar }: ProdutosTabProps) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto..."
            className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-green-400" />
        </div>
        <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-green-400">
          <option value="">Todas as categorias</option>
          {nomCategorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => setShowInativos(!showInativos)}
          className={`px-3 py-2 rounded-xl border text-xs font-bold transition-all ${showInativos ? 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-500' : 'border-slate-200 dark:border-slate-600 text-slate-500'}`}>
          {showInativos ? 'Ocultar Inativos' : 'Mostrar Inativos'}
        </button>
      </div>
      {loading ? (
        <div className="py-16 text-center text-slate-400"><RefreshCw size={20} className="animate-spin mx-auto mb-2" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/40">
                {['Nome', 'Categoria', 'Un.', 'Qtd Atual', 'Mínimo', 'Status', 'Ações'].map(h => (
                  <th key={h} className={`px-5 py-4 font-black text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 ${h === 'Ações' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {produtosFiltrados.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-xs font-bold">Nenhum produto encontrado.</td></tr>
              ) : produtosFiltrados.map(p => (
                <tr key={p.id} className={`hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors ${!p.ativo ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3.5 font-bold text-sm text-slate-800 dark:text-slate-200">{p.nome}</td>
                  <td className="px-5 py-3.5 text-[11px] text-slate-500 dark:text-slate-400 font-medium">{p.categoria}</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-slate-500">{p.unidade_medida}</td>
                  <td className="px-5 py-3.5 font-mono font-black text-sm text-slate-800 dark:text-slate-200">{fmt(p.quantidade_atual)}</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-slate-500">{Number(p.estoque_minimo) > 0 ? fmt(p.estoque_minimo) : '—'}</td>
                  <td className="px-5 py-3.5">
                    {!p.ativo ? (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 dark:bg-slate-700 text-slate-400">Inativo</span>
                    ) : emAlerta(p) ? (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">⚠ Alerta</span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">OK</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {p.ativo && <>
                        <button onClick={() => onEntrada(p)} title="Entrada" className="p-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 hover:bg-green-100 transition-colors"><PackagePlus size={13} /></button>
                        <button onClick={() => onBaixa(p)} title="Baixa" className="p-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 text-orange-500 hover:bg-orange-100 transition-colors"><PackageMinus size={13} /></button>
                      </>}
                      <button onClick={() => onEditar(p)} title="Editar" className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 hover:bg-slate-200 transition-colors"><Edit2 size={13} /></button>
                      {p.ativo && <button onClick={() => onDeletar(p)} title="Desativar" className="p-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 transition-colors"><Trash2 size={13} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface MovimentosTabProps {
  loading: boolean;
  movimentos: Movimento[];
  buscaMov: string;
  setBuscaMov: (v: string) => void;
  filtroTipoMov: '' | 'entrada' | 'baixa';
  setFiltroTipoMov: (v: '' | 'entrada' | 'baixa') => void;
}
function MovimentosTab({ loading, movimentos, buscaMov, setBuscaMov, filtroTipoMov, setFiltroTipoMov }: MovimentosTabProps) {
  const movFiltrados = movimentos.filter(m => {
    if (filtroTipoMov && m.tipo !== filtroTipoMov) return false;
    if (buscaMov) {
      const q = buscaMov.toLowerCase();
      return (m.produto?.nome ?? '').toLowerCase().includes(q) || (m.observacao ?? '').toLowerCase().includes(q) || (m.usuario_nome ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={buscaMov} onChange={e => setBuscaMov(e.target.value)} placeholder="Buscar produto, observação..."
            className="w-full pl-8 pr-3 py-2 border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-green-400" />
        </div>
        <select value={filtroTipoMov} onChange={e => setFiltroTipoMov(e.target.value as '' | 'entrada' | 'baixa')}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-green-400">
          <option value="">Todos os tipos</option>
          <option value="entrada">Entradas</option>
          <option value="baixa">Baixas</option>
        </select>
        <span className="text-[10px] text-slate-400 self-center">{movFiltrados.length} mov.</span>
      </div>
      {loading ? (
        <div className="py-16 text-center text-slate-400"><RefreshCw size={20} className="animate-spin mx-auto mb-2" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/40">
                {['Produto', 'Tipo', '± Quantidade', 'Observação', 'Usuário / Operador', 'Data/Hora'].map(h => (
                  <th key={h} className="px-5 py-4 text-left font-black text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {movFiltrados.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-xs font-bold">Nenhum movimento encontrado.</td></tr>
              ) : movFiltrados.map(m => (
                <tr key={m.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors">
                  <td className="px-5 py-3 font-bold text-sm text-slate-800 dark:text-slate-200">{m.produto?.nome || '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${m.tipo === 'entrada' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'}`}>
                      {m.tipo === 'entrada' ? '▲ Entrada' : '▼ Baixa'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`font-mono font-black text-sm ${m.tipo === 'entrada' ? 'text-green-600' : 'text-orange-500'}`}>
                      {m.tipo === 'entrada' ? '+' : '-'}{fmt(m.quantidade)}
                    </span>
                    <span className="text-[10px] text-slate-400 ml-1">{m.produto?.unidade_medida}</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500 max-w-[200px] truncate">{m.observacao || '—'}</td>
                  <td className="px-5 py-3 text-xs text-slate-500">{m.usuario_nome || '—'}</td>
                  <td className="px-5 py-3 text-right font-mono text-[11px] text-slate-500">{fmtData(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface CategoriasTabProps {
  loading: boolean;
  categorias: CategoriaInsumo[];
  produtos: Produto[];
  onNova: () => void;
  onEditar: (c: CategoriaInsumo) => void;
  onDeletar: (c: CategoriaInsumo) => void;
}
function CategoriasTab({ loading, categorias, produtos, onNova, onEditar, onDeletar }: CategoriasTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-widest text-slate-400">Categorias cadastradas</p>
        <button onClick={onNova} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-black text-xs uppercase tracking-widest transition-all">
          <Plus size={13} /> Nova Categoria
        </button>
      </div>
      <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-slate-400"><RefreshCw size={20} className="animate-spin mx-auto mb-2" /></div>
        ) : categorias.length === 0 ? (
          <div className="py-12 text-center text-slate-400"><Tag size={32} className="mx-auto mb-2 opacity-30" /><p className="text-xs font-bold">Nenhuma categoria cadastrada.</p></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/40">
                <th className="px-5 py-4 text-left font-black text-[10px] uppercase tracking-widest text-slate-500">Nome</th>
                <th className="px-5 py-4 text-left font-black text-[10px] uppercase tracking-widest text-slate-500">Produtos</th>
                <th className="px-5 py-4 text-right font-black text-[10px] uppercase tracking-widest text-slate-500">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {categorias.map(c => {
                const total = produtos.filter(p => p.ativo && p.categoria === c.nome).length;
                return (
                  <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors">
                    <td className="px-5 py-3.5 font-bold text-sm text-slate-800 dark:text-slate-200">{c.nome}</td>
                    <td className="px-5 py-3.5 text-xs text-slate-500">{total} produto{total !== 1 ? 's' : ''}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => onEditar(c)} className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-500 hover:bg-slate-200 transition-colors"><Edit2 size={13} /></button>
                        <button onClick={() => onDeletar(c)} className="p-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface CotacaoTabProps {
  produtos: Produto[];
  simulacao: Record<string, string>;
  setSimulacao: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  buscaCotacao: string;
  setBuscaCotacao: (v: string) => void;
  cotacaoSelecionados: Set<string>;
  setCotacaoSelecionados: React.Dispatch<React.SetStateAction<Set<string>>>;
}
function CotacaoTab({ produtos, simulacao, setSimulacao, buscaCotacao, setBuscaCotacao, cotacaoSelecionados, setCotacaoSelecionados }: CotacaoTabProps) {
  const prodAtivos = produtos.filter(p => p.ativo);
  const comPreco = prodAtivos.filter(p => p.valor_compra != null);
  const valorTotal = comPreco.reduce((acc, p) => acc + Number(p.quantidade_atual) * Number(p.valor_compra!), 0);

  const prodFiltrados = prodAtivos.filter(p =>
    !buscaCotacao || p.nome.toLowerCase().includes(buscaCotacao.toLowerCase()) || p.categoria.toLowerCase().includes(buscaCotacao.toLowerCase())
  );

  const totalCotacao = prodFiltrados
    .filter(p => cotacaoSelecionados.size === 0 || cotacaoSelecionados.has(p.id))
    .reduce((acc, p) => {
      const qty = Number(simulacao[p.id] || 0);
      return acc + qty * Number(p.valor_compra || 0);
    }, 0);

  const toggleSelecionado = (id: string) => {
    setCotacaoSelecionados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selecionarTodos = () => {
    if (cotacaoSelecionados.size === prodFiltrados.length) {
      setCotacaoSelecionados(new Set());
    } else {
      setCotacaoSelecionados(new Set(prodFiltrados.map(p => p.id)));
    }
  };

  const imprimirCotacao = () => {
    const itens = prodFiltrados.filter(p => cotacaoSelecionados.size === 0 || cotacaoSelecionados.has(p.id));
    const totalImp = itens.reduce((acc, p) => {
      const qty = Number(simulacao[p.id] || 0);
      return acc + qty * Number(p.valor_compra || 0);
    }, 0);
    const linhas = itens.map(p => {
      const qty = Number(simulacao[p.id] || 0);
      const custo = p.valor_compra != null && qty > 0 ? (qty * Number(p.valor_compra)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
      return `<tr>
        <td>${escapeHtml(p.nome)}</td><td>${escapeHtml(p.categoria)}</td>
        <td>${fmt(p.quantidade_atual)} ${escapeHtml(p.unidade_medida)}</td>
        <td>${p.valor_compra != null ? Number(p.valor_compra).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td>
        <td>${qty > 0 ? fmt(qty) : '—'}</td>
        <td>${custo}</td>
      </tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><title>Cotação — ITP</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;padding:24px}h1{font-size:16px;margin-bottom:4px}p.sub{color:#666;font-size:11px;margin-bottom:16px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}th{background:#f0f0f0;font-weight:700;font-size:11px;text-transform:uppercase}
.tot td{font-weight:700;background:#eff6ff;font-size:13px}</style></head>
<body><h1>Cotação de Compra</h1><p class="sub">Instituto Tia Pretinha · Gerado em ${new Date().toLocaleString('pt-BR')}</p>
<table><thead><tr><th>Produto</th><th>Categoria</th><th>Qtd Atual</th><th>Custo Unitário</th><th>Qtd a Comprar</th><th>Custo Total</th></tr></thead>
<tbody>${linhas}</tbody>${totalImp > 0 ? `<tfoot><tr class="tot"><td colspan="5" style="text-align:right">TOTAL DA COTAÇÃO</td><td>${totalImp.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr></tfoot>` : ''}
</table></body></html>`;
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); win.print(); }
  };

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 flex items-center gap-4">
          <div className="bg-emerald-600 p-3 rounded-xl text-white"><DollarSign size={18} /></div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Valor Total em Estoque</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-tighter">{fmtMoeda(valorTotal)}</p>
            <p className="text-[9px] text-slate-400">{comPreco.length} de {prodAtivos.length} itens com custo</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-xl text-white"><ShoppingCart size={18} /></div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total da Cotação</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-tighter">{fmtMoeda(totalCotacao)}</p>
            <p className="text-[9px] text-slate-400">{cotacaoSelecionados.size > 0 ? `${cotacaoSelecionados.size} itens selecionados` : 'Preencha as qtds abaixo'}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 flex items-center gap-4">
          <div className="bg-purple-600 p-3 rounded-xl text-white"><Calculator size={18} /></div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sem Custo Cadastrado</p>
            <p className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-tighter">{prodAtivos.length - comPreco.length}</p>
            <p className="text-[9px] text-slate-400">itens sem custo unitário</p>
          </div>
        </div>
      </div>

      {/* Tabela de cotação */}
      <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex-1">Cotação de Compra</p>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={buscaCotacao} onChange={e => setBuscaCotacao(e.target.value)} placeholder="Buscar produto..."
              className="pl-7 pr-3 py-1.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 w-40" />
          </div>
          <button onClick={selecionarTodos}
            className="text-[9px] font-black uppercase text-slate-500 hover:text-blue-600 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 transition-colors">
            {cotacaoSelecionados.size === prodFiltrados.length && prodFiltrados.length > 0 ? 'Limpar seleção' : 'Selecionar todos'}
          </button>
          <button onClick={() => setSimulacao({})}
            className="text-[9px] font-black uppercase text-slate-400 hover:text-red-500 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 transition-colors">
            Limpar qtds
          </button>
          <button onClick={imprimirCotacao}
            className="flex items-center gap-1.5 text-[9px] font-black uppercase bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors">
            <Printer size={11}/> Imprimir / PDF
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/40">
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={cotacaoSelecionados.size === prodFiltrados.length && prodFiltrados.length > 0}
                    onChange={selecionarTodos} className="accent-blue-600 w-3.5 h-3.5" />
                </th>
                {['Produto', 'Categoria', 'Qtd Atual', 'Custo Unitário', 'Valor em Estoque', 'Qtd a Comprar', 'Custo Total'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-black text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {prodFiltrados.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-xs font-bold">Nenhum produto encontrado.</td></tr>
              ) : prodFiltrados.map(p => {
                const valorEstoque = p.valor_compra != null ? Number(p.quantidade_atual) * Number(p.valor_compra) : null;
                const qtdSim = Number(simulacao[p.id] || 0);
                const custoSim = p.valor_compra != null ? qtdSim * Number(p.valor_compra) : null;
                const selecionado = cotacaoSelecionados.has(p.id);
                return (
                  <tr key={p.id} className={`hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors ${selecionado ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selecionado} onChange={() => toggleSelecionado(p.id)} className="accent-blue-600 w-3.5 h-3.5" />
                    </td>
                    <td className="px-4 py-3 font-bold text-sm text-slate-800 dark:text-slate-200">{p.nome}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-500">{p.categoria}</td>
                    <td className="px-4 py-3 font-mono font-black text-sm text-slate-700 dark:text-slate-300">{fmt(p.quantidade_atual)} {p.unidade_medida}</td>
                    <td className="px-4 py-3 font-mono text-sm text-emerald-700 dark:text-emerald-400 font-black">{fmtMoeda(p.valor_compra)}</td>
                    <td className="px-4 py-3 font-mono text-sm font-black text-slate-800 dark:text-slate-100">{fmtMoeda(valorEstoque)}</td>
                    <td className="px-4 py-3">
                      <input type="number" min="0" step="0.001"
                        value={simulacao[p.id] ?? ''}
                        onChange={e => setSimulacao(prev => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder="0"
                        className="w-24 border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-black text-blue-700 dark:text-blue-400">
                      {custoSim != null && qtdSim > 0 ? fmtMoeda(custoSim) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {totalCotacao > 0 && (
              <tfoot>
                <tr className="bg-blue-50 dark:bg-blue-900/20 border-t-2 border-blue-200 dark:border-blue-700">
                  <td colSpan={7} className="px-4 py-3 font-black text-sm text-blue-700 dark:text-blue-300 text-right uppercase tracking-widest">Total da Cotação</td>
                  <td className="px-4 py-3 font-black text-lg text-blue-700 dark:text-blue-300">{fmtMoeda(totalCotacao)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 text-center">* Custo unitário é configurado ao criar/editar produto ou ao registrar uma entrada com preço pago.</p>
    </div>
  );
}

// ── Componentes utilitários ────────────────────────────────────────────────

function KPICard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-5 flex items-center gap-4">
      <div className={`${color} p-3 rounded-xl text-white flex items-center justify-center`}>{icon}</div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        <p className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tighter">{value}</p>
      </div>
    </div>
  );
}

function FInput({ label, value, onChange, type = 'text', required, placeholder, step }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; placeholder?: string; step?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">{label}</label>
      <input type={type} step={step} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required}
        className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-green-400 transition-shadow" />
    </div>
  );
}
