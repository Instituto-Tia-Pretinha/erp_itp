import './common/suppress-known-warnings';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync } from 'fs';
import * as express from 'express';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';

const logger = new Logger('Bootstrap');

// Sem isso, um erro que escape de todo try/catch fora do ciclo de
// request (ex: código fora de um controller/service, rodando em
// background) derruba o processo com só um stack trace cru no stdout —
// sem passar pelo Logger do Nest, sem contexto estruturado. Loga
// explicitamente antes de sair (Node exige process.exit após
// uncaughtException — o processo fica em estado indefinido depois
// disso). Docker reinicia o container sozinho (unless-stopped).
// Achado na varredura de pontos cegos de erro, 2026-09-11.
process.on('uncaughtException', (err) => {
  logger.error(`💥 uncaughtException: ${err.message}`, err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason: any) => {
  logger.error(`💥 unhandledRejection: ${reason?.message ?? reason}`, reason?.stack);
  process.exit(1);
});

// 1. Função de Configuração Compartilhada
export const setupApp = async (app: NestExpressApplication) => {
  // ✅ Forma correta de usar o middleware em ambientes híbridos
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // body-parser só sabe descomprimir gzip/deflate — qualquer outro
  // Content-Encoding (ex: "br", enviado por bots/scanners, nunca pelo
  // próprio frontend) vira um erro cru (não é HttpException do Nest) que
  // cai no ExceptionsHandler genérico como 500 não tratado, virando ruído
  // de log ERROR pra uma requisição malformada do cliente. Responde 415
  // direto aqui, antes de chegar no handler genérico.
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.status === 415 && err?.type?.startsWith?.('encoding.')) {
      return res.status(415).json({ statusCode: 415, message: err.message });
    }
    next(err);
  });

  const cookieMiddleware = (cookieParser as any).default || cookieParser;
  app.use(cookieMiddleware());
  
  app.setGlobalPrefix('api');

  const publicDir = join(__dirname, '..', '..', 'public');
  if (existsSync(publicDir)) {
    app.useStaticAssets(publicDir);
  }

  const isDev = process.env.NODE_ENV !== 'production';

  app.enableCors({
    origin: isDev
      ? (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
          // Em dev, aceita localhost e qualquer IP da rede local (192.168.x.x, 10.x.x.x)
          if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.)/.test(origin)) {
            cb(null, true);
          } else {
            cb(new Error('CORS bloqueado: ' + origin), false);
          }
        }
      : [
          'https://itp.institutotiapretinha.org',
          'https://api.itp.institutotiapretinha.org',
          'https://institutotiapretinha.org',
        ],
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie', 'X-Requested-With'],
    exposedHeaders: ['Set-Cookie'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  return app;
};

// 2. Lógica para Servidor Local (npm run start:dev)
async function bootstrapLocal() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  await setupApp(app);
  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`🚀 SERVIDOR LOCAL ONLINE: http://localhost:${port}/api`);
}

// 3. Lógica para Handler Serverless (Vercel)
let cachedServer: any;

export default async function handler(req: any, res: any) {
  if (!cachedServer) {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    await setupApp(app);
    await app.init();
    cachedServer = app.getHttpAdapter().getInstance();
  }
  return cachedServer(req, res);
}

// Executa o servidor em qualquer ambiente exceto Vercel (Railway, Render, local, etc.)
if (!process.env.VERCEL) {
  bootstrapLocal();
}