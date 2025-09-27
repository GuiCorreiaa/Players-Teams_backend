const express = require('express');
// const { parseWithAI, parseWithHybrid } = require('../services/aiParser.js');
const pythonParserService = require('../services/pythonParserService.js');

const router = express.Router();

// Endpoints de IA temporariamente desativados
// router.post('/ai', async (req, res) => { ... });
// router.post('/hybrid', async (req, res) => { ... });

// Endpoint para parsing com Python
router.post('/python', async (req, res) => {
  try {
    const { pastedText } = req.body;

    if (!pastedText) {
      return res.status(400).json({ error: 'pastedText é obrigatório' });
    }

    console.log('[API] Recebido request para parsing com Python');
    const result = await pythonParserService.parseWithPython(pastedText);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[API] Erro no parsing com Python:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao processar com Python',
      details: error.message
    });
  }
});

module.exports = router;