'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  RefreshCw, FileText, BookOpen, Activity, User, Users, Search, X,
  ChevronDown, ChevronUp, Eye, Edit3, ClipboardCheck, History,
  AlertTriangle, Check, Smartphone, Copy, CheckSquare, Square, Shield, Calendar,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import api from '@/services/api';
import { useAuth } from '@/context/auth-context';
import { Turma, Aluno, PresencaSessao } from './_types';
import { escapeHtml } from '@/lib/utils';

// ─── Local interfaces ─────────────────────────────────────────────────────────

interface DiarioCabecalho {
  turma: {
    id: string; nome: string; curso_nome?: string | null; professor_nome?: string | null;
    turno?: string | null; ano?: string | null;
  };
  alunos: { id: string; nome_completo: string; numero_matricula?: string | null; presencas: number; faltas: number; pct_presenca: number | null; }[];
  sessoes: {
    id: string; data: string; tema_aula?: string | null; conteudo_abordado?: string | null;
    usuario_nome?: string | null;
    presencas: Record<string, 'P' | 'F' | 'J' | 'I'>;
  }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDataCurta(v: string) {
  if (!v) return '–';
  const [, m, d] = v.split('-');
  return `${d}/${m}`;
}
function fmtDataExtenso(v: string) {
  if (!v) return '–';
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [, m, d] = v.split('-');
  return `${parseInt(d)} de ${meses[parseInt(m) - 1]}`;
}
function fmtData(v: string) {
  if (!v) return '–';
  const [y, m, d] = v.split('-');
  return `${d}/${m}/${y}`;
}

// ─── DiarioDeClasseSubTab ─────────────────────────────────────────────────────

function DiarioDeClasseSubTab({ turmas }: { turmas: Turma[] }) {
  const [turmaId, setTurmaId] = useState('');
  const [dataIni, setDataIni] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [dados, setDados] = useState<DiarioCabecalho | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sessaoSel, setSessaoSel] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    if (!turmaId) { setDados(null); return; }
    setLoading(true); setErro(null); setSessaoSel(null);
    try {
      const params: any = {};
      if (dataIni) params.data_ini = dataIni;
      if (dataFim) params.data_fim = dataFim;
      const r = await api.get(`/academico/presenca/diario-turma/${turmaId}`, { params });
      setDados(r.data);
    } catch (e: any) {
      setErro(e?.response?.data?.message || 'Falha ao carregar diário');
    } finally {
      setLoading(false);
    }
  }, [turmaId, dataIni, dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  const corCelula = (c?: 'P' | 'F' | 'J' | 'I') => {
    switch (c) {
      case 'P': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'F': return 'bg-rose-50 text-rose-700 border-rose-200 font-black';
      case 'J': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'I': return 'bg-slate-100 text-slate-400 border-slate-200';
      default:  return 'bg-white text-slate-300 border-slate-100';
    }
  };
  const labelCelula = (c?: 'P' | 'F' | 'J' | 'I') =>
    c === 'P' ? 'P' : c === 'F' ? 'F' : c === 'J' ? 'J' : c === 'I' ? '–' : '·';

  const turmaSel = useMemo(() => turmas.find(t => t.id === turmaId), [turmas, turmaId]);

  const imprimir = () => {
    if (!printRef.current) return;
    const html = printRef.current.outerHTML;
    const win = window.open('', '_blank', 'width=1200,height=800');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Diário de Classe — ${escapeHtml(dados?.turma.nome)}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>@page { size: A4 landscape; margin: 12mm } body { font-family: ui-sans-serif, system-ui, sans-serif }</style>
      </head><body class="p-6">${html}</body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 600);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block tracking-widest">Turma</label>
          <select value={turmaId} onChange={e => setTurmaId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white font-bold">
            <option value="">Selecione uma turma…</option>
            {turmas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block tracking-widest">De</label>
          <input type="date" value={dataIni} onChange={e => setDataIni(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
        </div>
        <div>
          <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block tracking-widest">Até</label>
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
        </div>
        <button onClick={carregar} disabled={!turmaId || loading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest disabled:opacity-40 transition-colors">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
        {dados && (
          <button onClick={imprimir}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white hover:bg-purple-700 text-[10px] font-black uppercase tracking-widest transition-colors">
            <FileText size={12} /> Imprimir / PDF
          </button>
        )}
      </div>

      {!turmaId && (
        <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-20 text-center">
          <BookOpen size={36} className="mx-auto mb-3 text-purple-300" />
          <p className="text-sm font-black text-slate-600">Escolha uma turma para abrir o diário</p>
          <p className="text-xs text-slate-400 mt-1">Você verá toda a presença, tema e conteúdo abordado nas aulas.</p>
        </div>
      )}

      {erro && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-700 text-xs font-bold">{erro}</div>
      )}

      {loading && turmaId && (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <BookOpen size={28} className="animate-pulse text-purple-400" />
          <span className="ml-3 text-sm font-bold">Carregando diário…</span>
        </div>
      )}

      {dados && !loading && (
        <div ref={printRef} className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
          <header className="relative px-6 py-5 bg-gradient-to-br from-purple-700 via-purple-600 to-violet-700 text-white overflow-hidden">
            <div className="absolute inset-0 opacity-10" style={{
              backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 12px, rgba(255,255,255,0.15) 12px, rgba(255,255,255,0.15) 13px)`,
            }} />
            <div className="relative flex items-start gap-5">
              <img src="/logo-instituto.jpg" alt="Instituto Tia Pretinha" loading="lazy"
                className="w-20 h-20 rounded-2xl object-cover border-2 border-white/30 shadow-lg shrink-0 bg-white" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-purple-200">Instituto Tia Pretinha</p>
                <h2 className="text-2xl font-black mt-0.5 leading-tight">Diário de Classe</h2>
                <div className="flex flex-wrap items-baseline gap-3 mt-2">
                  <span className="text-lg font-black">{dados.turma.nome}</span>
                  {dados.turma.curso_nome && <span className="text-purple-200 text-xs font-bold">· {dados.turma.curso_nome}</span>}
                  {dados.turma.professor_nome && <span className="text-purple-200 text-xs">Profª: <span className="font-bold text-white">{dados.turma.professor_nome}</span></span>}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {dados.turma.turno && <span className="px-2.5 py-1 rounded-full bg-white/15 border border-white/20 text-[10px] font-black uppercase">{dados.turma.turno}</span>}
                  {dados.turma.ano   && <span className="px-2.5 py-1 rounded-full bg-white/15 border border-white/20 text-[10px] font-black uppercase">{dados.turma.ano}</span>}
                  <span className="px-2.5 py-1 rounded-full bg-white/15 border border-white/20 text-[10px] font-black uppercase">{dados.alunos.length} aluno{dados.alunos.length !== 1 ? 's' : ''}</span>
                  <span className="px-2.5 py-1 rounded-full bg-white/15 border border-white/20 text-[10px] font-black uppercase">{dados.sessoes.length} aula{dados.sessoes.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-3 px-6 py-3 bg-slate-50 border-b border-slate-100 text-[10px] font-bold">
            <span className="text-slate-400 uppercase tracking-widest">Legenda:</span>
            <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 grid place-items-center font-black">P</span> Presente</span>
            <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded border border-rose-200 bg-rose-50 text-rose-700 grid place-items-center font-black">F</span> Falta</span>
            <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded border border-amber-200 bg-amber-50 text-amber-700 grid place-items-center font-black">J</span> Justificada</span>
            <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded border border-slate-200 bg-slate-100 text-slate-400 grid place-items-center">–</span> Isento</span>
            <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded border border-slate-100 text-slate-300 grid place-items-center">·</span> Sem registro</span>
          </div>

          {dados.sessoes.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-black text-slate-500">Nenhuma aula registrada para esta turma no período</p>
              <p className="text-xs text-slate-400 mt-1">Crie uma chamada na aba Histórico ou ajuste o intervalo de datas.</p>
            </div>
          ) : dados.alunos.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-black text-slate-500">Esta turma ainda não possui alunos ativos</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="sticky left-0 z-20 bg-slate-50 border-b border-r border-slate-200 px-3 py-2 text-left text-[9px] font-black uppercase tracking-widest text-slate-500 min-w-[220px]">
                      Aluno
                    </th>
                    {dados.sessoes.map(s => (
                      <th key={s.id}
                        onClick={() => setSessaoSel(prev => prev === s.id ? null : s.id)}
                        title={`${s.tema_aula || ''}${s.conteudo_abordado ? '\n' + s.conteudo_abordado : ''}`}
                        className={`border-b border-slate-200 px-1 py-1.5 text-center cursor-pointer transition-colors min-w-[44px] ${sessaoSel === s.id ? 'bg-purple-100' : 'hover:bg-slate-100'}`}>
                        <div className="text-[10px] font-black text-slate-700 tabular-nums">{fmtDataCurta(s.data)}</div>
                        {s.tema_aula && (
                          <div className="text-[8px] font-bold text-slate-400 truncate max-w-[60px] mx-auto" style={{ writingMode: 'horizontal-tb' }}>
                            {s.tema_aula.length > 8 ? s.tema_aula.slice(0, 7) + '…' : s.tema_aula}
                          </div>
                        )}
                      </th>
                    ))}
                    <th className="border-b border-l border-slate-200 px-2 py-2 text-center text-[9px] font-black uppercase text-emerald-600">P</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-center text-[9px] font-black uppercase text-rose-600">F</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-center text-[9px] font-black uppercase text-purple-600">%</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.alunos.map((aluno, i) => (
                    <tr key={aluno.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                      <td className="sticky left-0 z-10 bg-inherit border-b border-r border-slate-100 px-3 py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 grid place-items-center text-[10px] font-black shrink-0">
                            {(aluno.nome_completo[0] || '?').toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-slate-800 truncate max-w-[180px]">{aluno.nome_completo}</p>
                            {aluno.numero_matricula && <p className="text-[8px] text-slate-400 font-mono">{aluno.numero_matricula}</p>}
                          </div>
                        </div>
                      </td>
                      {dados.sessoes.map(s => {
                        const c = s.presencas[aluno.id];
                        return (
                          <td key={s.id} className="border-b border-slate-100 p-0.5">
                            <div className={`mx-auto w-7 h-7 grid place-items-center rounded border text-[10px] font-black tabular-nums ${corCelula(c)}`}>
                              {labelCelula(c)}
                            </div>
                          </td>
                        );
                      })}
                      <td className="border-b border-l border-slate-100 px-2 py-1.5 text-center text-[10px] font-black text-emerald-600 tabular-nums">{aluno.presencas}</td>
                      <td className="border-b border-slate-100 px-2 py-1.5 text-center text-[10px] font-black text-rose-600 tabular-nums">{aluno.faltas}</td>
                      <td className="border-b border-slate-100 px-2 py-1.5 text-center tabular-nums">
                        {aluno.pct_presenca === null ? (
                          <span className="text-slate-300 text-[10px]">–</span>
                        ) : (
                          <span className={`text-[10px] font-black ${aluno.pct_presenca >= 75 ? 'text-emerald-600' : aluno.pct_presenca >= 50 ? 'text-amber-500' : 'text-rose-500'}`}>
                            {aluno.pct_presenca}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sessaoSel && (() => {
            const s = dados.sessoes.find(x => x.id === sessaoSel);
            if (!s) return null;
            return (
              <div className="px-6 py-4 bg-purple-50/50 border-t border-purple-100">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-purple-600">Aula de {fmtDataExtenso(s.data)}</p>
                    {s.tema_aula && <h3 className="text-sm font-black text-slate-800 mt-1">{s.tema_aula}</h3>}
                  </div>
                  <button onClick={() => setSessaoSel(null)} className="text-purple-400 hover:text-purple-600 text-[10px] font-black uppercase">Fechar ✕</button>
                </div>
                {s.conteudo_abordado && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-2 mb-1">Conteúdo abordado</p>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap">{s.conteudo_abordado}</p>
                  </div>
                )}
                {s.usuario_nome && <p className="text-[9px] text-slate-400 mt-3">Registrado por: {s.usuario_nome}</p>}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── RelatoriosPresencaSubTab ─────────────────────────────────────────────────

function RelatoriosPresencaSubTab({ turmas }: { turmas: Turma[] }) {
  const [turmaId, setTurmaId]   = useState('');
  const [dataIni, setDataIni]   = useState('');
  const [dataFim, setDataFim]   = useState('');
  const [dados, setDados]       = useState<any>(null);
  const [loading, setLoading]   = useState(false);

  const aplicarPreset = (dias: number) => {
    const fim = new Date();
    const ini = new Date(); ini.setDate(ini.getDate() - dias);
    setDataIni(ini.toISOString().slice(0, 10));
    setDataFim(fim.toISOString().slice(0, 10));
  };

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (turmaId) params.turma_id = turmaId;
      if (dataIni) params.data_ini = dataIni;
      if (dataFim) params.data_fim = dataFim;
      const r = await api.get('/academico/presenca/relatorio', { params });
      setDados(r.data);
    } catch { /* silencioso */ }
    setLoading(false);
  }, [turmaId, dataIni, dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  const exportarCSV = () => {
    if (!dados?.tendencia?.length) return;
    const linhas = [['Data', 'Presentes', 'Ausentes', 'Taxa (%)']];
    dados.tendencia.forEach((t: any) => {
      const total = t.presentes + t.ausentes;
      const taxa  = total > 0 ? Math.round(t.presentes / total * 100) : 0;
      linhas.push([t.data, t.presentes, t.ausentes, taxa]);
    });
    const csv  = linhas.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'relatorio-presenca.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const kpi = dados?.kpi ?? {};

  const porTurmaData = (dados?.por_turma ?? []).map((t: any) => ({
    nome:     (t.turma_nome || '–').slice(0, 22),
    presentes: t.presentes,
    ausentes:  t.ausentes,
    sessoes:   t.sessoes,
    taxa:      t.presentes + t.ausentes > 0 ? Math.round(t.presentes / (t.presentes + t.ausentes) * 100) : 0,
  }));

  const tendenciaData = (dados?.tendencia ?? []).map((t: any) => {
    const [, m, d] = (t.data || '').split('-');
    const total = t.presentes + t.ausentes;
    return { ...t, label: `${d}/${m}`, taxa: total > 0 ? Math.round(t.presentes / total * 100) : 0 };
  });

  const taxaColor = (v: number) => v >= 75 ? 'text-green-600 bg-green-50' : v >= 50 ? 'text-amber-600 bg-amber-50' : 'text-red-500 bg-red-50';

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Turma</label>
            <select value={turmaId} onChange={e => setTurmaId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white">
              <option value="">Todas as turmas</option>
              {turmas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">De</label>
            <input type="date" value={dataIni} onChange={e => setDataIni(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Até</label>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {[{ label: '7d', dias: 7 }, { label: '30d', dias: 30 }, { label: '90d', dias: 90 }, { label: '6m', dias: 180 }].map(p => (
              <button key={p.label} onClick={() => aplicarPreset(p.dias)}
                className="px-2.5 py-2 rounded-xl border border-slate-200 text-[9px] font-black uppercase hover:bg-purple-50 hover:border-purple-200 hover:text-purple-700 transition-colors">
                {p.label}
              </button>
            ))}
            <button onClick={() => { setDataIni(''); setDataFim(''); }}
              className="px-2.5 py-2 rounded-xl border border-slate-200 text-[9px] font-black uppercase text-slate-400 hover:bg-slate-100 transition-colors">
              Tudo
            </button>
          </div>
          <button onClick={carregar} disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
          <button onClick={exportarCSV} disabled={!dados}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-[10px] font-black uppercase disabled:opacity-30 transition-colors">
            <FileText size={12} /> Exportar CSV
          </button>
        </div>
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-slate-400">
          <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-slate-300" /> Calculando...
        </div>
      )}

      {dados && !loading && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Sessões Registradas', value: kpi.total_sessoes ?? 0, color: 'text-purple-700', bg: 'bg-purple-50 border-purple-100' },
              { label: 'Taxa de Presença',    value: `${kpi.taxa_presenca ?? 0}%`, color: (kpi.taxa_presenca ?? 0) >= 75 ? 'text-green-700' : 'text-amber-600', bg: 'bg-white border-slate-100' },
              { label: 'Total Presentes',     value: (kpi.total_presentes ?? 0).toLocaleString(), color: 'text-green-700', bg: 'bg-green-50 border-green-100' },
              { label: 'Total Ausentes',      value: (kpi.total_ausentes ?? 0).toLocaleString(),  color: 'text-red-600',   bg: 'bg-red-50 border-red-100' },
            ].map(k => (
              <div key={k.label} className={`${k.bg} rounded-2xl p-4 border shadow-sm`}>
                <p className="text-[9px] font-black uppercase text-slate-400 mb-1">{k.label}</p>
                <p className={`text-3xl font-black ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {porTurmaData.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-4">Presença por Turma</h3>
                <ResponsiveContainer width="100%" height={Math.max(180, porTurmaData.length * 36)}>
                  <BarChart data={porTurmaData} layout="vertical" margin={{ left: 0, right: 20 }}>
                    <XAxis type="number" tick={{ fontSize: 9 }} />
                    <YAxis dataKey="nome" type="category" tick={{ fontSize: 9 }} width={90} />
                    <Tooltip
                      formatter={(v: any, name: string) => [v, name === 'presentes' ? 'Presentes' : 'Ausentes']}
                      contentStyle={{ fontSize: 11, borderRadius: 10 }}
                    />
                    <Bar dataKey="presentes" fill="#22c55e" radius={[0, 4, 4, 0]} name="presentes" stackId="a" />
                    <Bar dataKey="ausentes"  fill="#ef4444" radius={[0, 4, 4, 0]} name="ausentes"  stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {tendenciaData.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-4">Tendência de Presença (%)</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={tendenciaData} margin={{ right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={Math.ceil(tendenciaData.length / 10)} />
                    <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} unit="%" />
                    <Tooltip formatter={(v: any) => [`${v}%`, 'Taxa Presença']} contentStyle={{ fontSize: 11, borderRadius: 10 }} />
                    <Line type="monotone" dataKey="taxa" stroke="#7c3aed" strokeWidth={2.5} dot={tendenciaData.length < 30} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {porTurmaData.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Resumo por Turma</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      {['Turma', 'Sessões', 'Presentes', 'Ausentes', 'Taxa'].map(h => (
                        <th key={h} className={`px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 ${h === 'Turma' ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {porTurmaData.map((t: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-2.5 font-bold text-slate-800">{t.nome}</td>
                        <td className="px-4 py-2.5 text-right text-slate-500">{t.sessoes}</td>
                        <td className="px-4 py-2.5 text-right text-green-700 font-bold">{t.presentes}</td>
                        <td className="px-4 py-2.5 text-right text-red-600 font-bold">{t.ausentes}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={`font-black text-[10px] px-2 py-0.5 rounded-full ${taxaColor(t.taxa)}`}>{t.taxa}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {dados.top_faltas?.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Alunos com Mais Faltas</h3>
              </div>
              <div className="divide-y divide-slate-50">
                {dados.top_faltas.map((a: any, i: number) => {
                  const taxa = a.total_registros > 0 ? Math.round(a.total_presentes / a.total_registros * 100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50/50 transition-colors">
                      <span className="text-[9px] font-black text-slate-300 w-5 shrink-0 text-center">{i + 1}</span>
                      <span className="flex-1 text-xs font-bold text-slate-800 truncate">{a.aluno_nome}</span>
                      <span className="text-red-600 font-black text-xs shrink-0">{a.total_faltas} falta{a.total_faltas !== 1 ? 's' : ''}</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full shrink-0 ${taxaColor(taxa)}`}>{taxa}% presença</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {porTurmaData.length === 0 && tendenciaData.length === 0 && (
            <div className="py-16 text-center">
              <Activity size={40} className="mx-auto mb-3 text-slate-200" />
              <p className="text-sm font-bold text-slate-400">Nenhum dado encontrado para o período selecionado.</p>
              <p className="text-xs text-slate-300 mt-1">Tente selecionar um intervalo diferente ou &quot;Tudo&quot;.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── PorAlunoSubTab ───────────────────────────────────────────────────────────

function PorAlunoSubTab({ turmas }: { turmas: Turma[] }) {
  const [turmaFiltro, setTurmaFiltro] = useState('');
  const [busca, setBusca]             = useState('');
  const [listaAlunos, setListaAlunos] = useState<Aluno[]>([]);
  const [alunoSel, setAlunoSel]       = useState<Aluno | null>(null);
  const [dataIni, setDataIni]         = useState('');
  const [dataFim, setDataFim]         = useState('');
  const [dados, setDados]             = useState<any>(null);
  const [loadingLista, setLoadingLista] = useState(false);
  const [loadingRelatorio, setLoadingRelatorio] = useState(false);

  const carregarLista = useCallback(async () => {
    const params: any = {};
    if (turmaFiltro) params.turma_id = turmaFiltro;
    if (busca.trim().length >= 2) params.nome = busca.trim();
    if (!turmaFiltro && busca.trim().length < 2) { setListaAlunos([]); return; }
    setLoadingLista(true);
    try {
      const r = await api.get('/academico/alunos', { params });
      setListaAlunos(r.data as Aluno[]);
    } catch { /* silencioso */ }
    setLoadingLista(false);
  }, [turmaFiltro, busca]);

  useEffect(() => {
    if (turmaFiltro) {
      carregarLista();
    } else {
      const t = setTimeout(carregarLista, 300);
      return () => clearTimeout(t);
    }
  }, [turmaFiltro, busca, carregarLista]);

  const selecionarAluno = (a: Aluno) => { setAlunoSel(a); setDados(null); };

  const carregarRelatorio = useCallback(async () => {
    if (!alunoSel) return;
    setLoadingRelatorio(true);
    try {
      const params: any = {};
      if (dataIni) params.data_ini = dataIni;
      if (dataFim) params.data_fim = dataFim;
      const r = await api.get(`/academico/presenca/relatorio/aluno/${alunoSel.id}`, { params });
      setDados(r.data);
    } catch { /* silencioso */ }
    setLoadingRelatorio(false);
  }, [alunoSel, dataIni, dataFim]);

  useEffect(() => { if (alunoSel) carregarRelatorio(); }, [carregarRelatorio]);

  const fmtDataShort = (v: string) => {
    if (!v) return '–';
    const [, m, d] = v.split('-');
    return `${d}/${m}`;
  };

  const taxaColor  = (v: number) => v >= 75 ? 'text-green-600 bg-green-50' : v >= 50 ? 'text-amber-600 bg-amber-50' : 'text-red-500 bg-red-50';
  const taxaBorder = (v: number) => v >= 75 ? 'border-green-200' : v >= 50 ? 'border-amber-200' : 'border-red-200';

  const listaBuscada = busca.trim().length >= 2 || turmaFiltro ? listaAlunos : [];
  const semFiltro    = !turmaFiltro && busca.trim().length < 2;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Filtrar por Turma</label>
            <select value={turmaFiltro} onChange={e => { setTurmaFiltro(e.target.value); setAlunoSel(null); setDados(null); }}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white">
              <option value="">Todas as turmas</option>
              {turmas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Buscar por Nome</label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={busca}
                onChange={e => { setBusca(e.target.value); setAlunoSel(null); setDados(null); }}
                placeholder="Nome do aluno..."
                className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              {loadingLista && <RefreshCw size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />}
            </div>
          </div>
        </div>

        {alunoSel && (
          <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-slate-100">
            <div>
              <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Período — De</label>
              <input type="date" value={dataIni} onChange={e => setDataIni(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400" />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Até</label>
              <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400" />
            </div>
            <button onClick={carregarRelatorio} disabled={loadingRelatorio}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase disabled:opacity-40">
              <RefreshCw size={12} className={loadingRelatorio ? 'animate-spin' : ''} /> Atualizar
            </button>
            <button onClick={() => { setAlunoSel(null); setDados(null); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-500 text-[10px] font-black uppercase hover:bg-slate-50">
              <X size={12} /> Trocar aluno
            </button>
          </div>
        )}
      </div>

      {!alunoSel && (
        <>
          {semFiltro && (
            <div className="py-14 text-center">
              <Users size={40} className="mx-auto mb-3 text-slate-200" />
              <p className="text-sm font-bold text-slate-400">Selecione uma turma ou busque por nome.</p>
              <p className="text-xs text-slate-300 mt-1">Depois clique no aluno para ver o relatório de presença.</p>
            </div>
          )}
          {!semFiltro && loadingLista && (
            <div className="py-10 text-center text-sm text-slate-400">
              <RefreshCw size={22} className="animate-spin mx-auto mb-2 text-slate-300" /> Carregando alunos...
            </div>
          )}
          {!semFiltro && !loadingLista && listaBuscada.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-400">Nenhum aluno encontrado.</div>
          )}
          {!semFiltro && !loadingLista && listaBuscada.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest">
                  {turmaFiltro ? turmas.find(t => t.id === turmaFiltro)?.nome ?? 'Turma' : 'Resultados da Busca'}
                </h3>
                <span className="text-[9px] text-slate-400">{listaBuscada.length} aluno{listaBuscada.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-slate-50 max-h-[480px] overflow-y-auto">
                {listaBuscada.map(a => (
                  <button key={a.id} onClick={() => selecionarAluno(a)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-purple-50/60 transition-colors text-left group">
                    <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center font-black text-purple-600 text-xs shrink-0 group-hover:bg-purple-200 transition-colors">
                      {(a.nome_completo || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate group-hover:text-purple-700">{a.nome_completo}</p>
                      {a.turma_nome && <p className="text-[9px] text-slate-400">{a.turma_nome}</p>}
                    </div>
                    <ChevronDown size={13} className="text-slate-300 group-hover:text-purple-400 rotate-[-90deg] shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {alunoSel && loadingRelatorio && (
        <div className="py-12 text-center text-sm text-slate-400">
          <RefreshCw size={24} className="animate-spin mx-auto mb-3 text-slate-300" /> Carregando...
        </div>
      )}

      {alunoSel && dados && !loadingRelatorio && (
        <>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center font-black text-purple-600 text-sm shrink-0">
              {alunoSel.nome_completo[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-slate-800 text-sm truncate">{alunoSel.nome_completo}</p>
              <p className="text-[10px] text-slate-400">{alunoSel.turma_nome || 'Sem turma atribuída'}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: 'Total Aulas',   value: dados.kpi.total ?? 0,        color: 'text-slate-700',  bg: 'bg-white border-slate-100' },
              { label: 'Presenças',     value: dados.kpi.presentes ?? 0,    color: 'text-green-700',  bg: 'bg-green-50 border-green-100' },
              { label: 'Faltas',        value: dados.kpi.faltas ?? 0,       color: 'text-red-600',    bg: 'bg-red-50 border-red-100' },
              { label: 'Justificadas',  value: dados.kpi.justificadas ?? 0, color: 'text-amber-600',  bg: 'bg-amber-50 border-amber-100' },
              { label: 'Taxa Presença', value: `${dados.kpi.taxa ?? 0}%`,
                color: (dados.kpi.taxa ?? 0) >= 75 ? 'text-green-700' : (dados.kpi.taxa ?? 0) >= 50 ? 'text-amber-600' : 'text-red-600',
                bg: `bg-white border ${taxaBorder(dados.kpi.taxa ?? 0)}` },
            ].map(k => (
              <div key={k.label} className={`${k.bg} rounded-2xl p-4 border shadow-sm`}>
                <p className="text-[9px] font-black uppercase text-slate-400 mb-1">{k.label}</p>
                <p className={`text-3xl font-black ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {dados.tendencia_mensal?.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-4">Presença por Mês</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dados.tendencia_mensal} margin={{ right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="mes" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10 }} />
                  <Legend wrapperStyle={{ fontSize: 9 }} />
                  <Bar dataKey="presentes" fill="#22c55e" name="Presenças" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="faltas"    fill="#ef4444" name="Faltas"    radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Histórico Detalhado</h3>
              <span className="text-[9px] text-slate-400">{dados.registros.length} registro{dados.registros.length !== 1 ? 's' : ''}</span>
            </div>
            {dados.registros.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-sm">Nenhum registro no período.</div>
            ) : (
              <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
                {dados.registros.map((r: any) => {
                  const corBadge = r.descricao === 'Presente'
                    ? 'bg-green-100 text-green-700'
                    : r.isento ? 'bg-slate-100 text-slate-500'
                    : r.justificada ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-600';
                  return (
                    <div key={r.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50/50 transition-colors">
                      <span className="text-xs font-black text-slate-700 w-16 shrink-0">{fmtDataShort(r.data)}</span>
                      <span className="flex-1 text-xs text-slate-600 truncate min-w-0">{r.tema_aula || '–'}</span>
                      <span className="text-[9px] text-slate-400 shrink-0 hidden sm:block truncate max-w-[110px]">{r.turma_nome}</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full shrink-0 ${corBadge}`}>
                        {r.descricao === 'Falta Justificada' ? 'Justificada' : r.descricao}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── PresencaTab ──────────────────────────────────────────────────────────────

export default function PresencaTab({ turmas, podeEditar }: { turmas: Turma[]; podeEditar: boolean }) {
  const { user } = useAuth();
  const podeIncluir = podeEditar || ['admin', 'prt', 'vp', 'drt'].includes(user?.role ?? '');
  const podeEditarSessao = ['admin', 'prt'].includes(user?.role ?? '') || podeEditar;
  const [subTab, setSubTab] = useState<'historico' | 'diario' | 'relatorios' | 'por-aluno'>('historico');

  const [filtroTurma, setFiltroTurma] = useState('');
  const [filtroDataIni, setFiltroDataIni] = useState('');
  const [filtroDataFim, setFiltroDataFim] = useState('');
  const [sessoes, setSessoes] = useState<PresencaSessao[]>([]);
  const [carregandoHist, setCarregandoHist] = useState(false);
  const [sessaoExpandida, setSessaoExpandida] = useState<string | null>(null);
  const [detalhesSessao, setDetalhesSessao] = useState<Record<string, any[]>>({});
  const [modoEdicaoSessao, setModoEdicaoSessao] = useState<string | null>(null);

  const [salvandoRegistro, setSalvandoRegistro] = useState<string | null>(null);

  const editarRegistro = async (sessaoId: string, registroId: string, descricao: string) => {
    setSalvandoRegistro(registroId);
    try {
      await api.patch(`/academico/presenca/registros/${registroId}`, { descricao });
      const r = await api.get(`/academico/presenca/sessoes/${sessaoId}/registros`);
      setDetalhesSessao(p => ({ ...p, [sessaoId]: r.data }));
      await carregarHistorico();
    } catch {}
    setSalvandoRegistro(null);
  };

  const [sessaoEditando, setSessaoEditando] = useState<PresencaSessao | null>(null);
  const [formEdicao, setFormEdicao] = useState<{ data: string; tema_aula: string; conteudo_abordado: string }>({ data: '', tema_aula: '', conteudo_abordado: '' });
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);

  const [etapa, setEtapa] = useState<1 | 2>(1);
  const [showModal, setShowModal] = useState(false);
  const [formSessao, setFormSessao] = useState<{
    turma_id: string; data: string; tema_aula: string; conteudo_abordado: string;
  }>({ turma_id: '', data: new Date().toISOString().slice(0, 10), tema_aula: '', conteudo_abordado: '' });
  const [alunosSessao, setAlunosSessao] = useState<Aluno[]>([]);
  const [presenca, setPresenca] = useState<Record<string, boolean>>({});
  const [isento, setIsento] = useState<Record<string, boolean>>({});
  const [justificada, setJustificada] = useState<Record<string, boolean>>({});
  const [carregandoAlunos, setCarregandoAlunos] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState<string | null>(null);
  const [linkCopiado, setLinkCopiado] = useState(false);

  const [feriados, setFeriados] = useState<Record<string, string>>({});
  useEffect(() => {
    const ano = new Date().getFullYear();
    api.get('/academico/feriados', { params: { ano } })
      .then(r => {
        const map: Record<string, string> = {};
        (r.data ?? []).forEach((f: any) => { map[f.data] = f.descricao; });
        setFeriados(map);
      })
      .catch(() => {});
  }, []);

  const carregarHistorico = useCallback(async () => {
    setCarregandoHist(true);
    try {
      const params: any = {};
      if (filtroTurma)   params.turma_id  = filtroTurma;
      if (filtroDataIni) params.data_ini  = filtroDataIni;
      if (filtroDataFim) params.data_fim  = filtroDataFim;
      const r = await api.get('/academico/presenca/sessoes', { params });
      setSessoes(r.data);
    } catch { /* silencioso */ }
    setCarregandoHist(false);
  }, [filtroTurma, filtroDataIni, filtroDataFim]);

  useEffect(() => { carregarHistorico(); }, [carregarHistorico]);

  const toggleDetalhes = async (sessaoId: string) => {
    if (sessaoExpandida === sessaoId) { setSessaoExpandida(null); return; }
    setSessaoExpandida(sessaoId);
    if (!detalhesSessao[sessaoId]) {
      try {
        const r = await api.get(`/academico/presenca/sessoes/${sessaoId}/registros`);
        setDetalhesSessao(p => ({ ...p, [sessaoId]: r.data }));
      } catch { setDetalhesSessao(p => ({ ...p, [sessaoId]: [] })); }
    }
  };

  const abrirNovaLista = () => {
    setFormSessao({ turma_id: '', data: new Date().toISOString().slice(0, 10), tema_aula: '', conteudo_abordado: '' });
    setAlunosSessao([]); setPresenca({}); setIsento({}); setJustificada({}); setErroModal(null); setEtapa(1);
    setShowModal(true);
  };

  const avancarParaChamada = async () => {
    setErroModal(null);
    if (!formSessao.turma_id) { setErroModal('Selecione uma turma.'); return; }
    if (!formSessao.data) { setErroModal('Informe a data da aula.'); return; }
    if (!formSessao.tema_aula.trim()) { setErroModal('Informe o tema da aula.'); return; }
    setCarregandoAlunos(true);
    try {
      const r = await api.get('/academico/alunos', { params: { turma_id: formSessao.turma_id } });
      if (!r.data.length) { setErroModal('Nenhum aluno ativo nesta turma.'); setCarregandoAlunos(false); return; }
      setAlunosSessao(r.data);
      const init: Record<string, boolean> = {};
      r.data.forEach((a: Aluno) => { init[a.id] = true; });
      setPresenca(init);
      setEtapa(2);
    } catch { setErroModal('Erro ao carregar alunos da turma.'); }
    setCarregandoAlunos(false);
  };

  const gerarLinkChamada = () => {
    if (!formSessao.turma_id)         { setErroModal('Selecione uma turma.');     return; }
    if (!formSessao.data)             { setErroModal('Informe a data da aula.'); return; }
    if (!formSessao.tema_aula.trim()) { setErroModal('Informe o tema da aula.'); return; }
    const chamadaToken = process.env.NEXT_PUBLIC_CHAMADA_TOKEN || 'itp-chamada-2026';
    const url = `${window.location.origin}/academico/chamada?token=${chamadaToken}&turma_id=${formSessao.turma_id}&data=${formSessao.data}&tema_aula=${encodeURIComponent(formSessao.tema_aula)}&conteudo_abordado=${encodeURIComponent(formSessao.conteudo_abordado)}`;
    navigator.clipboard.writeText(url).catch(() => window.open(url, '_blank'));
    setLinkCopiado(true);
    setTimeout(() => setLinkCopiado(false), 3000);
  };

  const salvarLista = async () => {
    setSalvando(true); setErroModal(null);
    try {
      await api.post('/academico/presenca/sessoes', {
        turma_id:          formSessao.turma_id,
        data:              formSessao.data,
        tema_aula:         formSessao.tema_aula,
        conteudo_abordado: formSessao.conteudo_abordado,
        registros: alunosSessao.map(a => ({ aluno_id: a.id, presente: presenca[a.id] ?? true, isento: isento[a.id] ?? false, justificada: justificada[a.id] ?? false })),
      });
      setShowModal(false);
      carregarHistorico();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Erro ao salvar.';
      setErroModal(Array.isArray(msg) ? msg.join(', ') : msg);
    }
    setSalvando(false);
  };

  const abrirEdicao = (s: PresencaSessao) => {
    setFormEdicao({ data: s.data, tema_aula: s.tema_aula ?? '', conteudo_abordado: s.conteudo_abordado ?? '' });
    setErroEdicao(null);
    setSessaoEditando(s);
  };

  const salvarEdicao = async () => {
    if (!sessaoEditando) return;
    if (!formEdicao.data) { setErroEdicao('Informe a data da aula.'); return; }
    if (!formEdicao.tema_aula.trim()) { setErroEdicao('Informe o tema da aula.'); return; }
    setSalvandoEdicao(true); setErroEdicao(null);
    try {
      await api.patch(`/academico/presenca/sessoes/${sessaoEditando.id}`, formEdicao);
      setSessaoEditando(null);
      carregarHistorico();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Erro ao salvar.';
      setErroEdicao(Array.isArray(msg) ? msg.join(', ') : msg);
    }
    setSalvandoEdicao(false);
  };

  const presentes    = alunosSessao.filter(a => !isento[a.id] && !justificada[a.id] && presenca[a.id]).length;
  const ausentes     = alunosSessao.filter(a => !isento[a.id] && !justificada[a.id] && !presenca[a.id]).length;
  const isentos      = alunosSessao.filter(a => isento[a.id]).length;
  const justificados = alunosSessao.filter(a => justificada[a.id]).length;

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex bg-white border border-slate-100 shadow-sm rounded-2xl p-1.5 gap-1">
        {([
          { id: 'historico',  label: 'Histórico',       Icon: History       },
          { id: 'diario',     label: 'Diário de Classe', Icon: BookOpen      },
          { id: 'relatorios', label: 'Relatórios',      Icon: Activity      },
          { id: 'por-aluno',  label: 'Por Aluno',       Icon: User          },
        ] as const).map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
              subTab === id ? 'bg-purple-600 text-white shadow' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}>
            <Icon size={11} /> {label}
          </button>
        ))}
      </div>

      {subTab === 'diario'     && <DiarioDeClasseSubTab turmas={turmas} />}
      {subTab === 'relatorios' && <RelatoriosPresencaSubTab turmas={turmas} />}
      {subTab === 'por-aluno'  && <PorAlunoSubTab turmas={turmas} />}

      {subTab === 'historico' && (<>
      {/* Filtros + cabeçalho */}
      <div className="flex flex-wrap items-end gap-3 bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
        <div className="flex-1 min-w-[180px]">
          <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Turma</label>
          <select value={filtroTurma} onChange={e => setFiltroTurma(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white">
            <option value="">Todas as turmas</option>
            {turmas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>
        <div className="min-w-[140px]">
          <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Data Início</label>
          <input type="date" value={filtroDataIni} onChange={e => setFiltroDataIni(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400" />
        </div>
        <div className="min-w-[140px]">
          <label className="text-[9px] font-black uppercase text-slate-400 mb-1 block">Data Fim</label>
          <input type="date" value={filtroDataFim} onChange={e => setFiltroDataFim(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-400" />
        </div>
        <button onClick={carregarHistorico} disabled={carregandoHist}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase disabled:opacity-50 transition-colors">
          <RefreshCw size={12} className={carregandoHist ? 'animate-spin' : ''} /> Atualizar
        </button>
        <a href="/chamada-professor" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 border border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100 px-4 py-2 rounded-xl font-black text-[10px] uppercase transition-colors">
          <Smartphone size={13}/> Portal do Professor
        </a>
        {podeIncluir && (
          <button onClick={abrirNovaLista}
            className="flex items-center gap-2 bg-purple-600 text-white px-5 py-2 rounded-xl font-black text-[10px] uppercase hover:bg-purple-700 transition-colors">
            <ClipboardCheck size={13}/> Nova Lista de Presença
          </button>
        )}
      </div>

      {/* Histórico */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Histórico de Aulas Registradas</h2>
          <span className="text-[9px] font-black text-slate-400">{sessoes.length} registro{sessoes.length !== 1 ? 's' : ''}</span>
        </div>

        {carregandoHist ? (
          <div className="py-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : sessoes.length === 0 ? (
          <div className="py-16 text-center">
            <ClipboardCheck size={40} className="mx-auto mb-3 text-slate-200" />
            <p className="text-sm text-slate-400 font-bold">Nenhuma aula registrada ainda.</p>
            {podeIncluir && <p className="text-xs text-slate-300 mt-1">Clique em &quot;Nova Lista de Presença&quot; para começar.</p>}
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {sessoes.map(s => (
              <div key={s.id}>
                <div className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-purple-50/20 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black text-slate-800">{fmtData(s.data)}</span>
                      <span className="text-[9px] font-black bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full uppercase">{s.turma_nome || '–'}</span>
                    </div>
                    {s.tema_aula && (
                      <p className="text-[11px] font-bold text-slate-600 mt-0.5 flex items-center gap-1">
                        <FileText size={10} className="text-purple-400 shrink-0" />
                        {s.tema_aula}
                      </p>
                    )}
                    {s.conteudo_abordado && (
                      <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{s.conteudo_abordado}</p>
                    )}
                    {s.usuario_nome && (
                      <p className="text-[9px] text-slate-400 mt-0.5">Registrado por: {s.usuario_nome}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="bg-green-100 text-green-700 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">{s.total_presentes} pres.</span>
                    <span className="bg-red-100 text-red-600 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">{s.total_ausentes} aus.</span>
                    <button onClick={() => toggleDetalhes(s.id)}
                      className="flex items-center gap-1 text-[9px] font-black uppercase text-slate-500 hover:text-purple-600 border border-slate-200 hover:border-purple-300 px-2.5 py-1 rounded-lg transition-colors">
                      <Eye size={10}/> {sessaoExpandida === s.id ? 'Fechar' : 'Ver Chamada'}
                      {sessaoExpandida === s.id ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
                    </button>
                    {podeEditarSessao && (
                      <button onClick={() => abrirEdicao(s)}
                        title="Editar data / tema"
                        className="flex items-center gap-1 text-[9px] font-black uppercase text-slate-400 hover:text-amber-600 border border-slate-200 hover:border-amber-300 hover:bg-amber-50 px-2.5 py-1 rounded-lg transition-colors">
                        <Edit3 size={10}/> Editar
                      </button>
                    )}
                  </div>
                </div>
                {sessaoExpandida === s.id && (
                  <div className="bg-slate-50/60 border-t border-slate-100 px-6 py-3 space-y-3">
                    {s.conteudo_abordado && (
                      <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
                        <p className="text-[9px] font-black uppercase text-purple-500 mb-1">Conteúdo Abordado</p>
                        <p className="text-xs text-slate-700">{s.conteudo_abordado}</p>
                      </div>
                    )}

                    {podeEditarSessao && detalhesSessao[s.id]?.length > 0 && (
                      <div className="flex items-center justify-between">
                        <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">
                          {detalhesSessao[s.id].length} aluno{detalhesSessao[s.id].length !== 1 ? 's' : ''}
                        </p>
                        <button
                          onClick={() => setModoEdicaoSessao(modoEdicaoSessao === s.id ? null : s.id)}
                          className={`flex items-center gap-1.5 text-[9px] font-black uppercase px-3 py-1.5 rounded-lg border transition-all ${
                            modoEdicaoSessao === s.id
                              ? 'bg-amber-100 border-amber-300 text-amber-700'
                              : 'border-slate-200 text-slate-500 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700'
                          }`}>
                          <Edit3 size={10}/>
                          {modoEdicaoSessao === s.id ? 'Sair da edição' : 'Corrigir Presenças'}
                        </button>
                      </div>
                    )}

                    {!detalhesSessao[s.id] ? (
                      <p className="text-xs text-slate-400">Carregando...</p>
                    ) : detalhesSessao[s.id].length === 0 ? (
                      <p className="text-xs text-slate-400">Nenhum registro encontrado.</p>
                    ) : modoEdicaoSessao === s.id ? (
                      <div className="space-y-1.5">
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-2">
                          <Edit3 size={11} className="text-amber-600 shrink-0"/>
                          <p className="text-[10px] font-black text-amber-700">Modo edição — clique no status para alterar. Salva automaticamente.</p>
                        </div>
                        {detalhesSessao[s.id].map((r: any) => {
                          const isSaving = salvandoRegistro === r.id;
                          const statuses = [
                            { key: 'Presente',         label: 'Presente',    cls: 'bg-green-500 text-white border-green-500',   idle: 'border-slate-200 text-slate-400 hover:border-green-400 hover:bg-green-50 hover:text-green-700' },
                            { key: 'Falta',            label: 'Falta',       cls: 'bg-red-500 text-white border-red-500',       idle: 'border-slate-200 text-slate-400 hover:border-red-400 hover:bg-red-50 hover:text-red-600' },
                            { key: 'Falta Justificada',label: 'Justificada', cls: 'bg-amber-500 text-white border-amber-500',   idle: 'border-slate-200 text-slate-400 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-600' },
                            { key: 'Isento',           label: 'Isento',      cls: 'bg-slate-400 text-white border-slate-400',   idle: 'border-slate-200 text-slate-400 hover:border-slate-400 hover:bg-slate-100' },
                          ];
                          return (
                            <div key={r.id} className={`flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-slate-100 shadow-sm ${isSaving ? 'opacity-50' : ''}`}>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-slate-800 truncate">{r.aluno_nome || r.aluno_id}</p>
                              </div>
                              <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                                {statuses.map(st => (
                                  <button key={st.key}
                                    disabled={isSaving || r.descricao === st.key}
                                    onClick={() => editarRegistro(s.id, r.id, st.key)}
                                    className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-lg border transition-all ${
                                      r.descricao === st.key ? st.cls : st.idle
                                    } disabled:cursor-default`}>
                                    {st.label}
                                  </button>
                                ))}
                              </div>
                              {isSaving && <RefreshCw size={11} className="text-slate-400 animate-spin shrink-0"/>}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        {detalhesSessao[s.id].map((r: any) => {
                          const cor = r.descricao === 'Presente' ? 'bg-green-50 text-green-700 border-green-100'
                            : r.isento ? 'bg-slate-50 text-slate-500 border-slate-200'
                            : r.justificada ? 'bg-amber-50 text-amber-700 border-amber-100'
                            : 'bg-red-50 text-red-600 border-red-100';
                          const dot = r.descricao === 'Presente' ? 'bg-green-500'
                            : r.isento ? 'bg-slate-400'
                            : r.justificada ? 'bg-amber-400'
                            : 'bg-red-400';
                          return (
                            <div key={r.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border ${cor}`}>
                              <div className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                              <span className="truncate flex-1">{r.aluno_nome || r.aluno_id}</span>
                              <span className="shrink-0 text-[9px] uppercase">{r.descricao}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      </>)}

      {/* Modal Editar Sessão */}
      {sessaoEditando && (
        <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b">
              <div>
                <h3 className="font-black text-sm uppercase tracking-tight text-slate-800">Editar Lista de Presença</h3>
                <p className="text-[9px] font-black text-slate-400 uppercase mt-0.5">{sessaoEditando.turma_nome || '–'}</p>
              </div>
              <button onClick={() => setSessaoEditando(null)} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400"><X size={16}/></button>
            </div>
            <div className="p-5 space-y-3">
              {erroEdicao && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold rounded-xl px-4 py-2.5 uppercase tracking-wide">
                  ⚠ {erroEdicao}
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-500">Data da Aula *</label>
                <input type="date" value={formEdicao.data} onChange={e => setFormEdicao(p => ({ ...p, data: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-500">Tema da Aula *</label>
                <input type="text" value={formEdicao.tema_aula} onChange={e => setFormEdicao(p => ({ ...p, tema_aula: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-500">Conteúdo Abordado</label>
                <textarea value={formEdicao.conteudo_abordado} onChange={e => setFormEdicao(p => ({ ...p, conteudo_abordado: e.target.value }))}
                  rows={3} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setSessaoEditando(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-black text-xs uppercase hover:bg-slate-50">
                  Cancelar
                </button>
                <button onClick={salvarEdicao} disabled={salvandoEdicao}
                  className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl font-black text-xs uppercase hover:bg-amber-600 disabled:opacity-50">
                  {salvandoEdicao ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nova Lista de Presença */}
      {showModal && (
        <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-5 border-b shrink-0">
              <div>
                <h3 className="font-black text-sm uppercase tracking-tight text-slate-800">Nova Lista de Presença</h3>
                <p className="text-[9px] font-black text-slate-400 uppercase mt-0.5">
                  Etapa {etapa} de 2 — {etapa === 1 ? 'Dados da Aula' : 'Chamada dos Alunos'}
                </p>
              </div>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400"><X size={16}/></button>
            </div>

            <div className="flex px-5 pt-4 gap-2 shrink-0">
              {[1, 2].map(n => (
                <div key={n} className={`flex-1 h-1.5 rounded-full transition-colors ${etapa >= n ? 'bg-purple-600' : 'bg-slate-200'}`} />
              ))}
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              {erroModal && (
                <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold rounded-xl px-4 py-2.5 uppercase tracking-wide">
                  ⚠ {erroModal}
                </div>
              )}

              {etapa === 1 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-500">Turma *</label>
                      <select value={formSessao.turma_id} onChange={e => setFormSessao(p => ({ ...p, turma_id: e.target.value }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white">
                        <option value="">Selecione...</option>
                        {turmas.map(t => <option key={t.id} value={t.id}>{t.nome}{t.turno ? ` (${t.turno})` : ''}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-500">Data da Aula *</label>
                      <input type="date" value={formSessao.data} onChange={e => setFormSessao(p => ({ ...p, data: e.target.value }))}
                        className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 ${feriados[formSessao.data] ? 'border-amber-400 focus:ring-amber-400 bg-amber-50' : 'border-slate-200 focus:ring-purple-400'}`} />
                      {feriados[formSessao.data] && (
                        <p className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 mt-1">
                          <AlertTriangle size={11} className="shrink-0" />
                          Feriado: {feriados[formSessao.data]} — Confirme se houve aula neste dia.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-500">Tema da Aula *</label>
                    <input type="text" value={formSessao.tema_aula}
                      onChange={e => setFormSessao(p => ({ ...p, tema_aula: e.target.value }))}
                      placeholder="Ex: Introdução à Programação, Matemática Básica..."
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-500">Conteúdo Abordado</label>
                    <textarea value={formSessao.conteudo_abordado}
                      onChange={e => setFormSessao(p => ({ ...p, conteudo_abordado: e.target.value }))}
                      placeholder="Descreva os tópicos, atividades e exercícios realizados na aula..."
                      rows={4}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <button onClick={avancarParaChamada} disabled={carregandoAlunos}
                      className="w-full bg-purple-600 text-white py-2.5 rounded-xl font-black text-xs uppercase hover:bg-purple-700 disabled:opacity-50">
                      {carregandoAlunos ? 'Carregando alunos...' : 'Iniciar Chamada →'}
                    </button>
                    {podeIncluir && (
                      <button onClick={gerarLinkChamada}
                        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-black text-xs uppercase border transition-all ${
                          linkCopiado
                            ? 'bg-green-50 border-green-300 text-green-700'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600'
                        }`}>
                        {linkCopiado
                          ? <><Check size={13}/> Link copiado!</>
                          : <><Smartphone size={13}/> <Copy size={11}/> Abrir Chamada no Celular</>}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {etapa === 2 && (
                <div className="space-y-3">
                  <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 text-xs space-y-0.5">
                    <p className="font-black text-purple-700 uppercase text-[10px]">{turmas.find(t => t.id === formSessao.turma_id)?.nome} · {fmtData(formSessao.data)}</p>
                    <p className="text-slate-600"><span className="font-black">Tema:</span> {formSessao.tema_aula}</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <span className="bg-green-100 text-green-700 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">{presentes} pres.</span>
                      <span className="bg-red-100 text-red-600 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">{ausentes} aus.</span>
                      {justificados > 0 && <span className="bg-amber-100 text-amber-600 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">{justificados} justif.</span>}
                      {isentos > 0 && <span className="bg-slate-100 text-slate-500 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">{isentos} isentos</span>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setPresenca(Object.fromEntries(alunosSessao.map(a => [a.id, true])))}
                        className="flex items-center gap-1 text-[9px] font-black uppercase text-green-600 border border-green-200 px-2.5 py-1 rounded-lg hover:bg-green-50">
                        <CheckSquare size={10}/> Todos Presentes
                      </button>
                      <button onClick={() => setPresenca(Object.fromEntries(alunosSessao.map(a => [a.id, false])))}
                        className="flex items-center gap-1 text-[9px] font-black uppercase text-red-500 border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-50">
                        <Square size={10}/> Todos Ausentes
                      </button>
                    </div>
                  </div>

                  <div className="border border-slate-100 rounded-2xl overflow-hidden divide-y divide-slate-50">
                    {alunosSessao.map((a, i) => {
                      const exempto = isento[a.id] ?? false;
                      const justif  = justificada[a.id] ?? false;
                      const presente = presenca[a.id] ?? true;
                      const especial = exempto || justif;
                      return (
                        <div key={a.id}
                          className={`w-full flex items-center gap-2 px-4 py-2.5 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'} ${especial ? 'opacity-60' : ''}`}>
                          <button type="button" disabled={especial}
                            onClick={() => setPresenca(p => ({ ...p, [a.id]: !p[a.id] }))}
                            className={`shrink-0 w-7 h-7 rounded-lg border-2 flex items-center justify-center transition-all ${
                              especial ? 'bg-slate-100 border-slate-200' :
                              presente ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300'
                            }`}>
                            {!especial && presente && <CheckSquare size={13}/>}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-800 truncate">{a.nome_completo}</p>
                            <p className="text-[9px] text-slate-400">{a.numero_matricula || '–'}</p>
                          </div>
                          <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                            exempto  ? 'bg-slate-100 text-slate-400' :
                            justif   ? 'bg-amber-100 text-amber-600' :
                            presente ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                          }`}>
                            {exempto ? 'Isento' : justif ? 'Justificada' : presente ? 'Presente' : 'Ausente'}
                          </span>
                          <button type="button"
                            onClick={() => { setJustificada(p => ({ ...p, [a.id]: !p[a.id] })); if (!justif) setIsento(p => ({ ...p, [a.id]: false })); }}
                            className={`shrink-0 text-[8px] font-black uppercase px-2 py-0.5 rounded-full border transition-all ${
                              justif
                                ? 'bg-amber-200 border-amber-300 text-amber-700'
                                : 'border-slate-200 text-slate-400 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600'
                            }`}
                            title="Falta com justificativa">
                            {justif ? '✕ justif.' : 'justif.'}
                          </button>
                          <button type="button"
                            onClick={() => { setIsento(p => ({ ...p, [a.id]: !p[a.id] })); if (!exempto) setJustificada(p => ({ ...p, [a.id]: false })); }}
                            className={`shrink-0 text-[8px] font-black uppercase px-2 py-0.5 rounded-full border transition-all ${
                              exempto
                                ? 'bg-slate-200 border-slate-300 text-slate-600'
                                : 'border-slate-200 text-slate-400 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-600'
                            }`}
                            title="Isento — aluno ainda não era matriculado nesta data">
                            {exempto ? '✕ isento' : 'isento'}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setEtapa(1)}
                      className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-black text-xs uppercase hover:bg-slate-50">
                      ← Voltar
                    </button>
                    <button onClick={salvarLista} disabled={salvando}
                      className="flex-1 bg-purple-600 text-white py-2.5 rounded-xl font-black text-xs uppercase hover:bg-purple-700 disabled:opacity-50">
                      {salvando ? 'Salvando...' : 'Confirmar Presença'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
