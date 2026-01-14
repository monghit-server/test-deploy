const express = require('express');
const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
  res.json({
    mensaje: 'Hola desde GitHub Actions',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
