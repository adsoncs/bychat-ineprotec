import { render } from 'preact'
import { App } from './App'
import { Portal } from './Portal'
import { Entrar } from './Entrar'
import { Senha } from './Senha'
import { Documentos } from './Documentos'
import { Contrato } from './Contrato'
import './estilo.css'
import { iniciarAtendimento, emAtendimento } from './atendimento'
import { FaixaDoAtendimento } from './FaixaDoAtendimento'
import { Acessibilidade, aplicarPreferencias } from './Acessibilidade'

// Tamanho do texto e alto contraste escolhidos neste aparelho: antes do 1º desenho.
aplicarPreferencias()

// Inscrição assistida: antes de qualquer pedido ao servidor (atendimento.ts).
iniciarAtendimento()

// Roteamento mínimo: o formulário público e as telas da área logada moram na
// mesma aplicação, e um `switch` custa menos que um roteador no bundle.
const caminho = location.pathname.replace(/\/+$/, '')

// /candidato/<código> virou o login por código (o servidor já redireciona;
// isto cobre quem chegar aqui por cache ou sem passar pelo servidor).
if (caminho.startsWith('/candidato')) {
  const codigo = caminho.split('/')[2] || ''
  location.replace(codigo ? `/portal/login?codigo=${encodeURIComponent(codigo)}` : '/portal/login?modo=codigo')
}

// Telas do portal fora do formulário: mesma moldura e marca da inscrição.
// /portal e /portal/aluno são o mesmo portal único (Portal.tsx).
const tela = caminho === '/portal' || caminho === '/portal/aluno'
  ? <Portal />
  : caminho === '/portal/login'
  ? <Entrar />
  : caminho === '/portal/senha'
  ? <Senha />
  : caminho.endsWith('/documentos')
  ? <Documentos />
  : caminho.endsWith('/contrato')
    ? <Contrato />
    : <App />

render(tela, document.getElementById('app')!)

// Faixa do atendente: num nó próprio, antes da aplicação — as telas não mudam.
if (emAtendimento()) {
  const no = document.createElement('div')
  document.body.insertBefore(no, document.body.firstChild)
  render(<FaixaDoAtendimento />, no)
}

// Botão "Acessibilidade" (tamanho do texto, alto contraste): em todas as telas,
// num nó próprio no começo da página — é o primeiro item que o teclado alcança.
{
  const no = document.createElement('div')
  document.body.insertBefore(no, document.body.firstChild)
  render(<Acessibilidade />, no)
}
