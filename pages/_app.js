import { ThemeProvider } from 'next-themes'
import '../styles/globals.css'

export default function App({ Component, pageProps }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="light">
      <Component {...pageProps} />
    </ThemeProvider>
  )
}
