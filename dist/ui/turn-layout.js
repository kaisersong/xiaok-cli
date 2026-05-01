export class TurnLayout {
    needsAssistantLeadIn = false;
    reset() {
        this.needsAssistantLeadIn = false;
    }
    noteToolActivity() {
        this.needsAssistantLeadIn = true;
    }
    noteProgressNote() {
        this.needsAssistantLeadIn = true;
    }
    consumeAssistantLeadIn() {
        if (!this.needsAssistantLeadIn) {
            return '';
        }
        this.needsAssistantLeadIn = false;
        return '\n';
    }
}
