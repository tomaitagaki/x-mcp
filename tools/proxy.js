import http from 'http';
import { request as httpRequest } from 'http';

const LOCAL_TARGET = 'http://127.0.0.1:3000';
const PORT = parseInt(process.env.PORT || '33801', 10);

const server = http.createServer((req, res) => {
  if (!req.url) { res.statusCode = 400; return res.end('Bad Request'); }
  const options = {
    hostname: '127.0.0.1',
    port: 3000,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };
  const proxyReq = httpRequest(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', (err) => {
    res.statusCode = 502;
    res.end('Proxy error: ' + err.message);
  });
  req.pipe(proxyReq, { end: true });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log();
});
