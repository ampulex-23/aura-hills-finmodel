import { createRoot } from 'react-dom/client'
import { Component, StrictMode, type ReactNode } from 'react'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import App from './App'
import './index.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace' }}>
          <h2>Ошибка рендера</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#c00' }}>
            {String(this.state.error?.stack ?? this.state.error)}
          </pre>
          <button onClick={() => { localStorage.clear(); location.reload() }}>
            Сбросить состояние и перезагрузить
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MantineProvider>
  </StrictMode>,
)
