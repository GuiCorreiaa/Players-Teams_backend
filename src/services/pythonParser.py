#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Parser Definitivo - Analisa o formato real dos dados (LIMPO, SEM POLUIÇÃO)
"""

import re
import json
import sys
import io
import os

# Força UTF-8 no Windows
if os.name == 'nt':
    os.environ['PYTHONIOENCODING'] = 'utf-8'

sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def parse_stats_text(text):
    """Parser limpo sem valores artificiais"""
    lines = [line.strip() for line in text.split('\n') if line.strip()]

    # Remove duplicações consecutivas APENAS para linhas NÃO-numéricas
    # (números do histórico podem se repetir legitimamente: 2, 2, 3, 1, 1, 0)
    deduped_lines = []
    for line in lines:
        # Se for número puro, NUNCA deduplica
        if re.match(r'^\d+$', line):
            deduped_lines.append(line)
        # Para outras linhas, deduplica normalmente
        elif not deduped_lines or line != deduped_lines[-1]:
            deduped_lines.append(line)
    lines = deduped_lines

    results = []
    i = 0
    team_index = 0
    processed_teams = set()

    # print(f"[DEBUG] Total de linhas: {len(lines)}", file=sys.stderr)

    while i < len(lines):
        # Padrão: Time\nMercado (SEM duplicação Time\nTime)
        if (i + 1 < len(lines) and
            is_team_name(lines[i]) and
            is_market_line(lines[i+1])):

            team_name = lines[i]
            market = lines[i+1]

            team_key = f"{team_name}_{market}"

            # Evita duplicatas
            if team_key in processed_teams:
                # print(f"[DEBUG] Time {team_name} | {market} já processado - pulando", file=sys.stderr)
                i += 2
                while i < len(lines):
                    if (i + 1 < len(lines) and
                        is_team_name(lines[i]) and
                        is_market_line(lines[i+1])):
                        break
                    i += 1
                continue

            processed_teams.add(team_key)

            # Determina contexto APENAS quando acha time válido
            player_context = "home" if team_index % 2 == 0 else "away"
            team_index += 1

            # print(f"[DEBUG] Time: {team_name} | {market} | Contexto: {player_context}", file=sys.stderr)

            i += 2  # Pula Time + Mercado

            # Verifica "No players match criteria"
            if i < len(lines) and 'No players match criteria' in lines[i]:
                # print(f"[DEBUG] Sem jogadores - pulando", file=sys.stderr)
                i += 1
                continue

            # Processa jogadores
            while i < len(lines):
                # Para quando encontrar próximo time
                if (i + 1 < len(lines) and
                    is_team_name(lines[i]) and
                    is_market_line(lines[i+1])):
                    break

                # Nome de jogador
                if is_valid_player_name(lines[i]):
                    player_name = lines[i]
                    # print(f"[DEBUG] Jogador: '{player_name}'", file=sys.stderr)
                    i += 1

                    # Verifica nome abreviado
                    abbreviated_name = None
                    if i < len(lines):
                        next_line = lines[i]

                        # Não considera abreviado se contém nome do time
                        if team_name not in next_line and (is_abbreviated_name(next_line) or looks_like_abbreviated_name(next_line)):
                            abbreviated_name = next_line
                            if team_name in abbreviated_name:
                                abbreviated_name = abbreviated_name.replace(team_name, '').strip()
                            # print(f"[DEBUG] Abreviado: '{abbreviated_name}'", file=sys.stderr)
                            i += 1

                    # Extrai dados do jogador (LIMPO)
                    player_data = extract_full_player_data(lines, i, team_name, market, player_name, abbreviated_name)
                    player_data["playerContext"] = player_context
                    results.append(player_data)

                    # Avança
                    i = skip_player_data(lines, i)
                else:
                    i += 1

        else:
            i += 1

    return results

def skip_player_data(lines, start):
    """Pula dados de um jogador"""
    i = start

    # Pula linhas vazias e duplicações de time
    while i < len(lines) and (lines[i] == '' or lines[i] in ['%', '.00']):
        i += 1

    # Pula probabilidades (1+ 70%, 2+ 50%, etc)
    while i < len(lines):
        if re.match(r'^[1-4]\+$', lines[i]) and i + 1 < len(lines) and re.match(r'^\d+%$', lines[i+1]):
            i += 2
        elif re.match(r'^[1-4]\+\s*\d+%$', lines[i]):
            i += 1
        else:
            break

    # Pula histórico (números)
    while i < len(lines) and re.match(r'^\d+$', lines[i]):
        i += 1

    # Pula minutos
    while i < len(lines) and re.match(r'^\d+\'$', lines[i]):
        i += 1

    # Pula posições
    while i < len(lines) and re.match(r'^[A-Z]{2,4}$', lines[i]):
        i += 1

    # Pula vazios
    while i < len(lines) and lines[i] == '':
        i += 1

    # Pula contexto (h/a)
    while i < len(lines) and lines[i] in ['h', 'a']:
        i += 1

    # Pula média
    if (i < len(lines) - 2 and
        lines[i] == 'avg' and
        lines[i+1] == 'total' and
        re.match(r'^\d+\.\d+$', lines[i+2])):
        i += 3

    # Pula odds
    while i < len(lines):
        if any(marker in lines[i] for marker in ['1+', '2+', '3+', 'Shots on Target', 'Fouls', 'Tackles', '-']):
            i += 1
        else:
            break

    return i

def extract_full_player_data(lines, start_idx, team_name, market, player_name, abbreviated_name):
    """Extrai dados SEM inventar valores default"""
    i = start_idx

    # Pula vazios e duplicações
    while i < len(lines) and (lines[i] == '' or team_name in lines[i] or lines[i] in ['%', '.00']):
        i += 1

    # Probabilidades
    probabilities = {}
    while i < len(lines):
        m = re.match(r'^([1-4]\+)\s*(\d{1,3})%$', lines[i])
        if m:
            probabilities[m.group(1)] = m.group(2) + "%"
            i += 1
        elif i < len(lines) - 1 and re.match(r'^[1-4]\+$', lines[i]) and re.match(r'^\d+%$', lines[i+1]):
            probabilities[lines[i]] = lines[i+1]
            i += 2
        else:
            break

    # Histórico (até 10 valores consecutivos, flexível)
    history = []
    while i < len(lines) and len(history) < 10:
        line = lines[i].strip()

        # Aceita apenas inteiros puros (números do histórico)
        if re.match(r'^\d+$', line):
            history.append(int(line))
            i += 1
            continue

        # Se encontrou minuto (90', 45', etc.), sai do loop
        if re.match(r'^\d+\'$', line):
            break

        # Se encontrou linha vazia, pula
        if line == '':
            i += 1
            continue

        # Se encontrou outra coisa (odds, posições, etc.), encerra
        break

    # Minutos (formato: 90', 65', etc - sem limite rígido)
    minutes = []
    while i < len(lines) and re.match(r'^\d+\'$', lines[i]):
        minutes.append(lines[i])
        i += 1

    # Pula linhas vazias
    while i < len(lines) and lines[i] == '':
        i += 1

    # Posições (formato: ST, LCM, RDM, etc - sem limite rígido)
    positions = []
    while i < len(lines):
        line = lines[i]
        # Pula linhas vazias
        if line == '':
            i += 1
            continue
        # 2 a 4 letras maiúsculas, mas evita "TO" de "To Commit A Foul"
        if re.match(r'^[A-Z]{2,4}$', line) and line not in ['TO', 'A']:
            positions.append(line)
            i += 1
        else:
            break

    # Pula linhas vazias
    while i < len(lines) and lines[i] == '':
        i += 1

    # Contexto (h/a - sem limite rígido)
    context = []
    while i < len(lines) and lines[i] in ['h', 'a']:
        context.append(lines[i])
        i += 1

    # Média: calcula baseado no histórico real, não no texto
    if history:
        average = round(sum(history) / len(history), 2)
    else:
        average = None

    # Avança até encontrar seção de odds (pula "avg", "total", etc)
    while i < len(lines):
        if 'avg' in lines[i].lower() or 'total' in lines[i].lower() or re.match(r'^\d+\.\d+$', lines[i]):
            i += 1
        else:
            break

    # Odds (LIMPO - captura em múltiplos formatos)
    odds = {}
    odds_start = i

    # Busca por marcadores de mercado que indicam início das odds
    while i < len(lines) and i < odds_start + 30:
        # Procura por marcadores comuns de início da seção de odds
        if any(marker in lines[i] for marker in ['Shots on Target', 'Fouls Committed', 'To Commit A Foul', 'Tackles', 'Yellow Cards']):
            i += 1

            # Estratégia 1: Marcador seguido de odd na próxima linha (1+\n1.08)
            while i < len(lines):
                if re.match(r'^[1-5]\+$', lines[i]):
                    key = lines[i]  # 1+, 2+, 3+, 4+, 5+
                    i += 1
                    # Próxima linha deve ser a odd
                    if i < len(lines) and (re.match(r'^\d+\.\d{2}$', lines[i]) or lines[i] == '-'):
                        odds[key] = lines[i]
                        i += 1
                    else:
                        break
                else:
                    break

            # Se já encontrou odds, para
            if odds:
                break

            # Estratégia 2: Busca por sequência de odds sem marcadores explícitos
            # Procura por 3 ou mais valores decimais consecutivos (1.08, 1.44, 2.70)
            odds_sequence = []
            temp_i = i
            while temp_i < len(lines) and len(odds_sequence) < 5:
                if re.match(r'^\d+\.\d{2}$', lines[temp_i]) or lines[temp_i] == '-':
                    odds_sequence.append(lines[temp_i])
                    temp_i += 1
                else:
                    break

            # Se encontrou pelo menos 2 odds, assume que são 1+, 2+, 3+...
            if len(odds_sequence) >= 2:
                for idx, odd_value in enumerate(odds_sequence):
                    odds[f"{idx + 1}+"] = odd_value
                i = temp_i
                break

        else:
            i += 1

    return {
        "time": team_name,
        "estatistica": detect_market_type(market),
        "jogador": player_name,
        "abreviado": abbreviated_name,
        "probabilidades": probabilities,
        "historico": history,
        "minutos": minutes,
        "posicoes": positions,
        "contexto": context,
        "media": average,
        "odds": odds
    }

def is_team_name(text):
    """Verifica se é nome de time"""
    if len(text) < 3 or len(text) > 30:
        return False

    if not re.match(r'^[A-ZÀ-Ÿ]', text):
        return False

    if is_market_line(text):
        return False

    invalid_patterns = [
        r'^\d+[\+\%\']',
        r'^[A-Z]{2,4}$',
        r'^[ha]$',
    ]

    for pattern in invalid_patterns:
        if re.match(pattern, text):
            return False

    return True

def is_market_line(text):
    """Verifica se é mercado"""
    return any(market in text for market in [
        'Shots on Target',
        'Fouls Committed',
        'Tackles',
        'Yellow Cards',
        'Offsides'
    ])

def is_valid_player_name(text):
    """Verifica se é nome de jogador"""
    if len(text) < 3 or len(text) > 30:
        return False

    # Detecta times duplicados (BrentfordBrentford)
    if len(text) % 2 == 0:
        half = len(text) // 2
        if text[:half] == text[half:] and len(text[:half]) > 2:
            return False

    if not re.match(r'^[A-ZÀ-Ÿ]', text):
        return False

    invalid_patterns = [
        r'^\d+[\+\%\']',
        r'^[A-Z]{2,4}$',
        r'^[ha]$',
    ]

    invalid_words = [
        'avg', 'total', 'Shots on Target', 'Fouls Committed',
        'To Commit A Foul', '%', '.00', 'No players match criteria'
    ]

    for pattern in invalid_patterns:
        if re.match(pattern, text):
            return False

    if text in invalid_words:
        return False

    return True

def is_abbreviated_name(text):
    """Verifica se é nome abreviado"""
    pattern = r'^.{1}\. .+$'
    if not re.match(pattern, text):
        return False

    first_part = text.split()[0]
    if len(first_part) != 2 or not first_part.endswith('.'):
        return False

    parts = text.split()
    if len(parts) < 2:
        return False

    return True

def looks_like_abbreviated_name(text):
    """Fallback para detectar abreviados"""
    if not text or len(text) < 3:
        return False

    if '.' not in text[:3]:
        return False

    if ' ' not in text:
        return False

    parts = text.strip().split()
    if len(parts) < 2:
        return False

    if not parts[0].endswith('.'):
        return False

    if len(parts[0]) != 2:
        return False

    return True

def normalize_team(text):
    """Normaliza nomes de times"""
    trimmed = text.strip()
    half = len(trimmed) // 2
    first = trimmed[:half].strip()
    second = trimmed[half:].strip()

    if first == second and len(first) > 0:
        return first
    return trimmed

def detect_market_type(text):
    """Detecta tipo de mercado"""
    if 'Shots on Target' in text:
        return 'Shots on Target'
    if 'Fouls Committed' in text:
        return 'Fouls Committed'
    if 'Tackles' in text:
        return 'Tackles'
    if 'Yellow Cards' in text:
        return 'Yellow Cards'
    return text

if __name__ == "__main__":
    texto_input = sys.stdin.read()

    if not texto_input.strip():
        print(json.dumps({"error": "Nenhum texto fornecido"}, ensure_ascii=True))
        sys.exit(1)

    try:
        resultado = parse_stats_text(texto_input)
        print(json.dumps({
            "success": True,
            "players": resultado,
            "count": len(resultado)
        }, indent=2, ensure_ascii=True))
    except Exception as e:
        import traceback
        # print(f"[ERROR] Exception: {str(e)}", file=sys.stderr)
        # print(f"[ERROR] Traceback: {traceback.format_exc()}", file=sys.stderr)
        print(json.dumps({
            "success": False,
            "error": str(e)
        }, ensure_ascii=True))
        sys.exit(1)