export class TurnLayout {
  private needsAssistantLeadIn = false;

  reset(): void {
    this.needsAssistantLeadIn = false;
  }

  noteToolActivity(): void {
    this.needsAssistantLeadIn = true;
  }

  noteProgressNote(): void {
    this.needsAssistantLeadIn = true;
  }

  consumeAssistantLeadIn(): string {
    if (!this.needsAssistantLeadIn) {
      return '';
    }

    this.needsAssistantLeadIn = false;
    return '\n';
  }
}
