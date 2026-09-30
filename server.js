/**
 * HEREMS_PLUS Production & Preview Server
 * Provides:
 *  - Static file serving for PWA assets with proper MIME types & caching
 *  - Multi-Provider Reverse-Proxy for 8 SMS Gateways:
 *      * AgooSMS (Ghana)
 *      * mNotify (Ghana)
 *      * Arkesel (Ghana)
 *      * Hubtel (Ghana)
 *      * Termii (West Africa)
 *      * SMS.to (Global)
 *      * Twilio (Global)
 *      * Africa's Talking (Pan-Africa)
 *  - Direct Client HTML file download (/api/client-file)
 *  - School SMS Relay endpoints (/api/sms/send, /api/sms/ping)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';
const ROOT_DIR = path.resolve(__dirname);

// AgooSMS default fallback credentials (updated with user's new live key)
const DEFAULT_AGOO_KEY = 'agoo_live_tBXvDCUW03eRHCTIAIjD_RQoqE-s31jZ';
const DEFAULT_AGOO_SENDER = 'AgooSMSUser';

// User's Live Arkesel credentials (integrated from dashboard)
const DEFAULT_ARKESEL_KEY = 'd0NUVHRISFloUVF4aXFXbUpnWnE';
const DEFAULT_ARKESEL_SENDER = 'HEREMS';
const ARKESEL_WEBHOOK_SECRET = '6511a3a8911eea4679e435b7edddc6ede0fdef15cad80afac74850';

// Proxy map for SMS provider gateways
const PROXY_MAP = {
  '/api/agoosms': 'api.agoosms.com',
  '/api/mnotify': 'api.mnotify.com',
  '/api/arkesel': 'sms.arkesel.com',
  '/api/hubtel': 'smsc.hubtel.com',
  '/api/termii': 'api.ng.termii.com',
  '/api/smsto': 'api.sms.to',
  '/api/twilio': 'api.twilio.com',
  '/api/africastalking': 'api.africastalking.com'
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, api-key, Authorization, Accept, X-School-Token',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(JSON.stringify(data));
}

function handleCorsPreflight(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, api-key, Authorization, Accept, X-School-Token',
    'Access-Control-Max-Age': '86400'
  });
  res.end();
}

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  timeout: 15000
});

function forwardProxyRequest(targetHost, targetPath, req, res) {
  let bodyBuf = [];
  req.on('data', chunk => bodyBuf.push(chunk));
  req.on('end', () => {
    const bodyData = Buffer.concat(bodyBuf);
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders['host'];
    delete forwardHeaders['connection'];
    delete forwardHeaders['content-length'];
    forwardHeaders['host'] = targetHost;
    // Ensure clean browser User-Agent so Cloudflare never blocks provider API calls
    if (!forwardHeaders['user-agent'] || forwardHeaders['user-agent'].includes('node') || forwardHeaders['user-agent'].includes('curl')) {
      forwardHeaders['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }
    // Default Arkesel credentials if not explicitly provided
    if (targetHost === 'sms.arkesel.com') {
      if (!forwardHeaders['api-key'] && !targetPath.includes('api_key=')) {
        forwardHeaders['api-key'] = DEFAULT_ARKESEL_KEY;
      }
    }
    // Default AgooSMS credentials if not explicitly provided
    if (targetHost === 'api.agoosms.com') {
      if (!forwardHeaders['x-api-key'] && !forwardHeaders['authorization']) {
        forwardHeaders['x-api-key'] = DEFAULT_AGOO_KEY;
      }
    }
    if (bodyData.length > 0) {
      forwardHeaders['content-length'] = bodyData.length;
    }

    const proxyReq = https.request({
      hostname: targetHost,
      port: 443,
      path: targetPath,
      method: req.method,
      headers: forwardHeaders,
      agent: httpsAgent,
      timeout: 15000
    }, (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      responseHeaders['Access-Control-Allow-Origin'] = '*';
      responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      responseHeaders['Access-Control-Allow-Headers'] = 'Content-Type, X-API-Key, api-key, Authorization, Accept, X-School-Token';
      responseHeaders['Cache-Control'] = 'no-cache';

      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('Gateway Timeout (15s)'));
    });

    proxyReq.on('error', (err) => {
      console.error(`[Proxy Error -> ${targetHost}]`, err.message);
      sendJson(res, 502, {
        success: false,
        error: { code: 'PROXY_GATEWAY_ERROR', message: `Could not reach ${targetHost}: ${err.message}` }
      });
    });

    if (bodyData.length > 0) {
      proxyReq.write(bodyData);
    }
    proxyReq.end();
  });
}

function callAgooSms(pathName, method, headers, postData) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(pathName, 'https://api.agoosms.com');
    const reqHeaders = {
      'Accept': 'application/json',
      'User-Agent': 'HEREMS_PLUS/1.81.0',
      'X-API-Key': headers['x-api-key'] || DEFAULT_AGOO_KEY,
      ...(headers['content-type'] ? { 'Content-Type': headers['content-type'] } : {})
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
      if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    }

    const req = https.request(targetUrl, {
      method: method,
      headers: reqHeaders,
      agent: httpsAgent,
      timeout: 15000
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          raw: raw,
          json: parsed
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Gateway Timeout (15s)'));
    });

    req.on('error', (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Handle CORS preflight for all endpoints
  if (req.method === 'OPTIONS') {
    handleCorsPreflight(res);
    return;
  }

  // 1. Special handling for AgooSMS POST /v1/sms/send (with sandbox retry logic)
  if (pathname === '/api/agoosms/v1/sms/send' && req.method === 'POST') {
    let bodyBuf = [];
    req.on('data', chunk => bodyBuf.push(chunk));
    req.on('end', async () => {
      try {
        const bodyStr = Buffer.concat(bodyBuf).toString('utf-8');
        let payload = {};
        try { payload = JSON.parse(bodyStr); } catch (e) {}

        const recipient = payload.to || '';
        const originalMsg = payload.message || '';
        const requestedSender = payload.senderId || payload.from || payload.sender || '';
        const isTest = (payload.kind === 'test') || /test\s+message/i.test(originalMsg);

        // For AgooSMSUser or test sandbox messages, AgooSMS requires "Hello from Agoo"
        let sendMsg = originalMsg;
        let sendSender = requestedSender || (isTest ? 'AgooSMSUser' : DEFAULT_AGOO_SENDER);
        if (sendSender === 'AgooSMSUser') {
          sendMsg = 'Hello from Agoo';
        }

        const agooPayload = {
          to: recipient,
          message: sendMsg,
          senderId: sendSender
        };

        const apiKey = req.headers['x-api-key'] || DEFAULT_AGOO_KEY;

        // Forward to AgooSMS
        let agooRes = await callAgooSms('/v1/sms/send', 'POST', {
          'x-api-key': apiKey,
          'content-type': 'application/json'
        }, JSON.stringify(agooPayload));

        // If sender was rejected with SENDER_ID_NOT_OWNED or SENDER_ID_NOT_APPROVED, and it was a test:
        if (!agooRes.json || agooRes.statusCode >= 400) {
          const errCode = (agooRes.json && agooRes.json.error && agooRes.json.error.code) || '';
          if (isTest && (errCode === 'SENDER_ID_NOT_OWNED' || errCode === 'SENDER_ID_NOT_APPROVED')) {
            console.log('[AgooSMS Proxy] Sender rejected for test SMS; retrying with sandbox AgooSMSUser...');
            const sandboxPayload = {
              to: recipient,
              message: 'Hello from Agoo',
              senderId: 'AgooSMSUser'
            };
            agooRes = await callAgooSms('/v1/sms/send', 'POST', {
              'x-api-key': apiKey,
              'content-type': 'application/json'
            }, JSON.stringify(sandboxPayload));
          }
        }

        // Return AgooSMS response with permissive CORS headers
        res.writeHead(agooRes.statusCode, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, api-key, Authorization, Accept, X-School-Token',
          'Cache-Control': 'no-cache'
        });
        res.end(agooRes.raw);
      } catch (err) {
        console.error('[AgooSMS Proxy Error]', err);
        sendJson(res, 502, {
          success: false,
          error: { code: 'PROXY_ERROR', message: 'Could not connect to AgooSMS: ' + err.message }
        });
      }
    });
    return;
  }

  // 2. Generic reverse proxy for all supported SMS gateways
  for (const [prefix, targetHost] of Object.entries(PROXY_MAP)) {
    if (pathname.startsWith(prefix + '/') || pathname === prefix) {
      const subPath = pathname.substring(prefix.length) || '/';
      const fullTargetPath = subPath + (parsedUrl.search || '');
      forwardProxyRequest(targetHost, fullTargetPath, req, res);
      return;
    }
  }

  // 2.5. Arkesel Webhook endpoint for delivery receipts and status notifications
  if (pathname === '/api/arkesel/webhook' || pathname === '/api/sms/webhook') {
    let bodyBuf = [];
    req.on('data', chunk => bodyBuf.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(bodyBuf).toString('utf-8');
      console.log('[Arkesel Webhook Received]', rawBody);
      sendJson(res, 200, {
        ok: true,
        status: 'RECEIVED',
        provider: 'Arkesel',
        timestamp: Date.now()
      });
    });
    return;
  }

  // 3. Direct Client File Download endpoint
  if (pathname === '/api/client-file') {
    const code = (parsedUrl.query.code || 'HER-2026').toUpperCase();
    const isTeacher = (parsedUrl.query.kind || '').toLowerCase() === 'teacher';
    const kindPrefix = isTeacher ? 'TEACHER' : 'SCHOOL';
    let filename = `HEREMS-${kindPrefix}-${code}-CLIENT.html`;
    if (code === 'HER-2026' || code.includes('HER')) {
      filename = `HEREMS-${kindPrefix}-HER-2026-CLIENT.html`;
    } else if (code === 'KRI-4799' || code.includes('KRI') || code.includes('KRS')) {
      filename = `HEREMS-${kindPrefix}-KRI-4799-CLIENT.html`;
    }
    const clientFilePath = path.join(ROOT_DIR, filename);
    if (fs.existsSync(clientFilePath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      fs.createReadStream(clientFilePath).pipe(res);
      return;
    }

    // Dynamic generation if specific code file doesn't exist
    const indexPath = path.join(ROOT_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      try {
        const src = fs.readFileSync(indexPath, 'utf8');
        const schName = parsedUrl.query.name || `${code} School`;
        const logoMatch = src.match(/const APP_LOGO_URI='([^']+)'/);
        const appLogoUri = logoMatch ? logoMatch[1] : '';
        const loc = parsedUrl.query.location || 'Ghana';
        const addr = parsedUrl.query.address || (loc + ', Ghana');
        // Encrypted portal URL token (ghWrap of 'https://heremsplus.netlify.app')
        const portalUrl = 'gh$655e392a74276e224228286270327d4638292973247946243c7e33207d5a';
        const payloadObj = {
          school: {
            id: 'sch-' + code.toLowerCase().replace(/[^a-z0-9]/g, ''),
            code: code,
            name: schName,
            abbrev: code.split('-')[0] || 'SCH',
            location: loc,
            address: addr,
            portalUrl: portalUrl,
            status: 'active',
            joinCode: code,
            joinStatus: 'PENDING',
            joinActive: true,
            logo: appLogoUri,
            use_app_for_canteen: true
          }
        };
        const jsonStr = JSON.stringify(payloadObj);
        const encStr = jsonStr.split('').map(c => String.fromCharCode(c.charCodeAt(0) + 5)).join('');
        const b64 = Buffer.from(encStr).toString('base64');
        const pack = {
          app: 'HEREMS_PLUS',
          kind: isTeacher ? 'teacher-client' : 'school-client',
          v: 1,
          issued: Date.now(),
          schoolCode: code,
          schoolName: schName,
          payload: b64
        };
        const marker = '<script>window.__HP_CLIENT__=' + JSON.stringify(JSON.stringify(pack)).replace(/<\//g, '<\\/') + '</script>';
        const headMatch = src.match(/<head[^>]*>/i);
        const injected = headMatch ? src.slice(0, headMatch.index + headMatch[0].length) + '\n' + marker + '\n' + src.slice(headMatch.index + headMatch[0].length) : marker + '\n' + src;

        const outName = `HEREMS-${kindPrefix}-${code}-CLIENT.html`;
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${outName}"`,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        res.end(injected);
        return;
      } catch (err) {
        console.error('Dynamic client file generation error:', err);
      }
    }
  }

  // 4. School SMS Relay endpoints (for Round-343 server integration)
  if (pathname === '/api/sms/ping') {
    sendJson(res, 200, {
      ok: true,
      service: 'HEREMS_PLUS SMS Relay',
      configured: true,
      provider: 'AgooSMS',
      sender: DEFAULT_AGOO_SENDER,
      device: 'server-relay-primary',
      timestamp: Date.now()
    });
    return;
  }

  if (pathname === '/api/sms/send' && req.method === 'POST') {
    let bodyBuf = [];
    req.on('data', chunk => bodyBuf.push(chunk));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(Buffer.concat(bodyBuf).toString('utf-8') || '{}');
        const phone = payload.to || payload.phone || '';
        const message = payload.message || '';
        const sender = payload.sender || DEFAULT_AGOO_SENDER;

        const agooRes = await callAgooSms('/v1/sms/send', 'POST', {
          'x-api-key': req.headers['x-api-key'] || DEFAULT_AGOO_KEY,
          'content-type': 'application/json'
        }, JSON.stringify({
          to: phone,
          message: message,
          senderId: sender
        }));

        if (agooRes.statusCode === 200) {
          sendJson(res, 200, {
            ok: true,
            status: 'SENT',
            messageId: (agooRes.json && agooRes.json.data && agooRes.json.data.messageId) || 'sms-' + Date.now(),
            provider: 'AgooSMS',
            sender: sender
          });
        } else {
          sendJson(res, agooRes.statusCode, {
            ok: false,
            error: (agooRes.json && agooRes.json.error && agooRes.json.error.message) || 'AgooSMS rejected the message',
            code: (agooRes.json && agooRes.json.error && agooRes.json.error.code) || 'PROVIDER_REJECTED'
          });
        }
      } catch (err) {
        sendJson(res, 500, { ok: false, error: 'Server error: ' + err.message });
      }
    });
    return;
  }

  // 5. Static file server for PWA application
  let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') safePath = '/index.html';

  const filePath = path.join(ROOT_DIR, safePath);

  // Security check: ensure path is within ROOT_DIR
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA / PWA routing if file not found
      const indexPath = path.join(ROOT_DIR, 'index.html');
      fs.readFile(indexPath, (indexErr, content) => {
        if (indexErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, must-revalidate',
          'X-Frame-Options': 'ALLOWALL'
        });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Headers tailored for PWA, service worker, and iframe preview
    const headers = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    };

    if (ext === '.html' || ext === '.webmanifest') {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    } else if (ext === '.js' && path.basename(filePath) === 'sw.js') {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
      headers['Service-Worker-Allowed'] = '/';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    } else {
      headers['Cache-Control'] = 'public, max-age=3600';
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`HEREMS_PLUS Server running at http://${HOST}:${PORT}/`);
  console.log(`Document root: ${ROOT_DIR}`);
});
