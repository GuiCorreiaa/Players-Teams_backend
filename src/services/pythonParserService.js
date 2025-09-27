const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

const pythonParserService = {
  parseWithPython: async (pastedText) => {
    const tempInputFile = path.join(__dirname, `temp_input_${Date.now()}.txt`);

    try {
      console.log('[PYTHON-SERVICE] Iniciando parsing com Python...');

      // Escrever o texto em um arquivo temporário
      await writeFile(tempInputFile, pastedText, 'utf8');

      const pythonScriptPath = path.join(__dirname, 'pythonParser.py');

      // Log do conteúdo para debug
      console.log('[PYTHON-SERVICE] Primeiras 500 caracteres do texto:', pastedText.substring(0, 500));
      console.log('[PYTHON-SERVICE] Total de caracteres:', pastedText.length);

      // Usar exec para executar o Python
      return new Promise((resolve, reject) => {
        const command = `python "${pythonScriptPath}" < "${tempInputFile}"`;

        exec(command, {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        }, async (error, stdout, stderr) => {
          // Limpar arquivo temporário
          try {
            await unlink(tempInputFile);
          } catch (e) {
            console.warn('[PYTHON-SERVICE] Erro ao deletar arquivo temporário:', e.message);
          }

          if (stderr) {
            console.log('[PYTHON-DEBUG]', stderr);
          }

          if (error) {
            console.error('[PYTHON-SERVICE] Python process exited with error:', error);
            reject(new Error(`Python parser falhou: ${error.message}`));
            return;
          }

          try {
            const result = JSON.parse(stdout);
            console.log('[PYTHON-SERVICE] Parsing concluído com sucesso');
            console.log('[PYTHON-SERVICE] Jogadores encontrados:', result.count || 0);
            resolve(result);
          } catch (parseError) {
            console.error('[PYTHON-SERVICE] Erro ao fazer parse do JSON:', parseError);
            console.error('[PYTHON-SERVICE] Output raw:', stdout);
            reject(new Error('Erro ao interpretar resposta do Python: ' + parseError.message));
          }
        });
      });

    } catch (error) {
      // Limpar arquivo temporário em caso de erro
      try {
        await unlink(tempInputFile);
      } catch (e) {
        // Ignorar erro de limpeza
      }
      throw error;
    }
  }
};

module.exports = pythonParserService;