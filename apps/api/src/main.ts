import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Module, ValidationPipe } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController, AuthGuard } from './auth';
import { PmsController } from './pms';
import { FiscalController } from './fiscal';
import { ExpensesController } from './expenses';
import { SalesController } from './sales';
import { PurchasesController } from './purchases';
import { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { IdempotencyInterceptor } from './idempotency';

@Module({ imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'development-only-change-me', signOptions: { expiresIn: '12h' } })], controllers: [AuthController, PmsController, FiscalController, SalesController, ExpensesController, PurchasesController], providers: [AuthGuard] })
class AppModule {}

async function main() {
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) throw new Error('JWT_SECRET insegura');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new IdempotencyInterceptor());
  const port = Number(process.env.PORT || process.env.API_PORT || 3000);
  const webRoot = resolve(__dirname, '../../web');
  if (process.env.PMS_DEV === 'true') {
    // Keep Vite's native ESM import when the API is compiled as CommonJS.
    const { createServer } = await (new Function('return import("vite")')()) as typeof import('vite');
    const vite = await createServer({ root: webRoot, configFile: resolve(webRoot, 'vite.config.ts'), server: { middlewareMode: true, hmr: { server: app.getHttpServer() } } });
    app.use((req: any, res: any, next: any) => req.path === '/api' || req.path.startsWith('/api/') ? next() : vite.middlewares(req, res, next));
    app.getHttpServer().on('close', () => { void vite.close(); });
  } else {
    const dist = resolve(webRoot, 'dist');
    if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Falta compilar la interfaz. Ejecutá npm run build antes de npm start.');
    app.useStaticAssets(dist);
    app.use((req: any, res: any, next: any) => {
      if (req.method !== 'GET' || req.path === '/api' || req.path.startsWith('/api/') || !req.accepts('html')) return next();
      res.sendFile(resolve(dist, 'index.html'));
    });
  }
  await app.listen(port, '0.0.0.0');
  console.log(`PMS: http://localhost:${port} · API: http://localhost:${port}/api`);
}
main().catch(error => { console.error(error); process.exit(1); });
