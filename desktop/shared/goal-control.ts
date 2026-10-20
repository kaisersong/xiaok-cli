export interface GoalControlReceipt {
  threadId: string;
  status: 'paused' | 'cancelled';
  revision: number;
}
