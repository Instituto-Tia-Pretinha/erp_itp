export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams
  return (
    <main style={{
      height: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 16,
    }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
        ITP<span style={{ color: "#f2b705" }}>_TEC</span>
      </h1>
      <p style={{ color: "#5b6068", fontSize: 13, margin: 0 }}>
        Console operacional da equipe de TI do Instituto Tia Pretinha.
      </p>
      {erro && (
        <p style={{ color: "#8f1620", fontSize: 12.5 }}>
          Falha no login ({erro}). Tente de novo.
        </p>
      )}
      <a
        href="/api/auth/login"
        style={{
          background: "#4c1d95", color: "#fff", textDecoration: "none",
          padding: "10px 20px", borderRadius: 4, fontSize: 14, fontWeight: 600,
        }}
      >
        Entrar com Microsoft
      </a>
    </main>
  );
}
