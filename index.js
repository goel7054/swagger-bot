const express = require('express');
const cors = require('cors');
const YAML = require('yamljs');
const path = require('path');

const app = express();
app.use(cors());

// Adjust this if your YAML filename is different or in a subfolder
const swaggerFilePath = path.join(__dirname, 'api.yaml');

app.get('/swagger-info', (req, res) => {
  try {
    const swaggerDoc = YAML.load(swaggerFilePath);
    res.json(swaggerDoc);
  } catch (error) {
    console.error('Error loading Swagger YAML:', error.message);
    res.status(500).json({ error: 'Failed to load Swagger file' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
});
