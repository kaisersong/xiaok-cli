import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { buildRoomCardMessageFromToolResult } from '../../renderer/src/components/chatToolResultMessages';
import { RoomInlineCard } from '../../renderer/src/components/collaboration/RoomInlineCard';
it('renders a confirmed room creation receipt and navigates to its detail', () => { const message = buildRoomCardMessageFromToolResult(JSON.stringify({ ok: true, created: true, type: 'room_card', roomId: 'room-real', title: 'AI协作', description: '研究', memberCount: 3 })); expect(message?.role).toBe('room_card'); function Location() { return <output>{useLocation().pathname}</output>; } render(<MemoryRouter><LocaleProvider><RoomInlineCard {...message!.roomData!}/><Location /></LocaleProvider></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: 'AI协作' })); expect(screen.getByText('/collaboration/room-real')).toBeInTheDocument(); });
it.each([{ ok: false, type: 'room_card', roomId: 'r', title: 'N' }, { ok: true, proposal: { title: 'N' } }, { ok: true, type: 'room_card', title: 'N' }])('rejects unconfirmed room cards %j', input => expect(buildRoomCardMessageFromToolResult(JSON.stringify(input))).toBeNull());
