#!/usr/bin/env python3
"""
Gera src/components/emoji/emojis-pt.json a partir do emojibase-data (pt).

Por que um arquivo gerado, e não a dependência: o pacote inteiro tem 750 KB e
só precisamos de emoji + nome + palavras-chave + grupo + tons de pele. O JSON
enxuto fica versionado e é carregado só quando o seletor abre — replicar para
os tenants é copiar arquivo, sem npm install.

Corte de versão: só até Emoji 14. Os mais novos (15, 15.1, 16) ainda aparecem
como quadradinho em Windows 10 e Androids antigos — o WhatsApp Web desenha
emoji como imagem e não tem esse problema; nós usamos a fonte do sistema.

Uso:  npm pack emojibase-data@16 && tar xzf emojibase-data-*.tgz
      python3 scripts/gerar-emojis-pt.py package/pt/data.json
"""
import json, sys
VERSAO_MAX = 14
# Grupos do emojibase → abas do WhatsApp Web (sorrisos + pessoas viram uma só).
GRUPO = {0: 0, 1: 0, 3: 1, 4: 2, 6: 3, 5: 4, 7: 5, 8: 6, 9: 7}

dados = json.load(open(sys.argv[1], encoding='utf-8'))
saida = []
for e in sorted(dados, key=lambda x: x.get('order', 10**9)):
    g = e.get('group')
    if g not in GRUPO or float(e.get('version', 0)) > VERSAO_MAX:
        continue
    tons = [s['emoji'] for s in (e.get('skins') or [])
            if isinstance(s.get('tone'), int) and float(s.get('version', 0)) <= VERSAO_MAX]
    item = [e['emoji'], e['label'], ' '.join(e.get('tags') or []), GRUPO[g]]
    if len(tons) == 5:
        item.append(tons)
    saida.append(item)

destino = 'src/components/emoji/emojis-pt.json'
json.dump({'v': 1, 'fonte': 'emojibase-data pt', 'versaoMax': VERSAO_MAX, 'e': saida},
          open(destino, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'{len(saida)} emojis → {destino}')
