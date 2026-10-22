// The browser side of 小天's generative UI: OpenUI's own chat component library and React renderer
// (github.com/thesysdev/openui, MIT), as window.OpenUI. genui.js mounts one card per message with mount().
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Renderer } from '@openuidev/react-lang'
// from the package's main entry: its genui-lib entry carries a second copy of the theme context
import { ThemeProvider, openuiChatLibrary } from '@openuidev/react-ui'

export const library = openuiChatLibrary

// 小天's chart colours (motion.css --c0…--c5), so charts read like the rest of the app
const PAL = {
  dark: ['#7b6cff', '#4aa3ff', '#34c9ab', '#ffb547', '#ff6f91', '#b39dff'],
  light: ['#5b47e6', '#2f86f0', '#16a88c', '#f29a1f', '#e8507a', '#9a7cf0'],
}
const themeOf = (mode) => {
  const p = PAL[mode] || PAL.dark
  return { defaultChartPalette: p, barChartPalette: p, lineChartPalette: p, areaChartPalette: p, pieChartPalette: p, radarChartPalette: p, radialChartPalette: p, horizontalBarChartPalette: p, fontBody: 'inherit', fontHeading: 'inherit' }
}

class Guard extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidUpdate(prev) { if (prev.code !== this.props.code && this.state.err) this.setState({ err: null }) }
  render() { return this.state.err ? React.createElement('div', { className: 'ou-bad' }, '这段界面没能画出来') : this.props.children }
}

function Card(p) {
  return React.createElement(ThemeProvider, { mode: p.mode, lightTheme: themeOf('light'), darkTheme: themeOf('dark') },
    React.createElement(Guard, { code: p.code },
      React.createElement(Renderer, {
        response: p.code, library, isStreaming: !!p.live,
        onAction: p.onAction, onStateUpdate: p.onState, initialState: p.initial,
        onParseResult: p.onParse, onError: p.onError,
      })))
}

/** Draws a card into el and keeps it: update(props) re-renders it in place (streaming, theme), unmount() frees it. */
export function mount(el, props) {
  const root = createRoot(el)
  let cur = props
  const draw = () => root.render(React.createElement(Card, cur))
  draw()
  return { update(p) { cur = { ...cur, ...p }; draw() }, unmount() { root.unmount() } }
}
