import http from 'node:http';

const targetHost = 'localhost';
const targetPort = 4504;
const listenPort = 4510;
const authorization = `Basic ${Buffer.from('admin:admin').toString('base64')}`;

const server = http.createServer((request, response) => {
  const headers = {
    ...request.headers,
    host: `${targetHost}:${targetPort}`,
    authorization,
    referer: `http://${targetHost}:${targetPort}/`,
  };

  const proxyRequest = http.request({
    hostname: targetHost,
    port: targetPort,
    method: request.method,
    path: request.url,
    headers,
  }, (proxyResponse) => {
    response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
    proxyResponse.pipe(response);
  });

  proxyRequest.on('error', (error) => {
    response.writeHead(502, { 'content-type': 'text/plain' });
    response.end(error.message);
  });

  request.pipe(proxyRequest);
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`AEM verification proxy listening on http://127.0.0.1:${listenPort}`);
});
