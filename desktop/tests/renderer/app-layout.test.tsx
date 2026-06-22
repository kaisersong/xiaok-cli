import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext'
import { AppLayout } from '../../renderer/src/layouts/AppLayout'

vi.mock('../../renderer/src/components/Sidebar', () => ({
  SidebarComponent: () => <aside data-testid="sidebar-component">sidebar</aside>,
}))

vi.mock('../../renderer/src/components/DesktopSettings', () => ({
  DesktopSettings: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="desktop-settings">
      <button type="button" onClick={onClose}>close settings</button>
    </div>
  ),
}))

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LocaleProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<div data-testid="outlet-content">content</div>} />
          </Route>
        </Routes>
      </LocaleProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AppLayout', () => {
  it('renders expanded titlebar controls in visual order and delegates browser history actions', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const forwardSpy = vi.spyOn(window.history, 'forward').mockImplementation(() => {})
    window.history.pushState({ test: 'titlebar-back-enabled' }, '', '#/titlebar-back-enabled')

    renderLayout()

    const titlebar = screen.getByTestId('desktop-titlebar')
    const titlebarButtons = within(titlebar).getAllByRole('button')
    const buttons = [
      screen.getByRole('button', { name: '后退' }),
      screen.getByRole('button', { name: '前进' }),
      screen.getByRole('button', { name: '收起侧边栏' }),
    ]

    expect(titlebarButtons).toEqual(buttons)
    expect(buttons.map((button) => button.getAttribute('title'))).toEqual(['后退', '前进', '收起侧边栏'])
    expect(buttons.map((button) => button.style.left)).toEqual(['132px', '164px', '196px'])
    expect(buttons.every((button) => button.style.width === '28px')).toBe(true)
    expect(buttons.every((button) => button.style.height === '28px')).toBe(true)
    expect(buttons.every((button) => button.dataset.appRegion === 'no-drag')).toBe(true)

    fireEvent.click(buttons[0])
    expect(backSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(buttons[1])
    expect(forwardSpy).toHaveBeenCalledTimes(1)
  })

  it('renders a sidebar-colored titlebar fill while the sidebar is expanded', () => {
    renderLayout()

    expect(screen.getByTestId('desktop-titlebar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-titlebar-fill')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-component')).toBeInTheDocument()
  })

  it('does not apply glass blur styling to the title bar', () => {
    renderLayout()

    const titlebar = screen.getByTestId('desktop-titlebar')
    expect(titlebar.style.backdropFilter).toBe('')
    expect(((titlebar.style as CSSStyleDeclaration).webkitBackdropFilter ?? '')).toBe('')
  })

  it('removes the sidebar titlebar fill when the sidebar is collapsed', () => {
    renderLayout()

    fireEvent.click(screen.getByTitle('收起侧边栏'))

    expect(screen.queryByTestId('sidebar-titlebar-fill')).toBeNull()
    expect(screen.queryByTestId('sidebar-component')).toBeNull()
    expect(screen.getByTitle('展开侧边栏')).toBeInTheDocument()
  })

  it('keeps history controls to the left of the expand button when the sidebar is collapsed', () => {
    renderLayout()

    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))

    const titlebar = screen.getByTestId('desktop-titlebar')
    const titlebarButtons = within(titlebar).getAllByRole('button')
    const buttons = [
      screen.getByRole('button', { name: '后退' }),
      screen.getByRole('button', { name: '前进' }),
      screen.getByRole('button', { name: '展开侧边栏' }),
    ]

    expect(titlebarButtons).toEqual(buttons)
    expect(buttons.map((button) => button.style.left)).toEqual(['132px', '164px', '196px'])
    expect(buttons.every((button) => button.style.width === '28px')).toBe(true)
    expect(buttons.every((button) => button.style.height === '28px')).toBe(true)
    expect(buttons.every((button) => button.dataset.appRegion === 'no-drag')).toBe(true)
    expect(screen.queryByTestId('sidebar-titlebar-fill')).toBeNull()
    expect(screen.queryByTestId('sidebar-component')).toBeNull()
  })
})
