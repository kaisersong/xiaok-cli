import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import { z } from 'zod';
import { writeFileAtomicallySync } from '../../src/utils/atomic-file.js';

const recordSchema = z.object({
  schemaVersion: z.literal(1),
  accountKey: z.string().regex(/^[a-f0-9]{64}$/),
  connectedAt: z.string().datetime(),
}).strict();
type ConnectionRecord = z.infer<typeof recordSchema>;

/** Non-credential history only; the official CLI remains the credential owner. */
export class YzjCliConnectionHistory {
  private loaded = false;
  private record?: ConnectionRecord;
  constructor(private readonly filePath?: string) {}

  private key(orgId: string, openId: string): string {
    return createHash('sha256').update(JSON.stringify([orgId, openId])).digest('hex');
  }

  get(orgId: string, openId: string): string | undefined {
    if (!this.loaded) {
      this.loaded = true;
      let fd: number | undefined;
      try {
        if (this.filePath) {
          fd = openSync(this.filePath, 'r');
          const buffer = Buffer.alloc(4097);
          const length = readSync(fd, buffer, 0, buffer.length, null);
          if (length <= 4096) this.record = recordSchema.parse(JSON.parse(buffer.subarray(0, length).toString('utf8')));
        }
      } catch { /* Missing or invalid history must not block identity checks. */ }
      finally { if (fd !== undefined) closeSync(fd); }
    }
    return this.record?.accountKey === this.key(orgId, openId) ? this.record.connectedAt : undefined;
  }

  recordLogin(orgId: string, openId: string, connectedAt: string): void {
    this.loaded = true;
    this.record = { schemaVersion: 1, accountKey: this.key(orgId, openId), connectedAt };
    if (this.filePath) {
      try { writeFileAtomicallySync(this.filePath, JSON.stringify(this.record)); }
      catch { /* Keep the current-session time; do not fail a successful login. */ }
    }
  }
}
