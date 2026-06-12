export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'DayStream API',
    version: '0.1.0',
    description: 'DayStream booking and business management API',
  },
  servers: [
    { url: 'http://localhost:4001', description: 'Local development' },
  ],
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        description: 'Returns the current health status of the API server.',
        tags: ['System'],
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    version: { type: 'string', example: '0.1.0' },
                    uptime: { type: 'number', example: 12345, description: 'Uptime in seconds' },
                    timestamp: { type: 'string', example: '2026-06-11T12:00:00.000Z' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
