import { describe, expect, it } from 'vitest';
import { TurnLayout } from '../../src/ui/turn-layout.js';

describe('TurnLayout', () => {
  it('adds a lead-in blank line before assistant text after tool activity', () => {
    const layout = new TurnLayout();

    layout.noteToolActivity();

    expect(layout.consumeAssistantLeadIn()).toBe('\n');
    expect(layout.consumeAssistantLeadIn()).toBe('');
  });

  it('adds a lead-in blank line before assistant text after a progress note', () => {
    const layout = new TurnLayout();

    layout.noteProgressNote();

    expect(layout.consumeAssistantLeadIn()).toBe('\n');
  });

  it('does not add a lead-in blank line for direct assistant output', () => {
    const layout = new TurnLayout();

    expect(layout.consumeAssistantLeadIn()).toBe('');
  });

  it('resets between turns', () => {
    const layout = new TurnLayout();

    layout.noteToolActivity();
    layout.reset();

    expect(layout.consumeAssistantLeadIn()).toBe('');
  });
});
