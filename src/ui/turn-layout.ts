export class TurnLayout {
  private needsAssistantLeadIn = false;
  private hasPrintedAssistant = false;

  reset(): void {
    this.needsAssistantLeadIn = false;
    this.hasPrintedAssistant = false;
  }

  noteToolActivity(): void {
    if (this.hasPrintedAssistant) {
      return;
    }
    this.needsAssistantLeadIn = true;
  }

  noteProgressNote(): void {
    if (this.hasPrintedAssistant) {
      return;
    }
    this.needsAssistantLeadIn = true;
  }

  consumeAssistantLeadIn(): string {
    if (this.hasPrintedAssistant) {
      return '';
    }

    this.hasPrintedAssistant = true;
    if (!this.needsAssistantLeadIn) {
      return '';
    }

    this.needsAssistantLeadIn = false;
    return '\n';
  }
}
