#!/usr/bin/env python3
"""
Confere o contraste dos tokens de cor nos dois temas (WCAG 2.1).

Motivo: o tema claro nasceu redefinindo só parte dos tokens, e as cores de
estado ficaram com os valores calibrados para fundo escuro — `text-warning`
chegava a 1,99:1 sobre o fundo claro (o mínimo para texto é 4,5:1). Este
script existe para que isso não volte sem ninguém perceber.

Uso:  python3 scripts/contraste-tokens.py
Sai com código 1 se algum par reprovar.
"""
import math, re, sys, os

ARQ = os.path.join(os.path.dirname(__file__), '..', 'src', 'styles', 'tokens.css')
MIN_TEXTO = 4.5   # rótulos e texto pequeno
MIN_UI = 3.0      # bordas, anel de foco, ícones


def oklch_para_srgb(L, C, h):
    hr = math.radians(h)
    a, b = C * math.cos(hr), C * math.sin(hr)
    l_, m_, s_ = L + 0.3963377774*a + 0.2158037573*b, L - 0.1055613458*a - 0.0638541728*b, L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r = 4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    enc = lambda x: 12.92*x if x <= 0.0031308 else 1.055*x**(1/2.4) - 0.055
    return tuple(enc(max(0.0, min(1.0, v))) for v in (r, g, bb))


def luminancia(c):
    f = lambda x: x/12.92 if x <= 0.04045 else ((x+0.055)/1.055)**2.4
    r, g, b = (f(x) for x in c)
    return 0.2126*r + 0.7152*g + 0.0722*b


def contraste(c1, c2):
    a, b = luminancia(c1), luminancia(c2)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def tokens_do_bloco(css, inicio, fim=None):
    trecho = css[inicio:fim]
    achados = {}
    for nome, valor in re.findall(r'(--[a-z0-9-]+):\s*([^;]+);', trecho):
        achados[nome] = valor.strip()
    return achados


def resolver(nome, tema, base):
    """Segue var(--x) até chegar num oklch()."""
    visto = set()
    valor = tema.get(nome) or base.get(nome)
    while valor and valor.startswith('var(') and nome not in visto:
        visto.add(nome)
        nome = re.match(r'var\((--[a-z0-9-]+)\)', valor).group(1)
        valor = tema.get(nome) or base.get(nome)
    if not valor:
        return None
    m = re.match(r'oklch\(([\d.]+)%?\s+([\d.]+)\s+([\d.]+)', valor)
    if not m:
        return None
    L, C, h = float(m.group(1)), float(m.group(2)), float(m.group(3))
    if L > 1:  # notação em porcentagem
        L /= 100
    return oklch_para_srgb(L, C, h)


def main():
    css = open(ARQ, encoding='utf-8').read()
    corte = css.index("[data-theme='light']")
    escuro = tokens_do_bloco(css, 0, corte)
    claro = tokens_do_bloco(css, corte)

    superficies = ['--color-surface', '--color-surface-2', '--color-surface-3']
    # `fg-subtle` foi fundido em `fg-muted` (27/08): dois níveis de texto apagado
    # com 0,14 de luminosidade entre si não sobreviviam ao mínimo de contraste
    # sem virar o mesmo tom — melhor um nível só, legível.
    textos = [('--color-fg', MIN_TEXTO), ('--color-fg-muted', MIN_TEXTO),
              ('--color-accent', MIN_TEXTO), ('--color-success', MIN_TEXTO), ('--color-warning', MIN_TEXTO),
              ('--color-danger', MIN_TEXTO), ('--color-info', MIN_TEXTO), ('--color-ring', MIN_UI)]

    falhas = 0
    for rotulo, tema in (('escuro', {}), ('claro', claro)):
        print(f'\n── tema {rotulo} ' + '─' * 46)
        for token, minimo in textos:
            cor = resolver(token, tema, escuro)
            if cor is None:
                print(f'  {token:22s} não resolvido'); continue
            piores = []
            for sup in superficies:
                fundo = resolver(sup, tema, escuro)
                piores.append((contraste(cor, fundo), sup))
            pior, onde = min(piores)
            ok = pior >= minimo
            if not ok:
                falhas += 1
            print(f'  {token:22s} {pior:5.2f}:1 (mín {minimo}) sobre {onde.replace("--color-",""):11s} {"ok" if ok else "REPROVA"}')

    # Par especial: o texto do botão primário fica SOBRE o acento, não sobre a
    # superfície — se o acento muda de degrau, este par precisa acompanhar.
    print('\n── botão primário (texto sobre o acento) ' + '─' * 23)
    for rotulo, tema in (('escuro', {}), ('claro', claro)):
        acento = resolver('--color-accent', tema, escuro)
        texto = resolver('--color-fg-on-brand', tema, escuro)
        c = contraste(acento, texto)
        ok = c >= MIN_TEXTO
        if not ok:
            falhas += 1
        print(f'  tema {rotulo:7s} {c:16.2f}:1 (mín {MIN_TEXTO}) {"ok" if ok else "REPROVA"}')

    print()
    if falhas:
        print(f'{falhas} par(es) reprovando o contraste mínimo.')
        return 1
    print('Todos os pares passam nos dois temas.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
