import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

/** Placeholder root component — the real phone/web client lands in a later task. */
const App = () => <div id="gtd-app">gtd</div>

const container = document.getElementById("root")
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
