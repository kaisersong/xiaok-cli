export class TurnLayout {
    needsAssistantLeadIn = false;
    hasPrintedAssistant = false;
    reset() {
        this.needsAssistantLeadIn = false;
        this.hasPrintedAssistant = false;
    }
    noteToolActivity() {
        if (this.hasPrintedAssistant) {
            return;
        }
        this.needsAssistantLeadIn = true;
    }
    noteProgressNote() {
        if (this.hasPrintedAssistant) {
            return;
        }
        this.needsAssistantLeadIn = true;
    }
    consumeAssistantLeadIn() {
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
