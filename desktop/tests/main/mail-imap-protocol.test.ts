// @vitest-environment node
import { createServer,type TLSSocket } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImapFlow } from 'imapflow';
import { expect,it } from 'vitest';
import { ImapMailReader } from '../../electron/mail-imap-reader';
it.skipIf(process.platform==='win32')('runs the production ImapFlow reader against a real TLS IMAP server using EXAMINE and BODY.PEEK only',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-imap-protocol-'));const commands:string[]=[],sockets=new Set<TLSSocket>();let reader:ImapMailReader|undefined;
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-days','1'],{stdio:'ignore'});
 const cert=readFileSync(join(root,'cert.pem')),key=readFileSync(join(root,'key.pem'));
 const raw='From: sender@example.com\r\nTo: me@example.com\r\nSubject: Local task\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease review the document.';
 const now=new Date();const internal=`${String(now.getUTCDate()).padStart(2,'0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][now.getUTCMonth()]}-${now.getUTCFullYear()} ${now.toISOString().slice(11,19)} +0000`;
 const envelope='(NIL "Local task" ((NIL NIL "sender" "example.com")) NIL NIL ((NIL NIL "me" "example.com")) NIL NIL NIL "<local@example.com>")';
 const server=createServer({key,cert},socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('* OK Local IMAP ready\r\n');let buffer='';socket.on('data',chunk=>{buffer+=chunk.toString();for(;;){const end=buffer.indexOf('\r\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+2);commands.push(line);const [tag,verb]=line.split(' ');if(verb==='CAPABILITY')socket.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR ID\r\n${tag} OK capability\r\n`);else if(verb==='ID')socket.write(`* ID NIL\r\n${tag} OK id\r\n`);else if(verb==='AUTHENTICATE'||verb==='LOGIN')socket.write(`${tag} OK authenticated\r\n`);else if(verb==='LIST')socket.write(`* LIST () "/" "INBOX"\r\n${tag} OK list\r\n`);else if(verb==='EXAMINE')socket.write(`* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 42] valid\r\n* OK [UIDNEXT 3] next\r\n${tag} OK [READ-ONLY] examined\r\n`);else if(/UID SEARCH/.test(line))socket.write(`* SEARCH 2\r\n${tag} OK searched\r\n`);else if(/UID FETCH/.test(line)){const metadata=`UID 2 FLAGS () INTERNALDATE "${internal}" ENVELOPE ${envelope} RFC822.SIZE ${Buffer.byteLength(raw)}`;socket.write(/BODY.PEEK/.test(line)?`* 1 FETCH (${metadata} BODY[]<0> {${Buffer.byteLength(raw)}}\r\n${raw})\r\n${tag} OK fetched\r\n`:`* 1 FETCH (${metadata})\r\n${tag} OK fetched\r\n`);}else if(verb==='LOGOUT')socket.end(`* BYE logout\r\n${tag} OK logout\r\n`);else socket.write(`${tag} OK complete\r\n`);}});});
 try{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('missing port');reader=new ImapMailReader(options=>new ImapFlow({...options,tls:{...options.tls,ca:cert}}));const account={id:'c'.repeat(32),provider:'imap',email:'me@example.com',host:'127.0.0.1',port:address.port,allowSend:true,revision:1,auth:{kind:'password',password:'local-fixture-code'}};
  const result=await reader.search(account as never,{limit:5});expect(result.messages[0]).toMatchObject({id:'42:2',subject:'Local task'});expect(await reader.read(account as never,{messageId:'42:2'})).toMatchObject({body:expect.stringContaining('Please review'),truncated:false});expect(commands.some(line=>line.includes('EXAMINE'))).toBe(true);expect(commands.some(line=>line.includes('BODY.PEEK'))).toBe(true);expect(commands.some(line=>/\b(SELECT|STORE|APPEND|EXPUNGE)\b/.test(line))).toBe(false);
 }finally{reader?.close();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
},20000);
