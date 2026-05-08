import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<div data-testid="outlet-content">content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
})

describe('AppLayout', () => {
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
})
