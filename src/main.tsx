import { render } from "@solidjs/web"
import { App } from "./App"
import "virtual:uno.css"
import "./styles/index.css"
import "./app/register-service-worker"

render(() => <App />, document.getElementById("root")!)
