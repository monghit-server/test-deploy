const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { marked } = require('marked');
const { version, name, description } = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;
const startTime = Date.now();

// ============================================
// HELPERS
// ============================================

function getGitInfo() {
  // Primero intentar leer git-info.json (generado en CI/CD)
  const gitInfoPath = path.join(process.cwd(), 'git-info.json');
  if (fs.existsSync(gitInfoPath)) {
    try {
      return JSON.parse(fs.readFileSync(gitInfoPath, 'utf8'));
    } catch (e) {
      // Si falla, continuar con git commands
    }
  }

  // Fallback: intentar obtener info de git en tiempo real
  try {
    const commitHash = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const commitShort = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const commitMessage = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();
    const commitAuthor = execSync('git log -1 --pretty=%an', { encoding: 'utf8' }).trim();
    const commitEmail = execSync('git log -1 --pretty=%ae', { encoding: 'utf8' }).trim();
    const commitDate = execSync('git log -1 --pretty=%ci', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();

    return {
      commit: {
        hash: commitHash,
        shortHash: commitShort,
        message: commitMessage,
        author: {
          name: commitAuthor,
          email: commitEmail
        },
        date: commitDate
      },
      branch
    };
  } catch (error) {
    return { error: 'Git info not available', message: error.message };
  }
}

function getMarkdownFiles() {
  return fs.readdirSync(process.cwd())
    .filter(file => file.endsWith('.md'))
    .map(file => ({
      name: file,
      path: `/${file.replace('.md', '')}`
    }));
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

// Filtrar variables de entorno sensibles
function filterEnv(env) {
  const sensitivePatterns = [
    /password/i, /secret/i, /token/i, /key/i, /credential/i,
    /auth/i, /private/i, /api_key/i, /apikey/i
  ];

  const filtered = {};
  for (const [key, value] of Object.entries(env)) {
    const isSensitive = sensitivePatterns.some(pattern => pattern.test(key));
    filtered[key] = isSensitive ? '******' : value;
  }
  return filtered;
}

// ============================================
// ENDPOINTS PRINCIPALES
// ============================================

// Raiz - Lista de documentos markdown
app.get('/', (req, res) => {
  const files = getMarkdownFiles();

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} - Documentacion</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
    .doc-list { list-style: none; padding: 0; }
    .doc-list li { margin: 10px 0; }
    .doc-list a { display: block; padding: 15px 20px; background: white; border-radius: 8px; text-decoration: none; color: #0066cc; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: transform 0.2s; }
    .doc-list a:hover { transform: translateX(5px); background: #f0f7ff; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 0.9em; }
    .footer a { color: #0066cc; margin-right: 15px; }
  </style>
</head>
<body>
  <h1>${name}</h1>
  <p>${description || ''}</p>
  <h2>Documentacion</h2>
  <ul class="doc-list">
    ${files.map(f => `<li><a href="${f.path}">${f.name}</a></li>`).join('\n    ')}
  </ul>
  <div class="footer">
    <p>v${version}</p>
    <a href="/actuator">Actuator</a>
    <a href="/actuator/health">Health</a>
    <a href="/actuator/info">Info</a>
  </div>
</body>
</html>`;

  res.type('html').send(html);
});

// ============================================
// ACTUATOR ENDPOINTS
// ============================================

// Indice de actuator - lista todos los endpoints disponibles
app.get('/actuator', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    _links: {
      self: { href: `${baseUrl}/actuator` },
      health: { href: `${baseUrl}/actuator/health` },
      info: { href: `${baseUrl}/actuator/info` },
      metrics: { href: `${baseUrl}/actuator/metrics` },
      env: { href: `${baseUrl}/actuator/env` }
    }
  });
});

// Health - Estado de salud de la aplicacion
app.get('/actuator/health', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const memoryUsedPercent = ((totalMemory - freeMemory) / totalMemory * 100).toFixed(1);

  // Determinar estado de salud
  const checks = {
    memory: memoryUsedPercent < 90,
    uptime: process.uptime() > 0
  };

  const status = Object.values(checks).every(v => v) ? 'UP' : 'DOWN';

  res.status(status === 'UP' ? 200 : 503).json({
    status,
    components: {
      diskSpace: {
        status: 'UP',
        details: {
          total: formatBytes(totalMemory),
          free: formatBytes(freeMemory),
          threshold: '10%'
        }
      },
      memory: {
        status: checks.memory ? 'UP' : 'DOWN',
        details: {
          used: `${memoryUsedPercent}%`,
          heap: formatBytes(memoryUsage.heapUsed),
          heapTotal: formatBytes(memoryUsage.heapTotal),
          rss: formatBytes(memoryUsage.rss)
        }
      },
      process: {
        status: 'UP',
        details: {
          uptime: formatUptime(process.uptime()),
          pid: process.pid
        }
      }
    }
  });
});

// Alias /health para compatibilidad
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: name,
    version: version
  });
});

// Info - Informacion de la aplicacion
app.get('/actuator/info', (req, res) => {
  res.json({
    app: {
      name,
      version,
      description: description || 'No description available'
    },
    git: getGitInfo(),
    build: {
      time: new Date(startTime).toISOString(),
      nodeVersion: process.version
    }
  });
});

// Metrics - Metricas del sistema
app.get('/actuator/metrics', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const cpus = os.cpus();
  const loadAvg = os.loadavg();

  // Calcular uso de CPU
  const cpuUsage = process.cpuUsage();

  res.json({
    names: [
      'process.uptime',
      'process.cpu.usage',
      'system.cpu.count',
      'system.cpu.load',
      'jvm.memory.used',
      'jvm.memory.max',
      'http.server.requests'
    ],
    measurements: {
      'process.uptime': {
        value: Math.floor(process.uptime()),
        unit: 'seconds',
        description: 'Process uptime'
      },
      'process.cpu.usage': {
        value: (cpuUsage.user + cpuUsage.system) / 1000000,
        unit: 'seconds',
        description: 'CPU time used by process'
      },
      'system.cpu.count': {
        value: cpus.length,
        unit: 'cores',
        description: 'Number of CPU cores'
      },
      'system.cpu.load': {
        value: loadAvg,
        unit: 'average',
        description: 'System load average [1m, 5m, 15m]'
      },
      'process.memory.heap.used': {
        value: memoryUsage.heapUsed,
        formatted: formatBytes(memoryUsage.heapUsed),
        unit: 'bytes',
        description: 'Heap memory used'
      },
      'process.memory.heap.total': {
        value: memoryUsage.heapTotal,
        formatted: formatBytes(memoryUsage.heapTotal),
        unit: 'bytes',
        description: 'Total heap memory'
      },
      'process.memory.rss': {
        value: memoryUsage.rss,
        formatted: formatBytes(memoryUsage.rss),
        unit: 'bytes',
        description: 'Resident set size'
      },
      'process.memory.external': {
        value: memoryUsage.external,
        formatted: formatBytes(memoryUsage.external),
        unit: 'bytes',
        description: 'External memory (C++ objects)'
      },
      'system.memory.total': {
        value: os.totalmem(),
        formatted: formatBytes(os.totalmem()),
        unit: 'bytes',
        description: 'Total system memory'
      },
      'system.memory.free': {
        value: os.freemem(),
        formatted: formatBytes(os.freemem()),
        unit: 'bytes',
        description: 'Free system memory'
      }
    }
  });
});

// Env - Variables de entorno
app.get('/actuator/env', (req, res) => {
  const filteredEnv = filterEnv(process.env);

  res.json({
    activeProfiles: [process.env.NODE_ENV || 'development'],
    propertySources: [
      {
        name: 'systemEnvironment',
        properties: Object.fromEntries(
          Object.entries(filteredEnv).map(([key, value]) => [
            key,
            { value, origin: 'System Environment' }
          ])
        )
      },
      {
        name: 'applicationConfig',
        properties: {
          'app.name': { value: name, origin: 'package.json' },
          'app.version': { value: version, origin: 'package.json' },
          'server.port': { value: PORT, origin: 'Environment / Default' }
        }
      }
    ]
  });
});

// ============================================
// DASHBOARD - Infografia visual del proyecto
// ============================================

app.get('/dashboard', async (req, res) => {
  const gitInfo = getGitInfo();
  const memoryUsage = process.memoryUsage();
  const files = getMarkdownFiles();
  const uptimeSeconds = process.uptime();

  // Construir HTML de git info
  let gitHtml = '<p style="color: #888;">Info de git no disponible</p>';
  if (gitInfo.commit) {
    const shortHash = gitInfo.commit.shortHash || (gitInfo.commit.hash ? gitInfo.commit.hash.substring(0,7) : 'N/A');
    const branch = gitInfo.branch || 'main';
    const message = gitInfo.commit.message || 'No message';
    const authorName = gitInfo.commit.author?.name || 'Unknown';
    const commitDate = gitInfo.commit.date || 'Unknown date';
    gitHtml = `
      <span class="commit-hash">${shortHash}</span>
      <span style="margin-left: 10px; color: #888;">${branch}</span>
      <div class="commit-message">${message}</div>
      <div class="meta">por ${authorName} • ${commitDate}</div>
    `;
  }

  // Construir HTML de documentos
  const docsHtml = files.map(f => `
    <a href="${f.path}" class="doc-item">
      <div class="icon">📄</div>
      <div class="name">${f.name}</div>
    </a>
  `).join('');

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - ${name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #fff;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }

    /* Header */
    .header {
      text-align: center;
      padding: 40px 20px;
      background: rgba(255,255,255,0.05);
      border-radius: 20px;
      margin-bottom: 30px;
      backdrop-filter: blur(10px);
    }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; }
    .header .version {
      display: inline-block;
      background: #0066cc;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.9em;
    }
    .header .description { color: #aaa; margin-top: 15px; }

    /* Grid */
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 20px; margin-bottom: 30px; }

    /* Cards */
    .card {
      background: rgba(255,255,255,0.08);
      border-radius: 15px;
      padding: 25px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .card h2 {
      font-size: 1.1em;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .card h2::before {
      content: '';
      width: 4px;
      height: 20px;
      background: #0066cc;
      border-radius: 2px;
    }

    /* Status */
    .status-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; }
    .status-item {
      background: rgba(0,0,0,0.2);
      padding: 15px;
      border-radius: 10px;
      text-align: center;
    }
    .status-item .value { font-size: 1.8em; font-weight: bold; color: #4ade80; }
    .status-item .label { font-size: 0.8em; color: #888; margin-top: 5px; }
    .status-item.warning .value { color: #fbbf24; }

    /* Git Info */
    .git-info { background: rgba(0,0,0,0.2); padding: 20px; border-radius: 10px; }
    .git-info .commit-hash {
      font-family: monospace;
      background: #0066cc;
      padding: 3px 10px;
      border-radius: 5px;
      font-size: 0.85em;
    }
    .git-info .commit-message {
      margin-top: 15px;
      padding: 15px;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      border-left: 3px solid #0066cc;
      font-style: italic;
    }
    .git-info .meta { color: #888; font-size: 0.85em; margin-top: 10px; }

    /* Endpoints */
    .endpoint-list { list-style: none; }
    .endpoint-list li {
      display: flex;
      align-items: center;
      padding: 12px 15px;
      background: rgba(0,0,0,0.2);
      margin-bottom: 8px;
      border-radius: 8px;
      transition: transform 0.2s;
    }
    .endpoint-list li:hover { transform: translateX(5px); background: rgba(0,102,204,0.2); }
    .endpoint-list .method {
      background: #4ade80;
      color: #000;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.75em;
      font-weight: bold;
      margin-right: 15px;
    }
    .endpoint-list .path { font-family: monospace; color: #fff; }
    .endpoint-list .desc { margin-left: auto; color: #888; font-size: 0.85em; }
    .endpoint-list a { text-decoration: none; color: inherit; display: flex; align-items: center; width: 100%; }

    /* Docs */
    .doc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; }
    .doc-item {
      background: rgba(0,0,0,0.2);
      padding: 20px;
      border-radius: 10px;
      text-align: center;
      transition: transform 0.2s, background 0.2s;
      text-decoration: none;
      color: #fff;
    }
    .doc-item:hover { transform: translateY(-5px); background: rgba(0,102,204,0.3); }
    .doc-item .icon { font-size: 2em; margin-bottom: 10px; }
    .doc-item .name { font-size: 0.9em; }

    /* Architecture */
    .architecture {
      display: flex;
      justify-content: space-around;
      align-items: center;
      flex-wrap: wrap;
      gap: 20px;
      padding: 20px;
    }
    .arch-box {
      background: rgba(0,0,0,0.3);
      padding: 20px 30px;
      border-radius: 10px;
      text-align: center;
      border: 2px solid rgba(255,255,255,0.1);
    }
    .arch-box.highlight { border-color: #0066cc; background: rgba(0,102,204,0.2); }
    .arch-box .icon { font-size: 1.5em; margin-bottom: 10px; }
    .arch-arrow { color: #0066cc; font-size: 1.5em; }

    /* Footer */
    .footer {
      text-align: center;
      padding: 30px;
      color: #666;
      font-size: 0.9em;
    }
    .footer a { color: #0066cc; text-decoration: none; margin: 0 10px; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>${name}</h1>
      <span class="version">v${version}</span>
      <p class="description">${description || 'Laboratorio de CI/CD con GitHub Actions'}</p>
    </div>

    <div class="grid">
      <!-- System Status -->
      <div class="card">
        <h2>Estado del Sistema</h2>
        <div class="status-grid">
          <div class="status-item">
            <div class="value">UP</div>
            <div class="label">Status</div>
          </div>
          <div class="status-item">
            <div class="value">${formatUptime(uptimeSeconds)}</div>
            <div class="label">Uptime</div>
          </div>
          <div class="status-item">
            <div class="value">${formatBytes(memoryUsage.heapUsed)}</div>
            <div class="label">Heap Used</div>
          </div>
          <div class="status-item">
            <div class="value">${process.version}</div>
            <div class="label">Node.js</div>
          </div>
        </div>
      </div>

      <!-- Git Info -->
      <div class="card">
        <h2>Ultimo Commit</h2>
        <div class="git-info">
          ${gitHtml}
        </div>
      </div>
    </div>

    <!-- Architecture -->
    <div class="card" style="margin-bottom: 30px;">
      <h2>Arquitectura</h2>
      <div class="architecture">
        <div class="arch-box">
          <div class="icon">👨‍💻</div>
          <div>Developer</div>
        </div>
        <div class="arch-arrow">→</div>
        <div class="arch-box">
          <div class="icon">📦</div>
          <div>GitHub</div>
        </div>
        <div class="arch-arrow">→</div>
        <div class="arch-box">
          <div class="icon">⚙️</div>
          <div>Actions</div>
        </div>
        <div class="arch-arrow">→</div>
        <div class="arch-box">
          <div class="icon">🐳</div>
          <div>Docker</div>
        </div>
        <div class="arch-arrow">→</div>
        <div class="arch-box highlight">
          <div class="icon">🚀</div>
          <div>Server</div>
        </div>
      </div>
    </div>

    <div class="grid">
      <!-- Endpoints -->
      <div class="card">
        <h2>API Endpoints</h2>
        <ul class="endpoint-list">
          <li><a href="/"><span class="method">GET</span><span class="path">/</span><span class="desc">Documentacion</span></a></li>
          <li><a href="/dashboard"><span class="method">GET</span><span class="path">/dashboard</span><span class="desc">Este panel</span></a></li>
          <li><a href="/health"><span class="method">GET</span><span class="path">/health</span><span class="desc">Health check</span></a></li>
          <li><a href="/actuator"><span class="method">GET</span><span class="path">/actuator</span><span class="desc">Indice Actuator</span></a></li>
          <li><a href="/actuator/health"><span class="method">GET</span><span class="path">/actuator/health</span><span class="desc">Estado detallado</span></a></li>
          <li><a href="/actuator/info"><span class="method">GET</span><span class="path">/actuator/info</span><span class="desc">Info app + git</span></a></li>
          <li><a href="/actuator/metrics"><span class="method">GET</span><span class="path">/actuator/metrics</span><span class="desc">Metricas</span></a></li>
          <li><a href="/actuator/env"><span class="method">GET</span><span class="path">/actuator/env</span><span class="desc">Variables entorno</span></a></li>
        </ul>
      </div>

      <!-- Documentation -->
      <div class="card">
        <h2>Documentacion</h2>
        <div class="doc-grid">
          ${docsHtml}
          <a href="/dashboard" class="doc-item" style="border: 2px dashed rgba(255,255,255,0.2);">
            <div class="icon">📊</div>
            <div class="name">Dashboard</div>
          </a>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>${name} v${version}</p>
      <p>
        <a href="/">Docs</a>
        <a href="/actuator">Actuator</a>
        <a href="/README">README</a>
        <a href="/CONTRIBUTING">Contributing</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  res.type('html').send(html);
});

// ============================================
// DOCUMENTACION - Renderizar markdown en raiz
// ============================================

// Post-procesar HTML para convertir bloques mermaid en divs renderizables
function processMermaidBlocks(html) {
  // Reemplazar <pre><code class="language-mermaid">...</code></pre> por <div class="mermaid">...</div>
  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (match, code) => `<div class="mermaid">${code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')}</div>`
  );
}

// Renderizar documento markdown (debe ir al final para no conflictuar)
app.get('/:docName', (req, res, next) => {
  const docName = req.params.docName;
  const filePath = path.join(process.cwd(), `${docName}.md`);

  // Si no existe el archivo .md, pasar al siguiente handler (404)
  if (!fs.existsSync(filePath)) {
    return next();
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const htmlContent = processMermaidBlocks(marked(content));

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${docName} - ${name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #333; }
    h1, h2, h3 { color: #1a1a1a; }
    h1 { border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
    h2 { border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-top: 30px; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: 'Monaco', 'Menlo', monospace; }
    pre { background: #2d2d2d; color: #f8f8f2; padding: 15px; border-radius: 8px; overflow-x: auto; }
    pre code { background: transparent; color: inherit; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
    th { background: #f5f5f5; }
    blockquote { border-left: 4px solid #0066cc; margin: 20px 0; padding: 10px 20px; background: #f9f9f9; }
    a { color: #0066cc; }
    .nav { margin-bottom: 20px; padding: 10px 0; border-bottom: 1px solid #eee; }
    .nav a { margin-right: 15px; text-decoration: none; }
    .nav a:hover { text-decoration: underline; }
    .mermaid { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/">Inicio</a>
    <a href="/actuator">Actuator</a>
    <a href="/actuator/health">Health</a>
  </nav>
  ${htmlContent}
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: true, theme: 'default' });</script>
</body>
</html>`;

  res.type('html').send(html);
});

// ============================================
// SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log(`Actuator disponible en http://localhost:${PORT}/actuator`);
});
