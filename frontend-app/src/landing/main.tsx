import { render } from 'preact'
import { LandingPage } from './LandingPage'
import './landing.css'

const root = document.getElementById('landing-root')
if (!root) throw new Error('#landing-root não encontrado')
render(<LandingPage />, root)
