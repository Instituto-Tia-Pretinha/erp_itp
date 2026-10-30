/** @type {import('next').NextConfig} */
// build: 2026-04-26
const nextConfig = {
  transpilePackages: [],
  typescript: { ignoreBuildErrors: false },

  async redirects() {
    return [
      // URL pública sem expor o subdomínio interno itp.*
      { source: '/matricula', destination: '/inscricao', permanent: false },
    ];
  },

  // Proxy: o browser chama /backend-api/* → Next.js server repassa para localhost:3001/api/*
  // Elimina CORS e problemas de IP — funciona em qualquer máquina/rede
  async rewrites() {
    const backendUrl =
      process.env.BACKEND_INTERNAL_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'https://api.itp.institutotiapretinha.org'
        : 'http://localhost:3001');
    return [
      {
        source: '/backend-api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${backendUrl}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;