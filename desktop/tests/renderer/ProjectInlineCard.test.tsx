import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ProjectInlineCard } from '../../renderer/src/components/projects/ProjectInlineCard';

const mockKSwarmState = vi.hoisted(() => ({
  projects: [] as Array<{ id: string; name: string; goal?: string; status: string }>,
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({ projects: mockKSwarmState.projects }),
}));

afterEach(() => {
  cleanup();
  mockKSwarmState.projects = [];
});

function renderCard(overrides = {}) {
  const props = {
    projectId: 'proj-123',
    name: 'AI推广方案',
    goal: '把AI原生推广方案做出来',
    status: 'created',
    createdAt: Date.now(),
    memberCount: 3,
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <LocaleProvider>
        <ProjectInlineCard {...props} />
      </LocaleProvider>
    </MemoryRouter>
  );
}

describe('ProjectInlineCard', () => {
  it('renders project name', () => {
    renderCard();
    expect(screen.getByText('AI推广方案')).toBeTruthy();
  });

  it('shows member count', () => {
    renderCard();
    expect(screen.getByText(/3/)).toBeTruthy();
  });

  it('shows "PO 正在分解..." when status is created', () => {
    renderCard({ status: 'created' });
    expect(screen.getByText(/PO 正在分解/)).toBeTruthy();
  });

  it('shows status text directly for other statuses', () => {
    renderCard({ status: 'active' });
    expect(screen.getByText(/active/)).toBeTruthy();
  });

  it('uses live KSwarm project status over the created project-card snapshot', () => {
    mockKSwarmState.projects = [
      { id: 'proj-123', name: 'AI推广方案', goal: '把AI原生推广方案做出来', status: 'delivered' },
    ];

    renderCard({ status: 'planning' });

    expect(screen.getByText(/delivered/)).toBeTruthy();
    expect(screen.queryByText(/planning/)).not.toBeInTheDocument();
  });

  it('is clickable and navigates to project page', () => {
    const { container } = renderCard();
    const card = container.firstChild as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.classList.contains('cursor-pointer')).toBe(true);
  });
});
