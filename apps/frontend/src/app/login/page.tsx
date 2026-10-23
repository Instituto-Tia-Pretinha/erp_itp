'use client';

import React, { useState, useEffect, Suspense } from 'react';
import {
  Lock, User, Loader2, 
  AlertCircle, ShieldCheck, Eye, EyeOff,
  ChevronRight, Sparkles
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [lembrar, setLembrar] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    // Recupera e-mail/matrícula lembrado
    const salvo = localStorage.getItem('itp_lembrar_email');
    if (salvo) { setEmail(salvo); setLembrar(true); }

    const params = new URLSearchParams(window.location.search);
    const erroSso = params.get('erro');
    if (erroSso === 'sso-sem-conta') {
      setError('Sua conta Microsoft ainda não tem acesso ao sistema. Sua solicitação foi enviada — aguarde a liberação.');
    } else if (erroSso === 'sso') {
      setError('Não foi possível entrar com a Microsoft. Tente novamente.');
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const isEmail = email.includes('@');

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...(isEmail ? { email: email.trim().toLowerCase() } : { matricula: email.trim().toUpperCase() }),
          password: password.trim(),
          lembrar: lembrar,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Credenciais inválidas.');
      }

      // Lembrar acesso
      if (lembrar) {
        localStorage.setItem('itp_lembrar_email', email.trim());
      } else {
        localStorage.removeItem('itp_lembrar_email');
      }

      const infoUsuario = data.usuario || data.user || data;
      if (infoUsuario) {
        localStorage.setItem('usuario', JSON.stringify(infoUsuario));
      }

      // Cookie httpOnly já foi definido pelo backend via Set-Cookie (credentials: 'include')
      // Se o usuário precisa trocar a senha, redireciona antes do dashboard
      if (data.deve_trocar_senha) {
        setTimeout(() => { window.location.href = '/trocar-senha'; }, 100);
      } else {
        const params = new URLSearchParams(window.location.search);
        const callbackUrl = params.get('callbackUrl');
        // "//outro.site" e "/\outro.site" começam com "/" mas saem do domínio: só aceita mesma origem.
        let dest = '/dashboard';
        if (callbackUrl?.startsWith('/')) {
          const alvo = new URL(callbackUrl, window.location.origin);
          if (alvo.origin === window.location.origin && !alvo.pathname.startsWith('/login')) {
            dest = alvo.pathname + alvo.search + alvo.hash;
          }
        }
        setTimeout(() => { window.location.href = dest; }, 100);
      }

    } catch (err: any) {
      setError(err.message || 'Erro de conexão com o servidor.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isMounted) return null;

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#FDFDFF] flex items-center justify-center p-4 sm:p-6 font-sans relative overflow-hidden">
      {/* Blobs decorativos */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-100/50 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-100/50 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-[480px] z-10">
        <div className="bg-white rounded-[28px] sm:rounded-[40px] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] overflow-hidden border border-slate-100">

          {/* Header */}
          <div className="bg-slate-900 px-8 py-10 sm:px-12 sm:py-12 text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 p-6 sm:p-8 opacity-10 rotate-12 text-white">
              <ShieldCheck size={120} className="sm:hidden" />
              <ShieldCheck size={160} className="hidden sm:block" />
            </div>
            <div className="relative z-10 flex flex-col items-center">
              <div className="bg-purple-600 p-3.5 sm:p-4 rounded-2xl shadow-xl mb-5 sm:mb-6">
                <Sparkles className="text-white" size={28} />
              </div>
              <h1 className="text-3xl sm:text-4xl font-black text-white uppercase italic tracking-tighter">
                SISTEMA<span className="text-purple-500">.ITP</span>
              </h1>
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] mt-3 bg-white/5 px-4 py-1.5 rounded-full border border-white/10">
                Instituto Tia Pretinha
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-8 sm:px-12 sm:py-10 space-y-6">
            {error && (
              <div className="p-3.5 sm:p-4 bg-rose-50 border-l-4 border-rose-500 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
                <AlertCircle className="text-rose-500 shrink-0" size={18} />
                <p className="text-rose-700 text-[10px] font-black uppercase leading-snug">{error}</p>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              {/* E-mail / Matrícula */}
              <div className="space-y-2 text-left">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-4 tracking-widest">E-mail ou Matrícula</label>
                <div className="relative group">
                  <User className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-purple-600 transition-colors" size={18} />
                  <input
                    type="text"
                    placeholder="exemplo@itp.org ou ITP-FUNC-..."
                    className="w-full pl-11 sm:pl-14 pr-4 sm:pr-6 py-4 sm:py-5 bg-slate-50 border-2 border-slate-50 rounded-[20px] sm:rounded-[24px] outline-none focus:border-purple-600 focus:bg-white transition-all text-slate-900 font-bold text-sm"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    autoCapitalize="none"
                    required
                  />
                </div>
              </div>

              {/* Senha */}
              <div className="space-y-2 text-left">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-4 tracking-widest">Senha de Acesso</label>
                <div className="relative group">
                  <Lock className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-purple-600 transition-colors" size={18} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="w-full pl-11 sm:pl-14 pr-12 sm:pr-14 py-4 sm:py-5 bg-slate-50 border-2 border-slate-50 rounded-[20px] sm:rounded-[24px] outline-none focus:border-purple-600 focus:bg-white transition-all text-slate-900 font-bold text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 sm:right-5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-purple-600 p-1 transition-colors">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Lembrar + Esqueci */}
              <div className="flex items-center justify-between px-1">
                <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                  <div
                    onClick={() => setLembrar(v => !v)}
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                      lembrar
                        ? 'bg-purple-600 border-purple-600'
                        : 'bg-white border-slate-300 group-hover:border-purple-400'
                    }`}
                  >
                    {lembrar && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500 group-hover:text-slate-700 transition-colors">Lembrar acesso</span>
                </label>

                <a href="/esqueci-senha" className="text-[11px] font-bold text-purple-600 hover:text-purple-800 hover:underline transition-colors">
                  Esqueci minha senha
                </a>
              </div>

              {/* Botão */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-purple-600 hover:bg-slate-900 text-white font-black py-4 sm:py-5 rounded-[20px] sm:rounded-[24px] flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-xl shadow-purple-600/20 uppercase text-xs tracking-widest group mt-2"
              >
                {isLoading ? <Loader2 className="animate-spin" size={22} /> : (
                  <>
                    Acessar Dashboard
                    <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform text-purple-300" />
                  </>
                )}
              </button>
            </form>

            <div className="flex items-center gap-3 pt-1">
              <div className="h-px flex-1 bg-slate-100" />
              <span className="text-[10px] font-black uppercase text-slate-300 tracking-widest">ou</span>
              <div className="h-px flex-1 bg-slate-100" />
            </div>

            <a
              href={`${API_BASE}/auth/microsoft`}
              className="w-full bg-white hover:bg-slate-50 border-2 border-slate-100 hover:border-slate-200 text-slate-700 font-black py-4 sm:py-5 rounded-[20px] sm:rounded-[24px] flex items-center justify-center gap-3 transition-all active:scale-[0.98] uppercase text-xs tracking-widest"
            >
              <svg width="18" height="18" viewBox="0 0 21 21">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Entrar com Microsoft
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-slate-400 mt-5 font-medium">
          © {new Date().getFullYear()} Instituto Tia Pretinha · Todos os direitos reservados
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FDFDFF]" />}>
      <LoginForm />
    </Suspense>
  );
}