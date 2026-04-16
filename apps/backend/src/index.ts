import { createServer } from 'node:http';
import { runMigrations } from './state/migrations/runMigrations.js';
import { getDbPath } from './state/db.js';

const port = Number(process.env.PORT ?? 4000);

const appliedMigrations = runMigrations();

const sendJson = (res: import('node:http').ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
};

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.url === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'backend',
      time: new Date().toISOString(),
      dbPath: getDbPath(),
      appliedMigrations
    });
    return;
  }

  sendJson(res, 404, {
    status: 'not_found'
  });
});

server.listen(port, () => {
  console.log(`[backend] running at http://localhost:${port}`);
});
