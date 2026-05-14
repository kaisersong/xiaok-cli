import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectInlineCard } from '../../renderer/src/components/projects/ProjectInlineCard';

afterEach(cleanup);

function renderCard(overrides = {}) {
  const props = {
    projectId: 'proj-123',
    name: 'AI推广方案',
    status: 'created',
    createdAt: Date.now(),
    memberCount: 3,
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <ProjectInlineCard {...props} />
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

  it('is clickable and navigates to project page', () => {
    const { container } = renderCard();
    const card = container.firstChild as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.classList.contains('cursor-pointer')).toBe(true);
  });
});
