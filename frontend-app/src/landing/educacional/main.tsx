import { render } from 'preact'
import { EducationalLandingPage } from './EducationalLandingPage'
import '../landing.css'

const root = document.getElementById('landing-root')
if (!root) throw new Error('#landing-root não encontrado')
render(<EducationalLandingPage />, root)
