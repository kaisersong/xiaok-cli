import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
export function tls(f,t){
 const dir=path.join(path.dirname(f.opts.stateDir),'tls');fs.mkdirSync(dir,{mode:0o700});
 const config=path.join(dir,'certificate.cnf'),key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem');
 fs.writeFileSync(config,'[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=localhost\n[extensions]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n',{mode:0o600});
 const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-config',config,'-days','1'],{encoding:'utf8',timeout:10_000});
 fs.writeFileSync(path.join(dir,'test-process.json'),JSON.stringify({pid:result.pid,exitCode:result.status}));assert.equal(result.status,0,result.stderr);fs.chmodSync(key,0o600);t.diagnostic(`certificate fixture process ${result.pid} reaped`);
 return {key:fs.readFileSync(key),cert:fs.readFileSync(cert),files:{key,cert}};
}
