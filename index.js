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
// DOCUMENTACION - Renderizar markdown en raiz
// ============================================

// Renderizar documento markdown (debe ir al final para no conflictuar)
app.get('/:docName', (req, res, next) => {
  const docName = req.params.docName;
  const filePath = path.join(process.cwd(), `${docName}.md`);

  // Si no existe el archivo .md, pasar al siguiente handler (404)
  if (!fs.existsSync(filePath)) {
    return next();
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const htmlContent = marked(content);

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
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/">Inicio</a>
    <a href="/actuator">Actuator</a>
    <a href="/actuator/health">Health</a>
  </nav>
  ${htmlContent}
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
