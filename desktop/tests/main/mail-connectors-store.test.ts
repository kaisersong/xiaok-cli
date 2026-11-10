import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { MailAccountStore } from '../../electron/mail-account-store';
const roots: string[] = [];
const key = randomBytes(32);
const crypto = {
  isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain',
  encryptString(text: string) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([c.update(text), c.final()]); return Buffer.concat([iv, c.getAuthTag(), bytes]); },
  decryptString(bytes: Buffer) { const d = createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12)); d.setAuthTag(bytes.subarray(12,28)); return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString(); },
};
const record = { id: 'a'.repeat(32), provider: 'qq', email: 'example@qq.com', host: 'imap.qq.com', port: 993, allowSend: true, revision: 1, auth: { kind: 'password', password: 'private-mail-authorization-code' } };
function setup(safeCrypto = crypto) { const root = mkdtempSync(join(tmpdir(), 'xiaok-mail-store-')); roots.push(root); return { root, store: new MailAccountStore(root, safeCrypto) }; }
afterEach(() => { for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true}); });
it('encrypts credentials and reloads the exact account after restart without returning secrets in a public projection', () => {
  const { root, store } = setup(); store.put(record, 0, 'user');
  const bytes = readFileSync(join(root,'mail-accounts','accounts.enc'));
  expect(bytes.includes(Buffer.from(record.auth.password))).toBe(false);
  const restarted = new MailAccountStore(root, crypto);
  expect(restarted.get(record.id)).toMatchObject(record);
  expect(JSON.stringify(restarted.list())).not.toContain(record.auth.password);
  expect(restarted.list()[0]).not.toHaveProperty('auth');
});
it.each([undefined,'agent','scheduler'])('rejects %s store mutations without writing', source => {
  const { store } = setup(); expect(() => store.put(record,0,source as never)).toThrow('mail_user_only');
  expect(() => store.remove(record.id,1,source as never)).toThrow('mail_user_only'); expect(store.list()).toEqual([]);
});
it('refuses plaintext encryption backends and damaged ciphertext rather than replacing an existing file', () => {
  const { root, store } = setup(); store.put(record,0,'user'); const file = join(root,'mail-accounts','accounts.enc');
  expect(() => new MailAccountStore(root,{...crypto,getSelectedStorageBackend:()=> 'basic_text'}).put(record,0,'user')).toThrow('mail_secure_storage_unavailable');
  writeFileSync(file,'damaged'); expect(() => store.list()).toThrow('mail_store_unavailable'); expect(readFileSync(file,'utf8')).toBe('damaged');
});
it('rejects stale revisions and symbolic-link stores', () => {
  const { root, store } = setup(); store.put(record,0,'user'); expect(() => store.put({...record,revision:2},0,'user')).toThrow('mail_stale_account');
  const other = mkdtempSync(join(tmpdir(),'xiaok-mail-link-')); roots.push(other);
  symlinkSync(join(root,'mail-accounts'),join(other,'mail-accounts'),'dir');
  expect(() => new MailAccountStore(other,crypto).list()).toThrow('mail_store_unavailable');
});

it('allows only the private scheduler rotation of an exact OAuth credential without changing access settings', () => {
 const {store}=setup();const oauth={...record,provider:'gmail',host:'gmail.googleapis.com',port:443,auth:{kind:'oauth',clientId:'client',refreshToken:'old-private-token'}};store.put(oauth as never,0,'user');
 expect(()=>store.rotateRefreshToken(oauth.id,1,'old-private-token','new-private-token','agent')).toThrow('mail_user_only');
 store.rotateRefreshToken(oauth.id,1,'old-private-token','new-private-token','scheduler');
 expect(store.get(oauth.id)).toMatchObject({revision:1,allowSend:true,auth:{refreshToken:'new-private-token'}});
 expect(()=>store.rotateRefreshToken(oauth.id,1,'old-private-token','stale-token','scheduler')).toThrow('mail_account_changed');
});
