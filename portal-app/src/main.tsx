import { render } from 'preact'
import { App } from './App'
import { Aluno } from './Aluno'
import { Documentos } from './Documentos'
import { Contrato } from './Contrato'
import './estilo.css'

// Roteamento mínimo: o formulário público e as telas da área logada moram na
// mesma aplicação, e um `switch` custa menos que um roteador no bundle.
const caminho = location.pathname.replace(/\/+$/, '')
const tela = caminho.endsWith('/documentos')
  ? <Documentos />
  : caminho.endsWith('/contrato')
    ? <Contrato />
    : caminho.endsWith('/aluno')
      ? <Aluno />
      : <App />

render(tela, document.getElementById('app')!)
