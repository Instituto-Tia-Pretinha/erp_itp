'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  BarChart2, Download, TrendingUp, Users, BookOpen,
  Package, Heart, DollarSign, Globe, Filter, RefreshCw,
  Leaf, HandHeart, Eye, EyeOff, Mail, Send, X, CheckCircle,
  AlertCircle, Target, UserCheck, FileText, Clock, Printer,
} from 'lucide-react';
import api from '@/services/api';
import { escapeHtml } from '@/lib/utils';

/* ── Helpers ── */
function moeda(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v ?? 0);
}

function exportarExcel(dados: Record<string, unknown>[], nomeArquivo: string) {
  import('xlsx').then(mod => {
    const XLSX = (mod.default ?? mod) as typeof import('xlsx');
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Relatório');
    XLSX.writeFile(wb, `${nomeArquivo}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });
}

const CORES_PIZZA = ['#7c3aed', '#a855f7', '#c084fc', '#d8b4fe', '#ede9fe', '#4f46e5', '#818cf8'];

type AbaId = 'financeiro' | 'academico' | 'social' | 'estoque' | 'dre' | 'ong' | 'captacao' | 'rh';

/* ── Modal de Envio por E-mail ── */
function ModalEmail({
  tipo, params, onClose,
}: { tipo: string; params: Record<string, string>; onClose: () => void }) {
  const [email, setEmail] = React.useState('');
  const [enviando, setEnviando] = React.useState(false);
  const [sucesso, setSucesso] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const enviar = async () => {
    if (!email.includes('@')) { setErro('E-mail inválido.'); return; }
    setEnviando(true); setErro(null);
    try {
      await api.post('/relatorios/enviar-email', { tipo, params, destinatario: email });
      setSucesso(true);
    } catch (e: any) {
      setErro(e?.response?.data?.message || e?.message || 'Erro ao enviar.');
    } finally { setEnviando(false); }
  };

  return (
    <div className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-purple-600" />
            <h3 className="font-black text-sm uppercase tracking-tight text-slate-800 dark:text-slate-100">Enviar por E-mail</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><X size={15}/></button>
        </div>
        <div className="p-5 space-y-4">
          {sucesso ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle size={40} className="text-green-500" />
              <p className="font-black text-sm text-slate-700 dark:text-slate-200">Relatório enviado com sucesso!</p>
              <button onClick={onClose} className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-black uppercase hover:bg-green-700">Fechar</button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1.5">Destinatário</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="email@exemplo.com"
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 dark:bg-slate-800 dark:text-slate-100" />
              </div>
              {erro && (
                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-xl px-3 py-2.5 text-xs font-bold">
                  <AlertCircle size={13}/> {erro}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-black text-xs uppercase hover:bg-slate-50 dark:hover:bg-slate-800">Cancelar</button>
                <button onClick={enviar} disabled={enviando}
                  className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl font-black text-xs uppercase hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                  {enviando ? <RefreshCw size={12} className="animate-spin"/> : <Send size={12}/>}
                  {enviando ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Barra de ações padronizada para cada seção de relatório ── */
function AcoesRelatorio({
  tipo, params, dados, onGerar, carregando, onExportar, labelGerar = 'Gerar', corGerar = 'bg-purple-600 hover:bg-purple-700',
}: {
  tipo: string; params?: Record<string, string>; dados: unknown; onGerar: () => void;
  carregando: boolean; onExportar?: () => void; labelGerar?: string; corGerar?: string;
}) {
  const [showEmail, setShowEmail] = React.useState(false);
  return (
    <div className="flex gap-2 flex-wrap items-center">
      <button onClick={onGerar} disabled={carregando}
        className={`px-3 py-1.5 text-xs font-bold ${corGerar} text-white rounded-lg flex items-center gap-1 disabled:opacity-50`}>
        {carregando ? <RefreshCw size={12} className="animate-spin"/> : <Filter size={12}/>} {labelGerar}
      </button>
      {!!dados && onExportar && (
        <button onClick={onExportar}
          className="px-3 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
          <Download size={12}/> Excel
        </button>
      )}
      {!!dados && (
        <button onClick={() => setShowEmail(true)}
          className="px-3 py-1.5 text-xs font-bold border border-purple-200 text-purple-600 dark:border-purple-700 dark:text-purple-400 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 flex items-center gap-1">
          <Mail size={12}/> E-mail
        </button>
      )}
      {showEmail && <ModalEmail tipo={tipo} params={params ?? {}} onClose={() => setShowEmail(false)} />}
    </div>
  );
}

/* ── Empty state padrão (relatório não gerado) ── */
function EmptyRelatorio({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <div className="p-10 flex flex-col items-center gap-3 text-slate-400 dark:text-slate-600">
      <BarChart2 size={32} className="opacity-30" />
      <p className="text-sm font-bold">Relatório não gerado</p>
      <button onClick={onClick} disabled={loading}
        className="px-4 py-2 bg-purple-600 text-white rounded-xl text-xs font-black uppercase hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5">
        {loading ? <RefreshCw size={12} className="animate-spin"/> : <Filter size={12}/>} Gerar agora
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   ABAS FINANCEIRO
═══════════════════════════════════════════════════════════ */

function AbaFinanceiro() {
  const anoAtual = new Date().getFullYear();
  const [resumo, setResumo]     = useState<Record<string, unknown> | null>(null);
  const [fluxo, setFluxo]       = useState<unknown[]>([]);
  const [doacoes, setDoacoes]   = useState<Record<string, unknown> | null>(null);
  const [contabil, setContabil] = useState<unknown[]>([]);
  const [dataIni, setDataIni] = useState(`${anoAtual}-01-01`);
  const [dataFim, setDataFim] = useState(`${anoAtual}-12-31`);
  const [ano, setAno]         = useState(String(anoAtual));
  const [mes, setMes]         = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [carregando, setCarregando] = useState<string | null>(null);

  const carregar = useCallback(async (tipo: string) => {
    setCarregando(tipo);
    try {
      if (tipo === 'resumo') {
        const { data } = await api.get(`/relatorios/financeiro/resumo?data_ini=${dataIni}&data_fim=${dataFim}`);
        setResumo(data);
      } else if (tipo === 'fluxo') {
        const { data } = await api.get(`/relatorios/financeiro/fluxo-caixa?ano=${ano}`);
        setFluxo(data.meses ?? []);
      } else if (tipo === 'doacoes') {
        const { data } = await api.get(`/relatorios/financeiro/doacoes?data_ini=${dataIni}&data_fim=${dataFim}`);
        setDoacoes(data);
      } else if (tipo === 'contabil') {
        const { data } = await api.get(`/relatorios/financeiro/contabil?mes=${mes}&ano=${ano}`);
        setContabil(data.lancamentos ?? []);
      }
    } catch {/* silencia */} finally { setCarregando(null); }
  }, [dataIni, dataFim, ano, mes]);

  useEffect(() => {
    carregar('resumo'); carregar('fluxo'); carregar('doacoes'); carregar('contabil');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Filtros globais ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">De</label>
          <input type="date" value={dataIni} onChange={e => setDataIni(e.target.value)}
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Até</label>
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Ano</label>
          <input type="number" value={ano} onChange={e => setAno(e.target.value)} min="2020" max="2099"
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm w-24 bg-white dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Mês</label>
          <select value={mes} onChange={e => setMes(e.target.value)}
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-800 dark:text-slate-100">
            {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Resumo Financeiro ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <TrendingUp size={16} className="text-purple-600" /> Resumo Financeiro
          </h3>
          <AcoesRelatorio
            tipo="resumo_financeiro"
            params={{ data_ini: dataIni, data_fim: dataFim }}
            dados={resumo}
            onGerar={() => carregar('resumo')}
            carregando={carregando === 'resumo'}
            onExportar={() => resumo && exportarExcel([(resumo.categorias as unknown[])].flat() as Record<string, unknown>[], 'resumo_financeiro')}
          />
        </div>
        {!resumo && <EmptyRelatorio onClick={() => carregar('resumo')} loading={carregando === 'resumo'} />}
        {resumo && (
          <div className="p-5 space-y-4">
            {/* ── 3 KPIs ── */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Receitas', value: moeda(Number(resumo.total_receitas)), color: 'text-green-600' },
                { label: 'Despesas', value: moeda(Number(resumo.total_despesas)), color: 'text-red-500' },
                { label: 'Saldo', value: moeda(Number(resumo.saldo)), color: Number(resumo.saldo) >= 0 ? 'text-green-600' : 'text-red-500' },
              ].map(c => (
                <div key={c.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{c.label}</p>
                  <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
            {Array.isArray(resumo.categorias) && resumo.categorias.length > 0 && (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={resumo.categorias as Record<string, unknown>[]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="categoria" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => moeda(v)} />
                  <Bar dataKey="receita" name="Receita" fill="#7c3aed" radius={[4,4,0,0]} />
                  <Bar dataKey="despesa" name="Despesa" fill="#f87171" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>

      {/* ── Fluxo de Caixa ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <TrendingUp size={16} className="text-green-600" /> Fluxo de Caixa Mensal
          </h3>
          <AcoesRelatorio
            tipo="fluxo_caixa"
            params={{ ano }}
            dados={fluxo.length > 0 ? fluxo : null}
            onGerar={() => carregar('fluxo')}
            carregando={carregando === 'fluxo'}
            corGerar="bg-green-600 hover:bg-green-700"
            onExportar={() => exportarExcel(fluxo as Record<string, unknown>[], 'fluxo_caixa')}
          />
        </div>
        {fluxo.length === 0 && <EmptyRelatorio onClick={() => carregar('fluxo')} loading={carregando === 'fluxo'} />}
        {fluxo.length > 0 && (
          <div className="p-5">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={fluxo as Record<string, unknown>[]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => moeda(v)} />
                <Legend />
                <Line type="monotone" dataKey="receita" name="Receita" stroke="#7c3aed" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="despesa" name="Despesa" stroke="#f87171" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="saldo" name="Saldo" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Doações ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Heart size={16} className="text-pink-500" /> Relatório de Doações
          </h3>
          <AcoesRelatorio
            tipo="doacoes"
            params={{ data_ini: dataIni, data_fim: dataFim }}
            dados={doacoes}
            onGerar={() => carregar('doacoes')}
            carregando={carregando === 'doacoes'}
            corGerar="bg-pink-600 hover:bg-pink-700"
            onExportar={() => doacoes && exportarExcel((doacoes.maiores_doadores as unknown[]) as Record<string, unknown>[], 'doacoes')}
          />
        </div>
        {!doacoes && <EmptyRelatorio onClick={() => carregar('doacoes')} loading={carregando === 'doacoes'} />}
        {doacoes && (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Doado</p>
                <p className="text-xl font-black text-pink-600 mt-1">{moeda(Number(doacoes.total_doacoes))}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Nº Doadores</p>
                <p className="text-xl font-black text-purple-600 mt-1">{String(doacoes.num_doadores)}</p>
              </div>
            </div>
            {Array.isArray(doacoes.evolucao_mensal) && doacoes.evolucao_mensal.length > 0 && (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={doacoes.evolucao_mensal as Record<string, unknown>[]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => moeda(v)} />
                  <Bar dataKey="total" name="Doações" fill="#ec4899" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>

      {/* ── Contábil ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <DollarSign size={16} className="text-yellow-500" /> Relatório Contábil
          </h3>
          <AcoesRelatorio
            tipo="contabil"
            params={{ mes, ano }}
            dados={contabil.length > 0 ? contabil : null}
            onGerar={() => carregar('contabil')}
            carregando={carregando === 'contabil'}
            corGerar="bg-yellow-500 hover:bg-yellow-600"
            onExportar={() => exportarExcel(contabil as Record<string, unknown>[], 'contabil')}
          />
        </div>
        {contabil.length === 0 && <EmptyRelatorio onClick={() => carregar('contabil')} loading={carregando === 'contabil'} />}
        {contabil.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <th className="px-4 py-2.5 text-left font-black text-slate-500 uppercase tracking-wider">Plano de Contas</th>
                  <th className="px-4 py-2.5 text-right font-black text-slate-500 uppercase tracking-wider">Receitas</th>
                  <th className="px-4 py-2.5 text-right font-black text-slate-500 uppercase tracking-wider">Despesas</th>
                  <th className="px-4 py-2.5 text-right font-black text-slate-500 uppercase tracking-wider">Lançamentos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(contabil as Record<string, unknown>[]).map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{String(r.plano_contas || r.categoria)}</td>
                    <td className="px-4 py-2.5 text-right text-green-600 font-bold">{moeda(Number(r.total_receitas))}</td>
                    <td className="px-4 py-2.5 text-right text-red-500 font-bold">{moeda(Number(r.total_despesas))}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600 dark:text-slate-400">{String(r.num_lancamentos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Boletos a Vencer ── */}
      <BoletosVencerSection />

    </div>
  );
}

function BoletosVencerSection() {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data } = await api.get('/financeiro/boletos');
      const hoje = new Date();
      const limite = new Date(hoje.getTime() + dias * 86_400_000);
      const filtrados = (data ?? []).filter((b: any) => {
        if (b.pago) return false;
        const vcto = new Date(b.data_vencimento ?? b.data_emissao);
        return vcto >= hoje && vcto <= limite;
      }).sort((a: any, b: any) => new Date(a.data_vencimento ?? a.data_emissao).getTime() - new Date(b.data_vencimento ?? b.data_emissao).getTime());
      setDados(filtrados);
    } catch {/* silencia */} finally { setCarregando(false); }
  }, [dias]);

  const totalVencer = dados.reduce((s, b) => s + Number(b.valor ?? 0), 0);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex-wrap gap-3">
        <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
          <Clock size={16} className="text-orange-500" /> Boletos a Vencer
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={dias} onChange={e => setDias(Number(e.target.value))}
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-slate-800 dark:text-slate-100">
            <option value={30}>Próximos 30 dias</option>
            <option value={60}>Próximos 60 dias</option>
            <option value={90}>Próximos 90 dias</option>
          </select>
          <button onClick={carregar} disabled={carregando}
            className="px-3 py-1.5 text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-lg flex items-center gap-1 disabled:opacity-50">
            {carregando ? <RefreshCw size={12} className="animate-spin"/> : <Filter size={12}/>} Gerar
          </button>
          {dados.length > 0 && (
            <button onClick={() => exportarExcel(dados, 'boletos_a_vencer')}
              className="px-3 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
              <Download size={12}/> Excel
            </button>
          )}
        </div>
      </div>
      {dados.length === 0 && !carregando && (
        <EmptyRelatorio onClick={carregar} loading={carregando} />
      )}
      {dados.length > 0 && (
        <>
          <div className="px-5 py-3 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-100 dark:border-orange-800 flex items-center gap-4">
            <span className="text-[10px] font-black uppercase text-orange-500">{dados.length} boleto{dados.length !== 1 ? 's' : ''} a vencer</span>
            <span className="font-black text-orange-600">{moeda(totalVencer)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                <tr>
                  {['Credor', 'Valor', 'Vencimento', 'Dias Restantes'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-black text-[10px] uppercase tracking-wider text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {dados.map((b: any, i: number) => {
                  const vcto = new Date(b.data_vencimento ?? b.data_emissao);
                  const diff = Math.ceil((vcto.getTime() - Date.now()) / 86_400_000);
                  return (
                    <tr key={i} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${diff <= 7 ? 'bg-red-50/30 dark:bg-red-900/10' : ''}`}>
                      <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">{b.credor || '—'}</td>
                      <td className="px-4 py-2.5 font-mono font-black text-orange-600">{moeda(Number(b.valor ?? 0))}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{vcto.toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-2.5">
                        <span className={`font-black ${diff <= 7 ? 'text-red-500' : diff <= 15 ? 'text-orange-500' : 'text-slate-600'}`}>
                          {diff} dia{diff !== 1 ? 's' : ''}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   ABAS ACADÊMICO
═══════════════════════════════════════════════════════════ */

function AbaAcademico() {
  const [alunos, setAlunos]         = useState<Record<string, unknown> | null>(null);
  const [academico, setAcademico]   = useState<Record<string, unknown> | null>(null);
  const [matriculas, setMatriculas] = useState<Record<string, unknown> | null>(null);
  const [carregando, setCarregando] = useState<string | null>(null);

  const carregar = useCallback(async (tipo: string) => {
    setCarregando(tipo);
    try {
      if (tipo === 'alunos') {
        const { data } = await api.get('/relatorios/academico/alunos');
        setAlunos(data);
      } else if (tipo === 'academico') {
        const { data } = await api.get('/relatorios/academico/geral');
        setAcademico(data);
      } else if (tipo === 'matriculas') {
        const { data } = await api.get('/relatorios/academico/matriculas');
        setMatriculas(data);
      }
    } catch {/* silencia */} finally { setCarregando(null); }
  }, []);

  useEffect(() => {
    carregar('alunos'); carregar('academico'); carregar('matriculas');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Alunos ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Users size={16} className="text-blue-600" /> Relatório de Alunos
          </h3>
          <AcoesRelatorio
            tipo="alunos"
            dados={alunos}
            onGerar={() => carregar('alunos')}
            carregando={carregando === 'alunos'}
            corGerar="bg-blue-600 hover:bg-blue-700"
            onExportar={() => alunos && exportarExcel((alunos.por_curso as unknown[]) as Record<string, unknown>[], 'alunos')}
          />
        </div>
        {!alunos && <EmptyRelatorio onClick={() => carregar('alunos')} loading={carregando === 'alunos'} />}
        {alunos && (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total Ativos', value: String(alunos.total_ativos) },
                { label: 'Total Inativos', value: String(alunos.total_inativos) },
                { label: 'Manhã', value: String((alunos.turnos as Record<string, unknown>[] | undefined)?.find((t) => t.turno_escolar === 'Manhã')?.total ?? 0) },
                { label: 'Noturno', value: String((alunos.turnos as Record<string, unknown>[] | undefined)?.find((t) => t.turno_escolar === 'Noite')?.total ?? 0) },
              ].map(c => (
                <div key={c.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{c.label}</p>
                  <p className="text-xl font-black text-blue-600 mt-1">{c.value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.isArray(alunos.por_curso) && alunos.por_curso.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Por Curso</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={alunos.por_curso as Record<string, unknown>[]} dataKey="total" nameKey="cursos_matriculados" cx="50%" cy="50%" outerRadius={80} label={({ name, value }: { name: string; value: number }) => `${name}: ${value}`}>
                        {(alunos.por_curso as Record<string, unknown>[]).map((_: unknown, i: number) => (
                          <Cell key={i} fill={CORES_PIZZA[i % CORES_PIZZA.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              {Array.isArray(alunos.turnos) && alunos.turnos.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Por Turno</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={alunos.turnos as Record<string, unknown>[]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="turno_escolar" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="total" fill="#3b82f6" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Visão Geral Acadêmica ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <BookOpen size={16} className="text-purple-600" /> Visão Geral Acadêmica
          </h3>
          <AcoesRelatorio
            tipo="academico"
            dados={academico}
            onGerar={() => carregar('academico')}
            carregando={carregando === 'academico'}
          />
        </div>
        {!academico && <EmptyRelatorio onClick={() => carregar('academico')} loading={carregando === 'academico'} />}
        {academico && (
          <div className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Cursos', value: String(academico.total_cursos) },
                { label: 'Professores', value: String(academico.total_professores) },
                { label: 'Alunos em Turmas', value: String(academico.turmas_ativas) },
                { label: 'Aulas na Grade', value: String(academico.cards_grade) },
              ].map(c => (
                <div key={c.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{c.label}</p>
                  <p className="text-2xl font-black text-purple-600 mt-1">{c.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Matrículas ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <BookOpen size={16} className="text-indigo-600" /> Pipeline de Matrículas
          </h3>
          <AcoesRelatorio
            tipo="matriculas"
            dados={matriculas}
            onGerar={() => carregar('matriculas')}
            carregando={carregando === 'matriculas'}
            corGerar="bg-indigo-600 hover:bg-indigo-700"
            onExportar={() => matriculas && exportarExcel((matriculas.por_status as unknown[]) as Record<string, unknown>[], 'matriculas')}
          />
        </div>
        {!matriculas && <EmptyRelatorio onClick={() => carregar('matriculas')} loading={carregando === 'matriculas'} />}
        {matriculas && (
          <div className="p-5 space-y-4">
            {Array.isArray(matriculas.por_status) && (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={matriculas.por_status as Record<string, unknown>[]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="status_matricula" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="#6366f1" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>

      {/* ── Frequência por Turma ── */}
      <FrequenciaTurmaSection />

    </div>
  );
}

function FrequenciaTurmaSection() {
  const anoAtual = new Date().getFullYear();
  const [turmas, setTurmas] = useState<{ id: string; nome: string }[]>([]);
  const [turmaSel, setTurmaSel] = useState('');
  const [dataIni, setDataIni] = useState(`${anoAtual}-01-01`);
  const [dataFim, setDataFim] = useState(new Date().toISOString().slice(0, 10));
  const [dados, setDados] = useState<Record<string, unknown> | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    api.get('/academico/turmas').then(r => setTurmas(r.data ?? [])).catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (turmaSel) params.set('turma_id', turmaSel);
      if (dataIni) params.set('data_ini', dataIni);
      if (dataFim) params.set('data_fim', dataFim);
      const { data } = await api.get(`/relatorios/academico/frequencia?${params}`);
      setDados(data);
    } catch {/* silencia */} finally { setCarregando(false); }
  }, [turmaSel, dataIni, dataFim]);

  const porAluno = Array.isArray((dados as any)?.por_aluno) ? (dados as any).por_aluno as any[] : [];

  const imprimirLista = () => {
    const turma = turmas.find(t => t.id === turmaSel)?.nome ?? 'Todas as Turmas';
    const linhas = porAluno.map(a =>
      `<tr><td>${escapeHtml(a.aluno_nome || '—')}</td><td style="text-align:center">${a.presencas ?? 0}</td><td style="text-align:center">${a.faltas ?? 0}</td><td style="text-align:center">${a.total ?? 0}</td><td style="text-align:center">${a.total > 0 ? ((Number(a.presencas) / Number(a.total)) * 100).toFixed(0) + '%' : '—'}</td></tr>`
    ).join('');
    const html = `<!DOCTYPE html><html><head><title>Frequência — ${escapeHtml(turma)}</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;padding:24px}h2{margin-bottom:4px}p{color:#666;font-size:11px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}th{background:#f0f0f0;font-weight:700;font-size:11px;text-transform:uppercase}</style></head>
    <body><h2>Frequência — ${escapeHtml(turma)}</h2><p>Período: ${escapeHtml(dataIni)} a ${escapeHtml(dataFim)} · Gerado em ${new Date().toLocaleString('pt-BR')}</p>
    <table><thead><tr><th>Aluno</th><th style="text-align:center">Presenças</th><th style="text-align:center">Faltas</th><th style="text-align:center">Total</th><th style="text-align:center">%</th></tr></thead>
    <tbody>${linhas}</tbody></table></body></html>`;
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); win.print(); }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex-wrap gap-3">
        <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
          <Users size={16} className="text-teal-600" /> Frequência por Turma
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={turmaSel} onChange={e => setTurmaSel(e.target.value)}
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-slate-800 dark:text-slate-100">
            <option value="">Todas as turmas</option>
            {turmas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          <input type="date" value={dataIni} onChange={e => setDataIni(e.target.value)}
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-slate-800 dark:text-slate-100" />
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-slate-800 dark:text-slate-100" />
          <button onClick={carregar} disabled={carregando}
            className="px-3 py-1.5 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg flex items-center gap-1 disabled:opacity-50">
            {carregando ? <RefreshCw size={12} className="animate-spin"/> : <Filter size={12}/>} Gerar
          </button>
          {porAluno.length > 0 && (
            <>
              <button onClick={() => exportarExcel(porAluno, 'frequencia_turma')}
                className="px-3 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
                <Download size={12}/> Excel
              </button>
              <button onClick={imprimirLista}
                className="px-3 py-1.5 text-xs font-bold border border-teal-200 text-teal-600 dark:border-teal-700 dark:text-teal-400 rounded-lg hover:bg-teal-50 flex items-center gap-1">
                <Printer size={12}/> Imprimir
              </button>
            </>
          )}
        </div>
      </div>
      {!dados && <EmptyRelatorio onClick={carregar} loading={carregando} />}
      {dados && (
        <div className="overflow-x-auto">
          {porAluno.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-10">Nenhum dado de frequência no período.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                <tr>
                  {['Aluno', 'Turma', 'Presenças', 'Faltas', 'Total', '%'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-black text-[10px] uppercase tracking-wider text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {porAluno.map((a: any, i: number) => {
                  const pct = a.total > 0 ? ((Number(a.presencas) / Number(a.total)) * 100).toFixed(0) : null;
                  return (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">{a.aluno_nome || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500">{a.turma_nome || '—'}</td>
                      <td className="px-4 py-2.5 font-mono font-black text-green-600">{a.presencas ?? 0}</td>
                      <td className="px-4 py-2.5 font-mono font-black text-red-500">{a.faltas ?? 0}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{a.total ?? 0}</td>
                      <td className="px-4 py-2.5">
                        {pct !== null && (
                          <span className={`font-black ${Number(pct) >= 75 ? 'text-green-600' : 'text-red-500'}`}>{pct}%</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   ABAS SOCIAL
═══════════════════════════════════════════════════════════ */

function AbaSocial() {
  const [impacto, setImpacto] = useState<Record<string, unknown> | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data } = await api.get('/relatorios/social/impacto');
      setImpacto(data);
    } catch {/* silencia */} finally { setCarregando(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Globe size={16} className="text-emerald-600" /> Impacto Social — ITP
          </h3>
          <AcoesRelatorio
            tipo="impacto_social"
            dados={impacto}
            onGerar={carregar}
            carregando={carregando}
            corGerar="bg-emerald-600 hover:bg-emerald-700"
            onExportar={() => impacto && exportarExcel([impacto as Record<string, unknown>], 'impacto_social')}
          />
        </div>
        {!impacto && <EmptyRelatorio onClick={carregar} loading={carregando} />}
        {impacto && (
          <div className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: 'Alunos Beneficiados', value: String(impacto.total_alunos_ativos), color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                { label: 'Famílias Impactadas', value: String(Math.ceil(Number(impacto.total_alunos_ativos) / 3.5)), color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                { label: 'Doadores Ativos', value: String(impacto.doadores_ativos), color: 'text-pink-600', bg: 'bg-pink-50 dark:bg-pink-900/20' },
                { label: 'Receita Total', value: moeda(Number(impacto.receita_total)), color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
                { label: 'Total Doado', value: moeda(Number(impacto.total_doacoes)), color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20' },
                { label: 'Itens em Estoque', value: String(impacto.itens_estoque), color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-900/20' },
              ].map(c => (
                <div key={c.label} className={`${c.bg} rounded-2xl p-5 text-center`}>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{c.label}</p>
                  <p className={`text-2xl font-black mt-2 ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   ABAS ESTOQUE
═══════════════════════════════════════════════════════════ */

function AbaEstoque() {
  const anoAtual = new Date().getFullYear();
  const mesAtual = String(new Date().getMonth() + 1).padStart(2, '0');
  const [posicao, setPosicao]   = useState<Record<string, unknown> | null>(null);
  const [movimentos, setMovimentos] = useState<Record<string, unknown> | null>(null);
  const [dataIni, setDataIni] = useState(`${anoAtual}-${mesAtual}-01`);
  const [dataFim, setDataFim] = useState(`${anoAtual}-${mesAtual}-31`);
  const [carregando, setCarregando] = useState<string | null>(null);
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroCritico, setFiltroCritico] = useState(false);
  const [buscaProduto, setBuscaProduto] = useState('');
  const [filtroTipoMov, setFiltroTipoMov] = useState('');

  const carregar = useCallback(async (tipo: string) => {
    setCarregando(tipo);
    try {
      if (tipo === 'posicao') {
        const { data } = await api.get('/relatorios/estoque/posicao');
        setPosicao(data);
      } else if (tipo === 'movimentos') {
        const { data } = await api.get(`/relatorios/estoque/movimentos?data_ini=${dataIni}&data_fim=${dataFim}`);
        setMovimentos(data);
      }
    } catch {/* silencia */} finally { setCarregando(null); }
  }, [dataIni, dataFim]);

  useEffect(() => {
    carregar('posicao'); carregar('movimentos');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* ── Posição Atual ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Package size={16} className="text-orange-500" /> Posição de Estoque
          </h3>
          <AcoesRelatorio
            tipo="estoque"
            dados={posicao}
            onGerar={() => carregar('posicao')}
            carregando={carregando === 'posicao'}
            corGerar="bg-orange-500 hover:bg-orange-600"
            onExportar={() => posicao && exportarExcel((posicao.produtos as unknown[]) as Record<string, unknown>[], 'estoque')}
          />
        </div>
        {!posicao && <EmptyRelatorio onClick={() => carregar('posicao')} loading={carregando === 'posicao'} />}
        {posicao && (() => {
          const todosProds = (posicao.produtos as Record<string, unknown>[]) || [];
          const categorias = [...new Set(todosProds.map(p => String(p.categoria)))].sort();
          const prodsFiltrados = todosProds.filter(p => {
            if (filtroCritico && !p.critico) return false;
            if (filtroCategoria && p.categoria !== filtroCategoria) return false;
            if (buscaProduto && !String(p.nome).toLowerCase().includes(buscaProduto.toLowerCase())) return false;
            return true;
          });
          const valorTotal = todosProds.reduce((acc, p) => acc + Number(p.valor_em_estoque || 0), 0);
          return (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Produtos</p>
                <p className="text-xl font-black text-orange-500 mt-1">{String(posicao.total_produtos)}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Críticos</p>
                <p className="text-xl font-black text-red-500 mt-1">{String(posicao.total_criticos)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Categorias</p>
                <p className="text-xl font-black text-slate-700 dark:text-slate-200 mt-1">{categorias.length}</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Valor em Estoque</p>
                <p className="text-base font-black text-emerald-600 mt-1">{valorTotal > 0 ? valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</p>
              </div>
            </div>
            {/* Filtros */}
            <div className="flex flex-wrap gap-2 items-center">
              <input value={buscaProduto} onChange={e => setBuscaProduto(e.target.value)} placeholder="Buscar produto..."
                className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-400 w-40" />
              <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)}
                className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-400">
                <option value="">Todas as categorias</option>
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                <input type="checkbox" checked={filtroCritico} onChange={e => setFiltroCritico(e.target.checked)} className="accent-red-500 w-3.5 h-3.5" />
                Apenas críticos
              </label>
              <span className="text-[10px] text-slate-400">{prodsFiltrados.length} de {todosProds.length} itens</span>
            </div>
            {prodsFiltrados.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800">
                      <th className="px-3 py-2 text-left font-black text-slate-500 uppercase tracking-wider">Produto</th>
                      <th className="px-3 py-2 text-left font-black text-slate-500 uppercase tracking-wider">Categoria</th>
                      <th className="px-3 py-2 text-right font-black text-slate-500 uppercase tracking-wider">Qtd</th>
                      <th className="px-3 py-2 text-right font-black text-slate-500 uppercase tracking-wider">Mínimo</th>
                      <th className="px-3 py-2 text-right font-black text-slate-500 uppercase tracking-wider">Custo Unit.</th>
                      <th className="px-3 py-2 text-right font-black text-slate-500 uppercase tracking-wider">Valor Estoque</th>
                      <th className="px-3 py-2 text-center font-black text-slate-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {prodsFiltrados.map((p, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-medium">{String(p.nome)}</td>
                        <td className="px-3 py-2 text-slate-500">{String(p.categoria)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{String(p.quantidade_atual)} {String(p.unidade_medida)}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{Number(p.estoque_minimo) > 0 ? String(p.estoque_minimo) : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-600">{p.valor_compra != null ? Number(p.valor_compra).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono font-black text-slate-700 dark:text-slate-200">{Number(p.valor_em_estoque) > 0 ? Number(p.valor_em_estoque).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td>
                        <td className="px-3 py-2 text-center">
                          {p.critico ? (
                            <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-black uppercase">Crítico</span>
                          ) : (
                            <span className="px-2 py-0.5 bg-green-100 text-green-600 rounded-full text-[10px] font-black uppercase">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          );
        })()}
      </div>

      {/* ── Movimentos ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Package size={16} className="text-slate-500" /> Movimentos de Estoque
          </h3>
          <div className="flex flex-wrap gap-2 items-end">
            <input type="date" value={dataIni} onChange={e => setDataIni(e.target.value)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-800 dark:text-slate-100" />
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-800 dark:text-slate-100" />
            <AcoesRelatorio
              tipo="estoque"
              params={{ data_ini: dataIni, data_fim: dataFim }}
              dados={movimentos}
              onGerar={() => carregar('movimentos')}
              carregando={carregando === 'movimentos'}
              corGerar="bg-slate-600 hover:bg-slate-700"
              onExportar={() => movimentos && exportarExcel((movimentos.movimentos as unknown[]) as Record<string, unknown>[], 'movimentos_estoque')}
            />
          </div>
        </div>
        {!movimentos && <EmptyRelatorio onClick={() => carregar('movimentos')} loading={carregando === 'movimentos'} />}
        {movimentos && Array.isArray(movimentos.movimentos) && (() => {
          const movsFiltrados = (movimentos.movimentos as Record<string, unknown>[])
            .filter(m => !filtroTipoMov || m.tipo === filtroTipoMov);
          const resumo = movimentos.resumo as Record<string, unknown> | undefined;
          return (
          <div className="p-4 space-y-3">
            {/* KPIs movimentos */}
            {resumo && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase">Entradas</p>
                  <p className="text-lg font-black text-green-600">{String(resumo.qtdEntradas ?? 0)}</p>
                  <p className="text-[9px] text-slate-400">registros</p>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-3 text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase">Baixas</p>
                  <p className="text-lg font-black text-orange-500">{String(resumo.qtdBaixas ?? 0)}</p>
                  <p className="text-[9px] text-slate-400">registros</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase">Qtd Entradas</p>
                  <p className="text-lg font-black text-slate-700 dark:text-slate-200">{Number(resumo.totalEntradas ?? 0).toLocaleString('pt-BR')}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase">Qtd Baixas</p>
                  <p className="text-lg font-black text-slate-700 dark:text-slate-200">{Number(resumo.totalBaixas ?? 0).toLocaleString('pt-BR')}</p>
                </div>
              </div>
            )}
            {/* Filtro tipo */}
            <div className="flex gap-2 items-center">
              <select value={filtroTipoMov} onChange={e => setFiltroTipoMov(e.target.value)}
                className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="">Todos os tipos</option>
                <option value="entrada">Entradas</option>
                <option value="baixa">Baixas</option>
              </select>
              <span className="text-[10px] text-slate-400">{movsFiltrados.length} registro{movsFiltrados.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-3 py-2 text-left font-black text-slate-500 uppercase tracking-wider">Produto</th>
                    <th className="px-3 py-2 text-left font-black text-slate-500 uppercase tracking-wider">Categoria</th>
                    <th className="px-3 py-2 text-center font-black text-slate-500 uppercase tracking-wider">Tipo</th>
                    <th className="px-3 py-2 text-right font-black text-slate-500 uppercase tracking-wider">Qtd</th>
                    <th className="px-3 py-2 text-left font-black text-slate-500 uppercase tracking-wider">Observação</th>
                    <th className="px-3 py-2 text-left font-black text-slate-500 uppercase tracking-wider">Usuário</th>
                    <th className="px-3 py-2 text-left font-black text-slate-500 uppercase tracking-wider">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {movsFiltrados.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-slate-400">Nenhum movimento no período.</td></tr>
                  ) : movsFiltrados.map((m, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-medium">{String(m.nome ?? m.produto_id)}</td>
                      <td className="px-3 py-2 text-slate-500">{String(m.categoria ?? '—')}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          m.tipo === 'entrada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                        }`}>{m.tipo === 'entrada' ? '▲ Entrada' : '▼ Baixa'}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">{String(m.quantidade)} {String(m.unidade_medida ?? '')}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-[160px] truncate">{String(m.observacao ?? '—')}</td>
                      <td className="px-3 py-2 text-slate-500">{String(m.usuario_nome ?? '—')}</td>
                      <td className="px-3 py-2 text-slate-500">{new Date(String(m.data_movimento)).toLocaleDateString('pt-BR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   DRE — Demonstração de Resultado do Exercício
═══════════════════════════════════════════════════════════ */

interface DreLinha { conta: string; valor: number }
interface DreGrupoDespesa { grupo: string; itens: DreLinha[]; subtotal: number }
interface DreDado {
  periodo: { ano: number; mes_ini: number; mes_fim: number };
  receitasBrutas: DreLinha[];
  totalReceitasBrutas: number;
  deducoes: DreLinha[];
  totalDeducoes: number;
  receitaLiquida: number;
  gruposDespesas: DreGrupoDespesa[];
  totalDespesas: number;
  resultadoOperacional: number;
  resultadoFinanceiro: number;
  resultadoExercicio: number;
  margem: string;
  evolucaoMensal: { mes: number; receita: number; despesa: number; resultado: number }[];
}

const MESES_PT = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function LinhaDRE({ descricao, valor, nivel = 1, negrito = false, destaque = false, inverter = false, ocultar = false }: {
  descricao: string; valor: number; nivel?: number;
  negrito?: boolean; destaque?: boolean; inverter?: boolean; ocultar?: boolean;
}) {
  if (ocultar) return null;
  const cor = destaque
    ? valor >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
    : inverter
      ? 'text-red-500 dark:text-red-400'
      : 'text-slate-700 dark:text-slate-300';
  return (
    <tr className={`border-b border-slate-100 dark:border-slate-800 ${
      destaque ? 'bg-slate-50 dark:bg-slate-800/60' : ''
    }`}>
      <td className={`py-2 ${nivel === 1 ? 'pl-4' : nivel === 2 ? 'pl-8' : 'pl-12'} text-xs ${
        negrito ? 'font-black text-slate-800 dark:text-slate-100 uppercase tracking-wide' : 'text-slate-600 dark:text-slate-400'
      }`}>{descricao}</td>
      <td className={`py-2 pr-4 text-right text-xs font-bold ${cor}`}>
        {moeda(valor)}
      </td>
    </tr>
  );
}

interface DreSecao {
  id: string;
  label: string;
  nivel: '1' | '2' | '3';
  oculto?: boolean;
}

const SECOES_PADRAO: DreSecao[] = [
  { id: 'receitas_detalhe', label: 'Detalhes das Receitas', nivel: '2' },
  { id: 'deducoes',         label: 'Deduções de Receitas',  nivel: '2' },
  { id: 'despesas_grupos',  label: 'Grupos de Despesas',    nivel: '1' },
  { id: 'despesas_detalhe', label: 'Detalhes das Despesas', nivel: '3' },
  { id: 'resultado_fin',    label: 'Resultado Financeiro',  nivel: '2' },
  { id: 'grafico',          label: 'Gráfico de Evolução',   nivel: '3' },
];

const COR_NIVEL = {
  '1': {
    area:    'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',
    card:    'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700',
    badge:   'bg-blue-600',
    titulo:  'text-blue-700 dark:text-blue-300',
    dragover:'bg-blue-100 dark:bg-blue-900/60 border-blue-500',
    btn:     'border-blue-400 text-blue-700 dark:text-blue-300',
  },
  '2': {
    area:    'bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800',
    card:    'bg-violet-100 dark:bg-violet-900/40 border-violet-300 dark:border-violet-700',
    badge:   'bg-violet-600',
    titulo:  'text-violet-700 dark:text-violet-300',
    dragover:'bg-violet-100 dark:bg-violet-900/60 border-violet-500',
    btn:     'border-violet-400 text-violet-700 dark:text-violet-300',
  },
  '3': {
    area:    'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',
    card:    'bg-rose-100 dark:bg-rose-900/40 border-rose-300 dark:border-rose-700',
    badge:   'bg-rose-600',
    titulo:  'text-rose-700 dark:text-rose-300',
    dragover:'bg-rose-100 dark:bg-rose-900/60 border-rose-500',
    btn:     'border-rose-400 text-rose-700 dark:text-rose-300',
  },
} as const;

function DreBtnEmail({ ano, mesIni, mesFim }: { ano: string; mesIni: string; mesFim: string }) {
  const [show, setShow] = React.useState(false);
  return (
    <>
      <button onClick={() => setShow(true)}
        className="px-3 py-2 text-xs font-black border border-purple-200 text-purple-600 dark:border-purple-700 dark:text-purple-400 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 flex items-center gap-1.5">
        <Mail size={13} /> E-mail
      </button>
      {show && <ModalEmail tipo="dre" params={{ ano, mes_ini: mesIni, mes_fim: mesFim }} onClose={() => setShow(false)} />}
    </>
  );
}

function AbaDRE() {
  const anoAtual = new Date().getFullYear();
  const dreRef        = React.useRef<HTMLDivElement>(null);
  const dragId        = React.useRef<string | null>(null);
  const dropCardId    = React.useRef<string | null>(null);
  const [dre, setDre]               = useState<DreDado | null>(null);
  const [ano, setAno]               = useState(String(anoAtual));
  const [mesIni, setMesIni]         = useState('1');
  const [mesFim, setMesFim]         = useState('12');
  const [carregando, setCarregando] = useState(false);
  const [exportando, setExportando] = useState<'pdf' | 'png' | null>(null);
  const [secoes, setSecoes]         = useState<DreSecao[]>(SECOES_PADRAO);
  const [nivelAtivo, setNivelAtivo] = useState<'1' | '2' | '3'>('2');
  const [dropAlvo, setDropAlvo]     = useState<'1' | '2' | '3' | null>(null);

  /** Retorna true se a seção deve aparecer no nível de exibição ativo e não está oculta */
  const sv = (id: string) => {
    const s = secoes.find(s => s.id === id);
    return s ? !s.oculto && Number(s.nivel) <= Number(nivelAtivo) : false;
  };

  const toggleOculto = (id: string) =>
    setSecoes(prev => prev.map(s => s.id === id ? { ...s, oculto: !s.oculto } : s));

  /** Move / reordena: se targetId definido, insere antes; senão, appenda ao final do nível */
  const reordenarOuMover = (draggedId: string, targetId: string | null, targetNivel: '1' | '2' | '3') => {
    setSecoes(prev => {
      const arr = [...prev];
      const di = arr.findIndex(s => s.id === draggedId);
      if (di === -1) return prev;
      const dragged = { ...arr[di], nivel: targetNivel };
      arr.splice(di, 1);
      if (targetId) {
        const ti = arr.findIndex(s => s.id === targetId);
        arr.splice(ti >= 0 ? ti : arr.length, 0, dragged);
      } else {
        arr.push(dragged);
      }
      return arr;
    });
  };

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data } = await api.get<DreDado>(`/relatorios/financeiro/dre?ano=${ano}&mes_ini=${mesIni}&mes_fim=${mesFim}`);
      setDre(data);
    } catch {/* silencia */} finally { setCarregando(false); }
  }, [ano, mesIni, mesFim]);

  const exportarXlsx = () => {
    if (!dre) return;
    const instituicao = 'Instituto Tia Pretinha';
    const periodo = `${MESES_PT[dre.periodo.mes_ini]}/${dre.periodo.ano} a ${MESES_PT[dre.periodo.mes_fim]}/${dre.periodo.ano}`;
    const linhas: Record<string, unknown>[] = [
      { 'Descrição': instituicao, 'Valor (R$)': '' },
      { 'Descrição': `DRE — ${periodo}`, 'Valor (R$)': '' },
      { 'Descrição': '', 'Valor (R$)': '' },
      { 'Descrição': '1. RECEITAS OPERACIONAIS', 'Valor (R$)': '' },
      ...dre.receitasBrutas.map(r => ({ 'Descrição': `   ${r.conta}`, 'Valor (R$)': r.valor })),
      { 'Descrição': 'TOTAL RECEITAS BRUTAS', 'Valor (R$)': dre.totalReceitasBrutas },
    ];
    if (dre.deducoes.length > 0) {
      linhas.push({ 'Descrição': '(-) DEDUÇÕES DE RECEITAS', 'Valor (R$)': '' });
      dre.deducoes.forEach(d => linhas.push({ 'Descrição': `   ${d.conta}`, 'Valor (R$)': -d.valor }));
      linhas.push({ 'Descrição': 'TOTAL DEDUÇÕES', 'Valor (R$)': -dre.totalDeducoes });
    }
    linhas.push({ 'Descrição': '= RECEITA LÍQUIDA', 'Valor (R$)': dre.receitaLiquida });
    linhas.push({ 'Descrição': '', 'Valor (R$)': '' });
    linhas.push({ 'Descrição': '2. DESPESAS', 'Valor (R$)': '' });
    dre.gruposDespesas.forEach(g => {
      linhas.push({ 'Descrição': `   ${g.grupo}`, 'Valor (R$)': '' });
      g.itens.forEach(i => linhas.push({ 'Descrição': `      ${i.conta}`, 'Valor (R$)': -i.valor }));
      linhas.push({ 'Descrição': `   Subtotal ${g.grupo}`, 'Valor (R$)': -g.subtotal });
    });
    linhas.push({ 'Descrição': 'TOTAL DESPESAS', 'Valor (R$)': -dre.totalDespesas });
    linhas.push({ 'Descrição': '', 'Valor (R$)': '' });
    linhas.push({ 'Descrição': '= RESULTADO OPERACIONAL', 'Valor (R$)': dre.resultadoOperacional });
    if (dre.resultadoFinanceiro !== 0)
      linhas.push({ 'Descrição': '± Resultado Financeiro', 'Valor (R$)': dre.resultadoFinanceiro });
    linhas.push({ 'Descrição': '= RESULTADO DO EXERCÍCIO', 'Valor (R$)': dre.resultadoExercicio });
    linhas.push({ 'Descrição': 'Margem (%)', 'Valor (R$)': `${dre.margem}%` });

    import('xlsx').then(mod => {
      const XLSX = (mod.default ?? mod) as typeof import('xlsx');
      const ws = XLSX.utils.json_to_sheet(linhas);
      ws['!cols'] = [{ wch: 50 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'DRE');
      XLSX.writeFile(wb, `DRE_${ano}_${MESES_PT[Number(mesIni)]}-${MESES_PT[Number(mesFim)]}.xlsx`);
    });
  };

  const exportarImagem = async (formato: 'pdf' | 'png') => {
    if (!dreRef.current) return;
    setExportando(formato);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(dreRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      if (formato === 'png') {
        const link = document.createElement('a');
        link.download = `DRE_${ano}_${MESES_PT[Number(mesIni)]}-${MESES_PT[Number(mesFim)]}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      } else {
        const { jsPDF } = await import('jspdf');
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save(`DRE_${ano}_${MESES_PT[Number(mesIni)]}-${MESES_PT[Number(mesFim)]}.pdf`);
      }
    } catch {/* silencia */} finally { setExportando(null); }
  };

  return (
    <div className="space-y-6">
      {/* ── Filtros de período ─────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Ano</label>
            <input type="number" value={ano} onChange={e => setAno(e.target.value)} min="2020" max="2099"
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm w-24 bg-white dark:bg-slate-800 dark:text-slate-100" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Mês Inicial</label>
            <select value={mesIni} onChange={e => setMesIni(e.target.value)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-800 dark:text-slate-100">
              {MESES_PT.slice(1).map((m,i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Mês Final</label>
            <select value={mesFim} onChange={e => setMesFim(e.target.value)}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-800 dark:text-slate-100">
              {MESES_PT.slice(1).map((m,i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
            </select>
          </div>
          <button onClick={carregar} disabled={carregando}
            className="px-4 py-2 text-xs font-black bg-purple-600 text-white rounded-xl hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50">
            {carregando ? <RefreshCw size={13} className="animate-spin" /> : <Filter size={13} />} Gerar DRE
          </button>
          {dre && (
            <>
              <button onClick={exportarXlsx}
                className="px-3 py-2 text-xs font-black border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5">
                <Download size={13} /> Excel
              </button>
              <button onClick={() => exportarImagem('pdf')} disabled={exportando === 'pdf'}
                className="px-3 py-2 text-xs font-black border border-red-200 text-red-600 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1.5 disabled:opacity-50">
                {exportando === 'pdf' ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />} PDF
              </button>
              <button onClick={() => exportarImagem('png')} disabled={exportando === 'png'}
                className="px-3 py-2 text-xs font-black border border-blue-200 text-blue-600 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-1.5 disabled:opacity-50">
                {exportando === 'png' ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />} PNG
              </button>
              <DreBtnEmail ano={ano} mesIni={mesIni} mesFim={mesFim} />
            </>
          )}
        </div>
        {/* ── Painel de Níveis com Drag & Drop ─────────────────────────── */}
        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Exibir até:</span>
            {(['1','2','3'] as const).map(n => (
              <button key={n} onClick={() => setNivelAtivo(n)}
                className={`px-3 py-1.5 rounded-xl text-xs font-black border-2 transition-all ${
                  nivelAtivo === n
                    ? `${COR_NIVEL[n].badge} text-white border-transparent shadow`
                    : `bg-white dark:bg-slate-800 ${COR_NIVEL[n].btn}`
                }`}>
                Nível {n}
              </button>
            ))}
            <span className="text-[10px] text-slate-400 dark:text-slate-600 italic ml-auto hidden sm:inline">
              ← Arraste os labels para reorganizar os níveis
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['1','2','3'] as const).map(n => {
              const c = COR_NIVEL[n];
              const secoesDoNivel = secoes.filter(s => s.nivel === n);
              const isDragOver = dropAlvo === n;
              return (
                <div key={n}
                  className={`rounded-xl border-2 border-dashed p-3 min-h-[110px] transition-all duration-150 ${
                    isDragOver ? c.dragover : c.area
                  }`}
                  onDragOver={e => { e.preventDefault(); setDropAlvo(n); }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAlvo(null); }}
                  onDrop={e => {
                    e.preventDefault(); setDropAlvo(null);
                    if (dragId.current) reordenarOuMover(dragId.current, dropCardId.current, n);
                    dropCardId.current = null;
                  }}>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-1.5 ${c.titulo}`}>
                    Nível {n}
                    {nivelAtivo === n && <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${c.badge} text-white font-black`}>ativo</span>}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {secoesDoNivel.map(s => (
                      <div key={s.id}
                        draggable
                        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; dragId.current = s.id; }}
                        onDragEnd={() => { dragId.current = null; dropCardId.current = null; setDropAlvo(null); }}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); dropCardId.current = s.id; }}
                        onDrop={e => {
                          e.preventDefault(); e.stopPropagation();
                          setDropAlvo(null);
                          if (dragId.current && dragId.current !== s.id)
                            reordenarOuMover(dragId.current, s.id, n);
                        }}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
                          s.oculto
                            ? 'opacity-40 ' + c.card
                            : c.card
                        } cursor-grab active:cursor-grabbing select-none text-[11px] font-bold text-slate-700 dark:text-slate-200 shadow-sm`}>
                        <span className="text-slate-400 dark:text-slate-500 text-sm leading-none flex-shrink-0">⠿</span>
                        <span className="flex-1 truncate">{s.label}</span>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); toggleOculto(s.id); }}
                          title={s.oculto ? 'Mostrar no DRE' : 'Ocultar no DRE'}
                          className="flex-shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                          {s.oculto ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                    ))}
                    {secoesDoNivel.length === 0 && (
                      <p className="text-[10px] text-slate-300 dark:text-slate-600 text-center pt-3">Solte aqui</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {dre && (
        <div ref={dreRef} className="space-y-6 bg-white dark:bg-slate-950 p-1 rounded-2xl">
          {/* Cabeçalho do relatório (aparece no PDF/PNG) */}
          <div className="flex items-center gap-4 px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="ITP" className="h-14 w-14 rounded-full object-cover border-2 border-purple-200" />
            <div>
              <p className="text-lg font-black text-purple-900 dark:text-purple-200 uppercase tracking-tight leading-none">Instituto Tia Pretinha</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Demonstrativo do Resultado do Exercício</p>
            </div>
          </div>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Receita Bruta',    valor: dre.totalReceitasBrutas, cor: 'text-blue-600' },
              { label: 'Receita Líquida',  valor: dre.receitaLiquida,     cor: 'text-green-600' },
              { label: 'Total Despesas',   valor: dre.totalDespesas,      cor: 'text-red-500' },
              { label: 'Resultado Final',  valor: dre.resultadoExercicio,  cor: dre.resultadoExercicio >= 0 ? 'text-emerald-600' : 'text-red-500' },
            ].map(k => (
              <div key={k.label} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-center shadow-sm">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{k.label}</p>
                <p className={`text-lg font-black mt-1 ${k.cor}`}>{moeda(k.valor)}</p>
              </div>
            ))}
          </div>

          {/* DRE Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200">
                DRE — {MESES_PT[dre.periodo.mes_ini]}/{dre.periodo.ano} a {MESES_PT[dre.periodo.mes_fim]}/{dre.periodo.ano}
              </h3>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full text-white ${COR_NIVEL[nivelAtivo].badge}`}>
                Nível {nivelAtivo}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">Descrição</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-black text-slate-500 uppercase tracking-wider">Valor (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Receitas */}
                  <LinhaDRE descricao="1. RECEITAS OPERACIONAIS" valor={dre.totalReceitasBrutas} nivel={1} negrito />
                  {sv('receitas_detalhe') && dre.receitasBrutas.map((r,i) => (
                    <LinhaDRE key={i} descricao={r.conta} valor={r.valor} nivel={2} />
                  ))}
                  {sv('receitas_detalhe') && (
                    <LinhaDRE descricao="TOTAL RECEITAS BRUTAS" valor={dre.totalReceitasBrutas} nivel={1} negrito />
                  )}

                  {/* Deduções */}
                  {sv('deducoes') && dre.deducoes.length > 0 && (
                    <>
                      <LinhaDRE descricao="(-) DEDUÇÕES DE RECEITAS" valor={0} nivel={1} negrito />
                      {dre.deducoes.map((d,i) => (
                        <LinhaDRE key={i} descricao={d.conta} valor={-d.valor} nivel={2} inverter />
                      ))}
                      <LinhaDRE descricao="TOTAL DEDUÇÕES" valor={-dre.totalDeducoes} nivel={1} negrito inverter />
                    </>
                  )}

                  <LinhaDRE descricao="= RECEITA LÍQUIDA" valor={dre.receitaLiquida} nivel={1} negrito destaque />

                  {/* Despesas */}
                  <LinhaDRE descricao="2. DESPESAS" valor={dre.totalDespesas} nivel={1} negrito />
                  {sv('despesas_grupos') && dre.gruposDespesas.map((g, gi) => (
                    <React.Fragment key={gi}>
                      <LinhaDRE descricao={g.grupo} valor={0} nivel={2} negrito />
                      {sv('despesas_detalhe') && g.itens.map((it, ii) => (
                        <LinhaDRE key={ii} descricao={it.conta} valor={-it.valor} nivel={3} inverter />
                      ))}
                      <LinhaDRE descricao={`Subtotal ${g.grupo}`} valor={-g.subtotal} nivel={2} negrito inverter />
                    </React.Fragment>
                  ))}
                  <LinhaDRE descricao="TOTAL DESPESAS" valor={-dre.totalDespesas} nivel={1} negrito inverter />

                  {/* Resultados */}
                  <LinhaDRE descricao="= RESULTADO OPERACIONAL" valor={dre.resultadoOperacional} nivel={1} negrito destaque />

                  {sv('resultado_fin') && dre.resultadoFinanceiro !== 0 && (
                    <LinhaDRE descricao="± Resultado Financeiro" valor={dre.resultadoFinanceiro} nivel={2} />
                  )}

                  <LinhaDRE descricao="= RESULTADO DO EXERCÍCIO" valor={dre.resultadoExercicio} nivel={1} negrito destaque />
                  <tr className="bg-purple-50 dark:bg-purple-900/20">
                    <td className="py-2 pl-4 text-xs font-black text-purple-700 dark:text-purple-300 uppercase tracking-wide">Margem (%)</td>
                    <td className="py-2 pr-4 text-right text-xs font-black text-purple-700 dark:text-purple-300">{dre.margem}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Gráfico evolução */}
          {sv('grafico') && dre.evolucaoMensal.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200">Evolução Mensal do Resultado</h3>
              </div>
              <div className="p-5">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={dre.evolucaoMensal.map(m => ({ ...m, mes: MESES_PT[m.mes] }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => moeda(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="receita" name="Receita" stroke="#7c3aed" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="despesa" name="Despesa" stroke="#f87171" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="resultado" name="Resultado" stroke="#10b981" strokeWidth={2.5} strokeDasharray="5 5" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   ONG — Relatórios do Terceiro Setor
═══════════════════════════════════════════════════════════ */

function AbaONG() {
  const anoAtual = new Date().getFullYear();
  const [dataIni, setDataIni] = useState(`${anoAtual}-01-01`);
  const [dataFim, setDataFim] = useState(`${anoAtual}-12-31`);
  const [ano, setAno] = useState(String(anoAtual));

  const [sustentabilidade, setSustentabilidade] = useState<Record<string, unknown> | null>(null);
  const [origRecursos, setOrigRecursos] = useState<Record<string, unknown> | null>(null);
  const [diversificacao, setDiversificacao] = useState<Record<string, unknown> | null>(null);
  const [despCat, setDespCat] = useState<Record<string, unknown> | null>(null);
  const [custoBenef, setCustoBenef] = useState<Record<string, unknown> | null>(null);
  const [anual, setAnual] = useState<Record<string, unknown> | null>(null);
  const [carregando, setCarregando] = useState<string | null>(null);

  const carregar = useCallback(async (tipo: string) => {
    setCarregando(tipo);
    try {
      if (tipo === 'sustentabilidade') {
        const { data } = await api.get('/relatorios/financeiro/sustentabilidade');
        setSustentabilidade(data);
      } else if (tipo === 'origem') {
        const { data } = await api.get(`/relatorios/financeiro/origem-recursos?data_ini=${dataIni}&data_fim=${dataFim}`);
        setOrigRecursos(data);
      } else if (tipo === 'diversificacao') {
        const { data } = await api.get(`/relatorios/financeiro/diversificacao-receitas?data_ini=${dataIni}&data_fim=${dataFim}`);
        setDiversificacao(data);
      } else if (tipo === 'despcat') {
        const { data } = await api.get(`/relatorios/financeiro/despesas-categoria?data_ini=${dataIni}&data_fim=${dataFim}`);
        setDespCat(data);
      } else if (tipo === 'custo') {
        const { data } = await api.get(`/relatorios/social/custo-beneficiario?data_ini=${dataIni}&data_fim=${dataFim}`);
        setCustoBenef(data);
      } else if (tipo === 'anual') {
        const { data } = await api.get(`/relatorios/financeiro/anual?ano=${ano}`);
        setAnual(data);
      }
    } catch { /* silencia */ } finally { setCarregando(null); }
  }, [dataIni, dataFim, ano]);

  useEffect(() => {
    carregar('sustentabilidade'); carregar('origem'); carregar('diversificacao');
    carregar('despcat'); carregar('custo'); carregar('anual');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">De</label>
          <input type="date" value={dataIni} onChange={e => setDataIni(e.target.value)}
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Até</label>
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Ano</label>
          <input type="number" value={ano} onChange={e => setAno(e.target.value)} min="2020" max="2099"
            className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm w-24 bg-white dark:bg-slate-800 dark:text-slate-100" />
        </div>
      </div>

      {/* Sustentabilidade Financeira */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Leaf size={16} className="text-green-600" /> Sustentabilidade Financeira
          </h3>
          <AcoesRelatorio
            tipo="sustentabilidade_financeira"
            dados={sustentabilidade}
            onGerar={() => carregar('sustentabilidade')}
            carregando={carregando === 'sustentabilidade'}
            corGerar="bg-green-600 hover:bg-green-700"
            labelGerar="Calcular"
          />
        </div>
        {!sustentabilidade && <EmptyRelatorio onClick={() => carregar('sustentabilidade')} loading={carregando === 'sustentabilidade'} />}
        {sustentabilidade && (
          <div className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Saldo Atual', value: moeda(Number(sustentabilidade.saldo_atual)), color: 'text-green-600' },
                { label: 'Média Mensal Desp.', value: moeda(Number(sustentabilidade.media_desp_mensal)), color: 'text-red-500' },
                { label: 'Meses de Operação', value: String(sustentabilidade.meses_operacao), color: sustentabilidade.cor === 'green' ? 'text-green-600' : sustentabilidade.cor === 'yellow' ? 'text-yellow-500' : 'text-red-500' },
                { label: 'Situação', value: String(sustentabilidade.nivel), color: sustentabilidade.cor === 'green' ? 'text-green-600' : sustentabilidade.cor === 'yellow' ? 'text-yellow-500' : 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{k.label}</p>
                  <p className={`text-lg font-black mt-1 ${k.color}`}>{k.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Origem de Recursos */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <DollarSign size={16} className="text-blue-600" /> Origem de Recursos
          </h3>
          <AcoesRelatorio
            tipo="origem_recursos"
            params={{ data_ini: dataIni, data_fim: dataFim }}
            dados={origRecursos}
            onGerar={() => carregar('origem')}
            carregando={carregando === 'origem'}
            corGerar="bg-blue-600 hover:bg-blue-700"
            onExportar={() => origRecursos && exportarExcel((origRecursos.fontes as Record<string, unknown>[]), 'origem_recursos')}
          />
        </div>
        {!origRecursos && <EmptyRelatorio onClick={() => carregar('origem')} loading={carregando === 'origem'} />}
        {origRecursos && Array.isArray(origRecursos.fontes) && (
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={origRecursos.fontes as Record<string, unknown>[]} dataKey="total" nameKey="fonte"
                  cx="50%" cy="50%" outerRadius={90}
                  label={({ name, value }: { name: string; value: number }) => `${name}: ${moeda(value)}`}>
                  {(origRecursos.fontes as unknown[]).map((_, i) => <Cell key={i} fill={CORES_PIZZA[i % CORES_PIZZA.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => moeda(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {(origRecursos.fontes as Record<string, unknown>[]).map((f, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{String(f.fonte)}</span>
                  <div className="text-right">
                    <p className="text-xs font-black" style={{ color: CORES_PIZZA[i % CORES_PIZZA.length] }}>{moeda(Number(f.total))}</p>
                    <p className="text-[10px] text-slate-400">{String(f.percentual)}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Diversificação de Receitas */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <BarChart2 size={16} className="text-indigo-600" /> Diversificação de Receitas
          </h3>
          <AcoesRelatorio
            tipo="diversificacao_receitas"
            params={{ data_ini: dataIni, data_fim: dataFim }}
            dados={diversificacao}
            onGerar={() => carregar('diversificacao')}
            carregando={carregando === 'diversificacao'}
            corGerar="bg-indigo-600 hover:bg-indigo-700"
          />
        </div>
        {!diversificacao && <EmptyRelatorio onClick={() => carregar('diversificacao')} loading={carregando === 'diversificacao'} />}
        {diversificacao && (
          <div className="p-5 space-y-3">
            <div className="flex gap-4">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Índice HHI</p>
                <p className="text-lg font-black text-indigo-600">{String(diversificacao.hhi)}</p>
              </div>
              <div className={`rounded-xl px-4 py-3 text-center ${diversificacao.nivel_diversificacao === 'Diversificado' ? 'bg-green-50 dark:bg-green-900/20' : diversificacao.nivel_diversificacao === 'Moderado' ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Nível</p>
                <p className={`text-lg font-black ${diversificacao.nivel_diversificacao === 'Diversificado' ? 'text-green-600' : diversificacao.nivel_diversificacao === 'Moderado' ? 'text-yellow-600' : 'text-red-500'}`}>
                  {String(diversificacao.nivel_diversificacao)}
                </p>
              </div>
            </div>
            {Array.isArray(diversificacao.fontes) && (
              <div className="space-y-1.5">
                {(diversificacao.fontes as Record<string, unknown>[]).map((f, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-slate-600 dark:text-slate-400 w-36 truncate">{String(f.fonte)}</span>
                    <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                      <div className="h-2 rounded-full" style={{ width: `${f.percentual}%`, backgroundColor: CORES_PIZZA[i % CORES_PIZZA.length] }} />
                    </div>
                    <span className="text-xs font-black text-slate-700 dark:text-slate-300 w-10 text-right">{String(f.percentual)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Despesas por Categoria */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Package size={16} className="text-orange-500" /> Despesas por Categoria / Plano de Contas
          </h3>
          <AcoesRelatorio
            tipo="despesas_categoria"
            params={{ data_ini: dataIni, data_fim: dataFim }}
            dados={despCat}
            onGerar={() => carregar('despcat')}
            carregando={carregando === 'despcat'}
            corGerar="bg-orange-500 hover:bg-orange-600"
            onExportar={() => despCat && exportarExcel((despCat.categorias as Record<string, unknown>[]), 'despesas_categoria')}
          />
        </div>
        {!despCat && <EmptyRelatorio onClick={() => carregar('despcat')} loading={carregando === 'despcat'} />}
        {despCat && Array.isArray(despCat.categorias) && (
          <div className="p-5">
            <p className="text-xs text-slate-500 mb-3">Total: <span className="font-black text-red-500">{moeda(Number(despCat.total_despesas))}</span></p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-3 py-2 text-left font-black text-slate-500 uppercase tracking-wider">Categoria</th>
                    <th className="px-3 py-2 text-right font-black text-slate-500 uppercase tracking-wider">Total</th>
                    <th className="px-3 py-2 text-right font-black text-slate-500 uppercase tracking-wider">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(despCat.categorias as Record<string, unknown>[]).map((c, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{String(c.categoria)}</td>
                      <td className="px-3 py-2 text-right text-red-500 font-bold">{moeda(Number(c.total))}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{String(c.percentual)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Custo por Beneficiário */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <HandHeart size={16} className="text-pink-600" /> Custo por Beneficiário
          </h3>
          <AcoesRelatorio
            tipo="custo_beneficiario"
            params={{ data_ini: dataIni, data_fim: dataFim }}
            dados={custoBenef}
            onGerar={() => carregar('custo')}
            carregando={carregando === 'custo'}
            corGerar="bg-pink-600 hover:bg-pink-700"
            labelGerar="Calcular"
            onExportar={() => custoBenef && exportarExcel((custoBenef.por_projeto as Record<string, unknown>[]), 'custo_beneficiario')}
          />
        </div>
        {!custoBenef && <EmptyRelatorio onClick={() => carregar('custo')} loading={carregando === 'custo'} />}
        {custoBenef && (
          <div className="p-5">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Investido', value: moeda(Number(custoBenef.total_investido)), color: 'text-red-500' },
                { label: 'Beneficiários', value: String(custoBenef.total_beneficiarios), color: 'text-blue-600' },
                { label: 'Custo Médio', value: moeda(Number(custoBenef.custo_medio)), color: 'text-purple-600' },
              ].map(k => (
                <div key={k.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{k.label}</p>
                  <p className={`text-base font-black mt-1 ${k.color}`}>{k.value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Relatório Financeiro Anual */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <TrendingUp size={16} className="text-emerald-600" /> Relatório Financeiro Anual
          </h3>
          <AcoesRelatorio
            tipo="relatorio_anual"
            params={{ ano }}
            dados={anual}
            onGerar={() => carregar('anual')}
            carregando={carregando === 'anual'}
            corGerar="bg-emerald-600 hover:bg-emerald-700"
            onExportar={() => anual && exportarExcel((anual.meses as Record<string, unknown>[]), `relatorio_anual_${ano}`)}
          />
        </div>
        {!anual && <EmptyRelatorio onClick={() => carregar('anual')} loading={carregando === 'anual'} />}
        {anual && (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { label: 'Total Receitas', value: moeda(Number(anual.total_receitas)), color: 'text-green-600' },
                { label: 'Total Despesas', value: moeda(Number(anual.total_despesas)), color: 'text-red-500' },
                { label: 'Saldo Final', value: moeda(Number(anual.saldo_final)), color: Number(anual.saldo_final) >= 0 ? 'text-emerald-600' : 'text-red-500' },
              ].map(k => (
                <div key={k.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{k.label}</p>
                  <p className={`text-lg font-black mt-1 ${k.color}`}>{k.value}</p>
                </div>
              ))}
            </div>
            {Array.isArray(anual.meses) && (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={anual.meses as Record<string, unknown>[]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => moeda(v)} />
                  <Legend />
                  <Bar dataKey="receitas" name="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="despesas" name="Despesas" fill="#f87171" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   ABA CAPTAÇÃO
═══════════════════════════════════════════════════════════ */

function AbaCaptacao() {
  const [insights, setInsights] = useState<Record<string, unknown> | null>(null);
  const [monthly, setMonthly] = useState<unknown[]>([]);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [ri, rm] = await Promise.all([
        api.get('/captacao/insights'),
        api.get('/captacao/insights/monthly'),
      ]);
      setInsights(ri.data);
      setMonthly(rm.data ?? []);
    } catch {/* silencia */} finally { setCarregando(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const kpis = (insights?.kpis as Record<string, unknown>) ?? {};
  const byStatus = Array.isArray(insights?.by_pipeline_status) ? (insights!.by_pipeline_status as any[]) : [];
  const bySource = Array.isArray(insights?.by_source_type) ? (insights!.by_source_type as any[]) : [];

  const STATUS_LABELS: Record<string, string> = {
    prospeccao: 'Prospecção', qualificacao: 'Qualificação', elaboracao: 'Elaboração',
    submissao: 'Submissão', aprovado: 'Aprovado', reprovado: 'Reprovado', archived: 'Arquivado',
  };
  const STATUS_CORES: Record<string, string> = {
    prospeccao: '#94a3b8', qualificacao: '#f59e0b', elaboracao: '#3b82f6',
    submissao: '#8b5cf6', aprovado: '#10b981', reprovado: '#ef4444', archived: '#64748b',
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Target size={16} className="text-purple-600" /> KPIs de Captação
          </h3>
          <button onClick={carregar} disabled={carregando}
            className="px-3 py-1.5 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-1 disabled:opacity-50">
            {carregando ? <RefreshCw size={12} className="animate-spin"/> : <RefreshCw size={12}/>} Atualizar
          </button>
        </div>
        {!insights && <EmptyRelatorio onClick={carregar} loading={carregando} />}
        {insights && (
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total Oportunidades', value: String(kpis.total ?? 0), color: 'text-purple-600' },
                { label: 'Aprovadas', value: String(kpis.approved ?? 0), color: 'text-green-600' },
                { label: 'Taxa Aprovação', value: `${kpis.approval_rate ?? 0}%`, color: Number(kpis.approval_rate ?? 0) >= 20 ? 'text-green-600' : 'text-orange-500' },
                { label: 'Vencendo em 30d', value: String(kpis.expiring_30d ?? 0), color: Number(kpis.expiring_30d ?? 0) > 0 ? 'text-red-500' : 'text-slate-500' },
              ].map(c => (
                <div key={c.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{c.label}</p>
                  <p className={`text-2xl font-black mt-1 ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {byStatus.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3">Pipeline por Status</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={byStatus.map((s: any) => ({ ...s, status_label: STATUS_LABELS[s.status] ?? s.status }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="status_label" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="count" name="Oportunidades" radius={[4, 4, 0, 0]}>
                        {byStatus.map((s: any, i: number) => (
                          <Cell key={i} fill={STATUS_CORES[s.status] ?? '#7c3aed'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {bySource.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3">Por Tipo de Fonte</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={bySource} dataKey="count" nameKey="source_type" cx="50%" cy="50%" outerRadius={80} label={({ name, value }: any) => `${name}: ${value}`}>
                        {bySource.map((_: unknown, i: number) => <Cell key={i} fill={CORES_PIZZA[i % CORES_PIZZA.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {monthly.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <TrendingUp size={16} className="text-purple-600" /> Oportunidades por Mês (12 meses)
            </h3>
          </div>
          <div className="p-5">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthly as Record<string, unknown>[]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" name="Oportunidades" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {insights && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <DollarSign size={16} className="text-green-600" /> Potencial Financeiro
            </h3>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { label: 'Valor Potencial Total', value: moeda(Number(kpis.value_potential ?? 0)), color: 'text-purple-600' },
              { label: 'Valor em Submissão', value: moeda(Number(kpis.value_submitted ?? 0)), color: 'text-blue-600' },
              { label: 'Valor Aprovado', value: moeda(Number(kpis.value_approved ?? 0)), color: 'text-green-600' },
            ].map(c => (
              <div key={c.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{c.label}</p>
                <p className={`text-lg font-black mt-1 ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   ABA RH
═══════════════════════════════════════════════════════════ */

function AbaRH() {
  const [colaboradores, setColaboradores] = useState<any[]>([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data } = await api.get('/gente/colaboradores');
      setColaboradores(data ?? []);
    } catch {/* silencia */} finally { setCarregando(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = colaboradores.filter(c =>
    !busca || (c.funcionario?.nome ?? '').toLowerCase().includes(busca.toLowerCase()) ||
    (c.funcionario?.cargo ?? '').toLowerCase().includes(busca.toLowerCase())
  );

  const exportarColaboradores = () => {
    exportarExcel(filtrados.map(c => ({
      Nome: c.funcionario?.nome ?? '',
      Cargo: c.funcionario?.cargo ?? '',
      Tipo: c.tipo ?? '',
      Jornada: c.jornada_flexivel ? 'Flexível' : `${c.horario_entrada ?? '—'} às ${c.horario_saida ?? '—'}`,
      'Dias de Trabalho': (c.dias_trabalho ?? []).join(', '),
      'VT Diário': c.valor_passagem ? `R$ ${Number(c.valor_passagem).toFixed(2)}` : '—',
    })), 'colaboradores_ativos');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex-wrap gap-3">
          <h3 className="font-black text-sm uppercase tracking-widest text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <UserCheck size={16} className="text-indigo-600" /> Colaboradores Ativos — {filtrados.length}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <FileText size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou cargo..."
                className="pl-7 pr-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs bg-white dark:bg-slate-800 dark:text-slate-100 w-48" />
            </div>
            <button onClick={carregar} disabled={carregando}
              className="px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1 disabled:opacity-50">
              {carregando ? <RefreshCw size={12} className="animate-spin"/> : <RefreshCw size={12}/>} Atualizar
            </button>
            {filtrados.length > 0 && (
              <button onClick={exportarColaboradores}
                className="px-3 py-1.5 text-xs font-bold border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1">
                <Download size={12}/> Excel
              </button>
            )}
          </div>
        </div>
        {carregando && <div className="py-10 text-center text-slate-400"><RefreshCw size={20} className="animate-spin mx-auto" /></div>}
        {!carregando && filtrados.length === 0 && (
          <div className="py-10 text-center text-slate-400 text-sm">Nenhum colaborador ativo encontrado.</div>
        )}
        {!carregando && filtrados.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                <tr>
                  {['Nome', 'Cargo', 'Tipo', 'Jornada', 'Dias', 'VT/dia'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-black text-[10px] uppercase tracking-wider text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {filtrados.map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">{c.funcionario?.nome ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{c.funcionario?.cargo ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${c.tipo === 'voluntario' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                        {c.tipo === 'voluntario' ? 'Voluntário' : 'Funcionário'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                      {c.jornada_flexivel ? 'Flexível' : `${c.horario_entrada ?? '—'} – ${c.horario_saida ?? '—'}`}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{(c.dias_trabalho ?? []).join(', ') || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{c.valor_passagem ? `R$ ${Number(c.valor_passagem).toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   PÁGINA PRINCIPAL
═══════════════════════════════════════════════════════════ */

const ABAS: { id: AbaId; label: string; icon: React.ElementType; color: string }[] = [
  { id: 'financeiro', label: 'Financeiro',  icon: DollarSign, color: 'text-green-600' },
  { id: 'dre',        label: 'DRE',         icon: TrendingUp, color: 'text-purple-600' },
  { id: 'ong',        label: 'ONG',          icon: Leaf,       color: 'text-emerald-700' },
  { id: 'academico',  label: 'Acadêmico',   icon: BookOpen,   color: 'text-blue-600' },
  { id: 'social',     label: 'Social',      icon: Globe,      color: 'text-emerald-600' },
  { id: 'estoque',    label: 'Estoque',     icon: Package,    color: 'text-orange-500' },
  { id: 'captacao',   label: 'Captação',    icon: Target,     color: 'text-purple-500' },
  { id: 'rh',         label: 'RH',          icon: UserCheck,  color: 'text-indigo-600' },
];

export default function RelatoriosPage() {
  const [aba, setAba] = useState<AbaId>('financeiro');

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100 uppercase italic tracking-tight flex items-center gap-2">
            <BarChart2 size={26} className="text-purple-600" />
            Relatórios
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
            Análises financeiras, acadêmicas, sociais e de estoque
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-1 w-fit">
          {ABAS.map(a => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                onClick={() => setAba(a.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
                  aba === a.id
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon size={14} className={aba === a.id ? 'text-white' : a.color} />
                {a.label}
              </button>
            );
          })}
        </div>

        {/* Conteúdo */}
        {aba === 'financeiro' && <AbaFinanceiro />}
        {aba === 'dre'        && <AbaDRE />}
        {aba === 'ong'        && <AbaONG />}
        {aba === 'academico'  && <AbaAcademico />}
        {aba === 'social'     && <AbaSocial />}
        {aba === 'estoque'    && <AbaEstoque />}
        {aba === 'captacao'   && <AbaCaptacao />}
        {aba === 'rh'         && <AbaRH />}

      </div>
    </div>
  );
}
