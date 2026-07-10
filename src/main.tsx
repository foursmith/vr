import 'virtual:uno.css'
import './styles/index.css'
import './app/register-service-worker'
import { render } from '@solidjs/web'
import { Root } from './components/App'

render(() => <Root />, document.getElementById('root')!)
