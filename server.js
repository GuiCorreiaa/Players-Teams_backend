const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const parserRoutes = require('./src/routes/parser.js');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3002;

async function getPlayerPosition(playerName) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log(`🔍 Buscando dados para: ${playerName}`);
    const searchUrl = `https://www.sofascore.com/search?q=${encodeURIComponent(playerName)}`;
    await page.goto(searchUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.waitForTimeout(3000);

    // Procurar pelo primeiro resultado de jogador
    const playerLinkSelector = 'a[href*="/player/"]';
    await page.waitForSelector(playerLinkSelector, { timeout: 10000 });

    const playerData = await page.evaluate(() => {
      const playerLink = document.querySelector('a[href*="/player/"]');
      if (!playerLink) return null;

      // Extrair dados básicos do resultado da busca
      const container = playerLink.closest('[class*="search"]') || playerLink.parentElement;
      const nameElement = container.querySelector('[class*="name"]') || container.querySelector('strong') || playerLink;
      const teamElement = container.querySelector('[class*="team"]') || container.querySelector('[class*="club"]');
      const positionElement = container.querySelector('[class*="position"]');

      return {
        name: nameElement ? nameElement.textContent.trim() : 'N/A',
        team: teamElement ? teamElement.textContent.trim() : 'N/A',
        position: positionElement ? positionElement.textContent.trim() : 'N/A',
        url: playerLink.href
      };
    });

    // Navegar para a página do jogador para obter mais detalhes
    if (playerData && playerData.url) {
      await page.goto(playerData.url, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Extrair dados mais detalhados da página do jogador
      const detailedData = await page.evaluate(() => {
        const getData = (selectors) => {
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) return element.textContent.trim();
          }
          return 'N/A';
        };

        const name = getData([
          'h1[class*="player"]',
          '.player-name h1',
          'h1',
          '[data-testid="player-header-name"]'
        ]);

        const team = getData([
          '[class*="team-name"]',
          '[class*="club-name"]',
          '.team-info',
          '[data-testid="team-name"]'
        ]);

        const position = getData([
          '[class*="position"]',
          '.player-position',
          '[data-testid="position"]'
        ]);

        const shirtNumber = getData([
          '[class*="shirt"]',
          '[class*="number"]',
          '.player-number'
        ]);

        const country = getData([
          '[class*="country"]',
          '[class*="nationality"]',
          '.player-country img'
        ]);

        return { name, team, position, shirtNumber, country };
      });

      return {
        ...playerData,
        ...detailedData,
        success: true
      };
    }

    return playerData;

  } catch (error) {
    console.error('Erro ao buscar dados do jogador:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function capturePlayerHeatmap(playerName) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log(`🔥 Capturando heatmap para: ${playerName}`);
    const searchUrl = `https://www.sofascore.com/search?q=${encodeURIComponent(playerName)}`;
    await page.goto(searchUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await page.waitForTimeout(3000);

    // Clica no primeiro jogador
    const playerLink = await page.waitForSelector('a[href*="/player/"]', { timeout: 10000 });
    await playerLink.click();
    await page.waitForTimeout(5000);

    // Procura pelo heatmap
    const heatmapSelectors = [
      'text/Season heatmap',
      'span:has-text("Season heatmap")',
      'div:has-text("Season heatmap")',
      '[class*="heatmap"]'
    ];

    let heatmapFound = false;
    for (const selector of heatmapSelectors) {
      try {
        const element = await page.waitForSelector(selector, { timeout: 3000 });
        if (element) {
          console.log('🎯 Season heatmap encontrado, clicando...');
          await element.click();
          heatmapFound = true;
          await page.waitForTimeout(3000);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!heatmapFound) {
      console.log('🔍 Procurando heatmap por texto...');
      await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        const heatmapElement = elements.find(el =>
          el.textContent &&
          el.textContent.toLowerCase().includes('season heatmap')
        );
        if (heatmapElement) {
          heatmapElement.click();
        }
      });
      await page.waitForTimeout(3000);
    }

    // Captura o heatmap
    console.log('📸 Capturando screenshot do heatmap...');

    // Tentar capturar área específica do heatmap
    const heatmapContainerSelectors = [
      'canvas',
      '[class*="heatmap"]',
      '[class*="pitch"]',
      'svg'
    ];

    let screenshot;
    for (const selector of heatmapContainerSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          screenshot = await element.screenshot({ encoding: 'base64' });
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // Se não encontrou elemento específico, captura a página toda
    if (!screenshot) {
      screenshot = await page.screenshot({
        encoding: 'base64',
        fullPage: true
      });
    }

    return `data:image/png;base64,${screenshot}`;

  } catch (error) {
    console.error('Erro ao capturar heatmap:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function createDemoHeatmap(playerName) {
  const positions = [
    { x: 150, y: 100, intensity: 0.8 },
    { x: 200, y: 120, intensity: 0.6 },
    { x: 180, y: 80, intensity: 0.9 },
    { x: 220, y: 140, intensity: 0.7 },
    { x: 160, y: 160, intensity: 0.5 }
  ];

  const circles = positions.map((pos, i) => {
    const radius = pos.intensity * 20 + 10;
    const opacity = pos.intensity * 0.7 + 0.3;
    return `<circle cx="${pos.x}" cy="${pos.y}" r="${radius}" fill="rgba(34, 197, 94, ${opacity})" />`;
  }).join('');

  return `
    <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
      <!-- Campo de futebol -->
      <rect x="10" y="10" width="380" height="280" fill="#16a34a" stroke="#ffffff" stroke-width="2" rx="10" />

      <!-- Meio campo -->
      <line x1="200" y1="10" x2="200" y2="290" stroke="#ffffff" stroke-width="2" />
      <circle cx="200" cy="150" r="40" fill="none" stroke="#ffffff" stroke-width="2" />

      <!-- Áreas -->
      <rect x="10" y="80" width="60" height="140" fill="none" stroke="#ffffff" stroke-width="2" />
      <rect x="330" y="80" width="60" height="140" fill="none" stroke="#ffffff" stroke-width="2" />

      <!-- Heatmap -->
      <defs>
        <filter id="blur">
          <feGaussianBlur in="SourceGraphic" stdDeviation="8" />
        </filter>
      </defs>

      <g filter="url(#blur)">
        ${circles}
      </g>

      <!-- Título -->
      <text x="200" y="30" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="16" font-weight="bold">
        Heatmap: ${playerName}
      </text>

      <!-- Legenda -->
      <text x="20" y="270" fill="#ffffff" font-family="Arial" font-size="12">
        🔥 Zonas de maior atividade
      </text>
    </svg>
  `;
}

// Endpoint para buscar dados do jogador
app.post('/api/player-position', async (req, res) => {
  try {
    const { playerName } = req.body;

    if (!playerName) {
      return res.status(400).json({
        success: false,
        message: 'Nome do jogador é obrigatório'
      });
    }

    console.log(`📊 Iniciando busca por: ${playerName}`);

    // Temporariamente vamos simular os dados para evitar timeout do Sofascore
    const mockPlayerData = {
      name: playerName,
      team: 'Simulado',
      position: 'Meio-Campo',
      shirtNumber: '10',
      country: 'Brasil',
      url: `https://www.sofascore.com/player/${playerName.toLowerCase().replace(' ', '-')}`
    };

    res.json({
      success: true,
      data: mockPlayerData
    });

  } catch (error) {
    console.error('Erro na API:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Endpoint para capturar heatmap do jogador
app.post('/api/player-heatmap', async (req, res) => {
  try {
    const { playerName } = req.body;

    if (!playerName) {
      return res.status(400).json({
        success: false,
        message: 'Nome do jogador é obrigatório'
      });
    }

    console.log(`🔥 Iniciando captura de heatmap para: ${playerName}`);

    // Criar um heatmap SVG demonstrativo
    const heatmapSVG = createDemoHeatmap(playerName);
    const heatmapImage = `data:image/svg+xml;base64,${Buffer.from(heatmapSVG).toString('base64')}`;

    res.json({
      success: true,
      data: {
        playerName,
        heatmapImage
      }
    });

  } catch (error) {
    console.error('Erro na API de heatmap:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Rotas de parsing de IA
app.use('/api/parser', parserRoutes);

// Endpoint de health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'PlayerStats Backend rodando!' });
});

app.listen(PORT, () => {
  console.log(`🚀 PlayerStats Backend rodando na porta ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;