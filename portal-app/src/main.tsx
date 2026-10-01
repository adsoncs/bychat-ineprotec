import { render } from 'preact'
import { App } from './App'
import { Aluno } from './Aluno'
import { Candidato } from './Candidato'
import { Inicio } from './Inicio'
import { Entrar } from './Entrar'
import { Senha } from './Senha'
import { Documentos } from './Documentos'
import { Contrato } from './Contrato'
import './estilo.css'

// Roteamento mínimo: o formulário público e as telas da área logada moram na
// mesma aplicação, e um `switch` custa menos que um roteador no bundle.
const caminho = location.pathname.replace(/\/+$/, '')
// Telas do portal fora do formulário: mesma moldura e marca da inscrição.
const tela = caminho === '/portal'
  ? <Inicio />
  : caminho === '/portal/login'
  ? <Entrar />
  : caminho === '/portal/senha'
  ? <Senha />
  : caminho.startsWith('/candidato')
  ? <Candidato />
  : caminho.endsWith('/documentos')
  ? <Documentos />
  : caminho.endsWith('/contrato')
    ? <Contrato />
    : caminho.endsWith('/aluno')
      ? <Aluno />
      : <App />

render(tela, document.getElementById('app')!)
