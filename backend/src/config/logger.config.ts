/**
 * Logger configuration for Fastify/Pino
 * Prevents sensitive data from being logged
 */

export const getLoggerConfig = (logLevel: string = 'info') => {
  const sanitizeSensitiveFields = (obj: any): any => {
    if (typeof obj !== 'object' || obj === null) return obj;

    const sensitiveFields = [
      'password',
      'secret',
      'token',
      'apiKey',
      'api_key',
      'accessKey',
      'access_key',
      'secretKey',
      'secret_key',
      'authorization',
      'Authorization',
      'cookie',
      'Cookie',
    ];

    const cloned = Array.isArray(obj) ? [...obj] : { ...obj };

    for (const key in cloned) {
      if (sensitiveFields.some((field) => key.toLowerCase().includes(field.toLowerCase()))) {
        cloned[key] = '***REDACTED***';
      } else if (typeof cloned[key] === 'object' && cloned[key] !== null) {
        cloned[key] = sanitizeSensitiveFields(cloned[key]);
      }
    }

    return cloned;
  };

  return {
    level: logLevel,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: false,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
    serializers: {
      req: (req: any) => {
        return {
          method: req.method,
          url: req.url,
          headers: sanitizeSensitiveFields(req.headers),
          query: req.query,
        };
      },
      res: (res: any) => {
        return {
          statusCode: res.statusCode,
          headers: sanitizeSensitiveFields(res.headers),
        };
      },
    },
    hooks: {
      logMethod: (args: any[]) => {
        // Sanitize all arguments before logging
        return args.map((arg) => {
          if (typeof arg === 'object' && arg !== null) {
            return sanitizeSensitiveFields(arg);
          }
          return arg;
        });
      },
    },
  };
};
