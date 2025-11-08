import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
      bodyLimit: 50 * 1024 * 1024, // 50MB，放宽项目内容请求体大小
    }),
  );

  const configService = app.get(ConfigService);
  const cookieSecret = configService.get('COOKIE_SECRET') ?? 'dev-cookie-secret';

  await app.register(fastifyHelmet, { contentSecurityPolicy: false });
  await app.register(fastifyCookie, { secret: cookieSecret });
  await app.register(fastifyMultipart);

  app.setGlobalPrefix('api');
  
  // CORS 配置：支持 Cloudflare Tunnel 和其他配置的域名
  const corsOrigin = configService.get('CORS_ORIGIN');
  const corsOrigins = corsOrigin ? corsOrigin.split(',').map((o: string) => o.trim()).filter(Boolean) : [];
  const resolveHostname = (value: string) => {
    try {
      return new URL(value).hostname;
    } catch {
      // 最后一层兜底：去掉协议、路径，尽量获取 host
      return value.replace(/^https?:\/\//, '').split('/')[0];
    }
  };
  
  // 动态检查 origin，允许 trycloudflare.com 的所有子域名（用于内网穿透）
  const originCallback = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // 如果没有 origin（如同源请求），允许
    if (!origin) {
      callback(null, true);
      return;
    }

    const hostname = resolveHostname(origin);
    
    // 允许所有 trycloudflare.com 的子域名（Cloudflare Tunnel）
    if (hostname === 'trycloudflare.com' || hostname.endsWith('.trycloudflare.com')) {
      callback(null, origin);
      return;
    }
    
    // 如果配置了 CORS_ORIGIN，检查是否在允许列表中
    if (corsOrigins.length > 0) {
      const allowed = corsOrigins.some((allowedOrigin: string) => {
        if (allowedOrigin === origin) {
          return true;
        }

        return resolveHostname(allowedOrigin) === hostname;
      });
      callback(null, allowed ? origin : false);
      return;
    }
    
    // 如果没有配置 CORS_ORIGIN，允许所有来源（开发环境）
    callback(null, origin);
  };
  
  app.enableCors({
    origin: corsOrigins.length > 0 ? originCallback : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      forbidUnknownValues: false,
      skipMissingProperties: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('TAI API')
    .setDescription('Backend API for TAI')
    .setVersion('0.1.0')
    .addCookieAuth('access_token')
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, doc);

  const port = Number(process.env.PORT || configService.get('PORT') || 4000);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen({ port, host });
  // eslint-disable-next-line no-console
  console.log(`API listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  // eslint-disable-next-line no-console
  console.log('RunningHub key (startup check):', configService.get('RUNNINGHUB_API_KEY') ? 'loaded' : 'missing');
}

bootstrap();
