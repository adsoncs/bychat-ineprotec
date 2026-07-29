import re, sys, html

md = open(sys.argv[1], encoding='utf-8').read()

def inline(t):
    t = html.escape(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'<em>\1</em>', t)
    return t

out, i = [], 0
linhas = md.split('\n')
sumario = []

while i < len(linhas):
    l = linhas[i]

    if l.startswith('```'):
        bloco = []
        i += 1
        while i < len(linhas) and not linhas[i].startswith('```'):
            bloco.append(html.escape(linhas[i])); i += 1
        out.append('<pre>' + '\n'.join(bloco) + '</pre>')
        i += 1; continue

    if l.startswith('|') and i + 1 < len(linhas) and re.match(r'^\|[\s:|-]+\|$', linhas[i+1].strip()):
        cab = [c.strip() for c in l.strip().strip('|').split('|')]
        i += 2
        corpo = []
        while i < len(linhas) and linhas[i].startswith('|'):
            corpo.append([c.strip() for c in linhas[i].strip().strip('|').split('|')]); i += 1
        t = ['<table><thead><tr>'] + [f'<th>{inline(c)}</th>' for c in cab] + ['</tr></thead><tbody>']
        for r in corpo:
            t.append('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>')
        t.append('</tbody></table>')
        out.append(''.join(t)); continue

    m = re.match(r'^(#{1,4}) (.+)$', l)
    if m:
        n = len(m.group(1)); txt = m.group(2)
        if n == 1:
            i += 1; continue  # o H1 é a capa; repetir aqui gasta uma página
        slug = re.sub(r'[^a-z0-9]+', '-', txt.lower()).strip('-')
        # h2 abre página nova; h1 é a capa
        cls = ' class="quebra"' if n == 2 else ''
        out.append(f'<h{n} id="{slug}"{cls}>{inline(txt)}</h{n}>')
        if n == 2: sumario.append((slug, txt))
        i += 1; continue

    if l.strip() == '---':
        i += 1; continue

    if l.startswith('> '):
        bloco = []
        while i < len(linhas) and linhas[i].startswith('>'):
            bloco.append(linhas[i][2:] if len(linhas[i]) > 1 else ''); i += 1
        out.append('<blockquote>' + inline(' '.join(bloco)) + '</blockquote>'); continue

    if re.match(r'^(\d+)\. ', l):
        itens = []
        while i < len(linhas) and (re.match(r'^\d+\. ', linhas[i]) or linhas[i].startswith('   ')):
            if re.match(r'^\d+\. ', linhas[i]):
                itens.append(re.sub(r'^\d+\. ', '', linhas[i]))
            elif itens:
                itens[-1] += ' ' + linhas[i].strip()
            i += 1
        out.append('<ol>' + ''.join(f'<li>{inline(x)}</li>' for x in itens) + '</ol>'); continue

    if l.startswith('- '):
        itens = []
        while i < len(linhas) and (linhas[i].startswith('- ') or linhas[i].startswith('  ')):
            if linhas[i].startswith('- '): itens.append(linhas[i][2:])
            elif itens: itens[-1] += ' ' + linhas[i].strip()
            i += 1
        out.append('<ul>' + ''.join(f'<li>{inline(x)}</li>' for x in itens) + '</ul>'); continue

    if l.strip() == '':
        i += 1; continue

    par = [l]
    i += 1
    while i < len(linhas) and linhas[i].strip() and not re.match(r'^(#{1,4} |[-|>]|```|\d+\. )', linhas[i]):
        par.append(linhas[i]); i += 1
    out.append('<p>' + inline(' '.join(par)) + '</p>')

# Separa a introdução (antes do 1º H2) para ela dividir a página do sumário,
# em vez de ficar sozinha numa folha.
corte = next((k for k, b in enumerate(out) if '<h2' in b), len(out))
intro = '\n'.join(out[:corte])
corpo = '\n'.join(out[corte:])
indice = ''.join(f'<li><a href="#{s}">{html.escape(t)}</a></li>' for s, t in sumario)

print(f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Manual do ERP Acadêmico ByChat</title>
<style>
@page {{ size: A4; margin: 20mm 18mm 18mm; }}
* {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }}
body {{ font: 10.5pt/1.62 "DejaVu Sans", system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1f2430; margin: 0; }}
h1 {{ font-size: 27pt; line-height: 1.15; margin: 0 0 6pt; letter-spacing: -0.5pt; color: #0f1729; }}
h2 {{ font-size: 16pt; margin: 0 0 10pt; padding-bottom: 5pt; border-bottom: 2px solid #1d4ed8; color: #0f1729; }}
h3 {{ font-size: 12.5pt; margin: 17pt 0 5pt; color: #17233a; }}
h4 {{ font-size: 11pt; margin: 13pt 0 4pt; color: #33415c; }}
h2.quebra {{ page-break-before: always; }}
p {{ margin: 0 0 8pt; text-align: justify; hyphens: auto; }}
ul, ol {{ margin: 0 0 9pt; padding-left: 17pt; }}
li {{ margin-bottom: 4pt; }}
code {{ font-family: "DejaVu Sans Mono", ui-monospace, monospace; font-size: 9pt; background: #eef1f6; padding: 1pt 3pt; border-radius: 2pt; color: #16305c; }}
pre {{ font-family: "DejaVu Sans Mono", monospace; font-size: 8.6pt; line-height: 1.45; background: #0f1729; color: #dfe6f2; padding: 9pt 11pt; border-radius: 4pt; overflow-wrap: break-word; white-space: pre-wrap; page-break-inside: avoid; margin: 0 0 9pt; }}
pre code {{ background: none; color: inherit; padding: 0; }}
blockquote {{ margin: 0 0 9pt; padding: 8pt 11pt; background: #fff8e8; border-left: 3px solid #d99b1c; font-size: 9.8pt; page-break-inside: avoid; }}
table {{ width: 100%; border-collapse: collapse; margin: 0 0 10pt; font-size: 9.2pt; page-break-inside: avoid; }}
th {{ background: #1d4ed8; color: #fff; text-align: left; padding: 5pt 7pt; font-weight: 600; }}
td {{ padding: 5pt 7pt; border-bottom: 1px solid #dde3ec; vertical-align: top; }}
tr:nth-child(even) td {{ background: #f6f8fc; }}
strong {{ color: #0f1729; }}
.capa {{ page-break-after: always; padding-top: 58mm; }}
.capa .sub {{ font-size: 12.5pt; color: #52607a; margin-bottom: 26pt; }}
.capa .meta {{ font-size: 9.5pt; color: #6b7789; border-top: 1px solid #d6dde8; padding-top: 9pt; }}
.indice {{ page-break-after: always; }}
.indice h2.sem-quebra {{ page-break-before: avoid; }}
.indice h3 {{ margin-top: 20pt; }}
.indice ol {{ font-size: 10.5pt; columns: 1; }}
.indice a {{ color: #16305c; text-decoration: none; }}
</style></head><body>
<div class="capa">
  <h1>Manual do ERP Acadêmico</h1>
  <div class="sub">Guia de treinamento e referência operacional — ByChat</div>
  <div class="meta">
    INEPROTEC · Julho de 2026<br>
    45 telas do menu ERP · 109 modelos de dados · 308 endpoints administrativos
  </div>
</div>
<div class="indice">
  <h2 class="sem-quebra">Sobre este manual</h2>
  {intro}
  <h3>Sumário</h3>
  <ol>{indice}</ol>
</div>
{corpo}
</body></html>''')
