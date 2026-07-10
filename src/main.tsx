import 'virtual:uno.css'
import './styles/index.css'
import './app/register-service-worker'
import { render } from '@solidjs/web'
import { App } from './App'

render(() => <App />, document.getElementById('root')!)
