'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, Trash2, RefreshCw, FileText, BookOpen } from 'lucide-react';
import api from '@/services/api';
import { Turma, Aluno } from './_types';
import { TIPOS_DIARIO, fmtDate, Modal, FieldInput, FieldSelect } from './_shared';
import { escapeHtml } from '@/lib/utils';

// ── Local interfaces ──────────────────────────────────────────────────────────
interface DiarioEntry { id: string; tipo: string; titulo?: string; descricao?: string; aluno_id?: string; aluno_nome?: string; turma_id?: string; data: string; usuario_nome?: string; created_at: string; }

interface DiarioCabecalho {
  turma: { id: string; nome: string; turno?: string; ano?: string; cor?: string; curso_nome?: string; professor_nome?: string };
  alunos: { id: string; nome_completo: string; numero_matricula?: string; foto_url?: string;
    presencas: number; faltas: number; justificadas: number; isentos: number; total_aulas: number; pct_presenca: number | null }[];
  sessoes: { id: string; data: string; tema_aula?: string; conteudo_abordado?: string; usuario_nome?: string;
    presencas: Record<string, 'P' | 'F' | 'J' | 'I'> }[];
}

const fmtDataCurta = (d: string) => {
  if (!d) return '–';
  const dt = new Date(d.length <= 10 ? d + 'T12:00:00' : d);
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
};
const fmtDataExtenso = (d: string) => {
  if (!d) return '–';
  const dt = new Date(d.length <= 10 ? d + 'T12:00:00' : d);
  return dt.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
};

// ── Diário de Classe Sub-tab ──────────────────────────────────────────────────
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

// ── Main DiarioTab ────────────────────────────────────────────────────────────
export default function DiarioTab({ turmas, alunos }: { turmas: Turma[]; alunos: Aluno[] }) {
  const [registros, setRegistros] = useState<DiarioEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [form, setForm] = useState<Partial<DiarioEntry>>({ data: new Date().toISOString().slice(0,10) });
  const [subTab, setSubTab] = useState<'registros' | 'diario-classe'>('registros');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filtroTipo) params.tipo = filtroTipo;
      const r = await api.get('/academico/diario', { params });
      setRegistros(r.data);
    } catch {}
    setLoading(false);
  }, [filtroTipo]);
  useEffect(() => { load(); }, [load]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post('/academico/diario', form); setShowModal(false); setForm({ data: new Date().toISOString().slice(0,10) }); await load(); } catch {}
  };

  const deletar = async (id: string) => {
    if (!confirm('Excluir registro?')) return;
    try { await api.delete(`/academico/diario/${id}`); await load(); } catch {}
  };

  const corTipo: Record<string, string> = {
    'Avaliação':       'bg-blue-100 text-blue-700',
    'Lista de Chamada':'bg-green-100 text-green-700',
    'Incidente':       'bg-red-100 text-red-700',
    'Observação':      'bg-amber-100 text-amber-700',
    'Comunicado':      'bg-purple-100 text-purple-700',
  };

  return (
    <div className="space-y-4">
      <div className="flex bg-white border border-slate-100 shadow-sm rounded-2xl p-1.5 gap-1">
        {(['registros', 'diario-classe'] as const).map(id => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
              subTab === id ? 'bg-purple-600 text-white shadow' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}>
            {id === 'registros' ? 'Registros' : 'Diário de Classe'}
          </button>
        ))}
      </div>

      {subTab === 'diario-classe' && <DiarioDeClasseSubTab turmas={turmas} />}

      {subTab === 'registros' && (
        <>
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-black uppercase tracking-tight text-slate-800">Diário Acadêmico</h2>
              <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white">
                <option value="">Todos os tipos</option>
                {TIPOS_DIARIO.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <button onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-purple-600 text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase hover:bg-purple-700">
              <Plus size={14}/> Novo Registro
            </button>
          </div>

          <div className="space-y-2">
            {loading ? (
              <div className="py-16 text-center text-sm text-slate-400">Carregando...</div>
            ) : registros.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">Nenhum registro encontrado.</div>
            ) : registros.map(r => (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex gap-4 hover:shadow-md transition-shadow">
                <div className="shrink-0 flex flex-col items-center gap-1">
                  <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase ${corTipo[r.tipo] || 'bg-slate-100 text-slate-600'}`}>{r.tipo}</span>
                  <span className="text-[9px] text-slate-400 font-bold">{fmtDate(r.data)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  {r.titulo && <h4 className="font-black text-sm text-slate-800 leading-tight">{r.titulo}</h4>}
                  {r.descricao && <p className="text-xs text-slate-600 mt-0.5">{r.descricao}</p>}
                  {r.usuario_nome && <p className="text-[9px] text-slate-400 mt-1">Por: {r.usuario_nome}</p>}
                </div>
                <button onClick={() => deletar(r.id)} className="shrink-0 p-1.5 rounded-lg hover:bg-red-50 text-red-300 hover:text-red-500 transition-colors">
                  <Trash2 size={13}/>
                </button>
              </div>
            ))}
          </div>

          {showModal && (
            <Modal title="Novo Registro no Diário" onClose={() => { setShowModal(false); setForm({ data: new Date().toISOString().slice(0,10) }); }}>
              <form onSubmit={salvar} className="space-y-3">
                <FieldSelect label="Tipo" value={form.tipo ?? ''} onChange={v => setForm(p => ({ ...p, tipo: v }))} options={TIPOS_DIARIO} required />
                <FieldInput label="Data" type="date" value={form.data} onChange={v => setForm(p => ({ ...p, data: v }))} required />
                <FieldInput label="Título (opcional)" value={form.titulo} onChange={v => setForm(p => ({ ...p, titulo: v }))} />
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500">Descrição</label>
                  <textarea value={form.descricao ?? ''} onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))} rows={3}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none" />
                </div>
                {alunos.length > 0 && (
                  <FieldSelect label="Aluno (opcional)" value={form.aluno_id ?? ''} onChange={v => setForm(p => ({ ...p, aluno_id: v }))}
                    options={alunos.map(a => ({ value: a.id, label: a.nome_completo }))} />
                )}
                {turmas.length > 0 && (
                  <FieldSelect label="Turma (opcional)" value={form.turma_id ?? ''} onChange={v => setForm(p => ({ ...p, turma_id: v }))}
                    options={turmas.map(t => ({ value: t.id, label: t.nome }))} />
                )}
                <button type="submit" className="w-full bg-purple-600 text-white py-2.5 rounded-xl font-black text-xs uppercase">Salvar Registro</button>
              </form>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
