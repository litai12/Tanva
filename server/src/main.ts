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
      bodyLimit: 20 * 1024 * 1024, // 20MB，允许更大的项目内容
    }),
  );

  const configService = app.get(ConfigService);
  const cookieSecret = configService.get('COOKIE_SECRET') ?? 'dev-cookie-secret';

  await app.register(fastifyHelmet, { contentSecurityPolicy: false });
  await app.register(fastifyCookie, { secret: cookieSecret });
  await app.register(fastifyMultipart);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: configService.get('CORS_ORIGIN')?.split(',') ?? true,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

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
}

bootstrap();
