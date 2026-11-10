'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [addon,root]=process.argv.slice(2);process.env.XIAOK_CONFIG_DIR=path.join(root,'config');fs.mkdirSync(process.env.XIAOK_CONFIG_DIR,{recursive:true,mode:0o700});
const {app}=require('electron');app.setPath('userData',path.join(root,'userData'));app.disableHardwareAcceleration();let originalFailure;
try{
 const api=require(addon),names=['connectOriginalMainInstallation','assertOriginalMainInstallationCurrent','closeOriginalMainInstallation','readOriginalMainInstallationFate'];
 const facts={actualMain:process.type==='browser',installedApi:names.every(name=>typeof api[name]==='function'),foreignTraps:0,productionQualified:false};fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));
 for(const name of names)assert.equal(typeof api[name],'function','missing fixed Native API '+name);
 const issuer=api.createOriginalMainIssuer(),foreign=new Proxy({},{get(){facts.foreignTraps++;throw Error('foreign getter');},getOwnPropertyDescriptor(){facts.foreignTraps++;throw Error('foreign descriptor');}});
 assert.throws(()=>api.connectOriginalMainInstallation(foreign),/ISSUER_REQUIRED/);assert.equal(facts.foreignTraps,0);
 // No original launcher/seed here: a normal real Main is NOT an installed Main.
 assert.throws(()=>api.connectOriginalMainInstallation(issuer),/BIRTH|UNAVAILABLE/);
 assert.throws(()=>api.connectOriginalMainInstallation(issuer),/ALREADY|UNCONFIRMED/);
 fs.writeFileSync(path.join(root,'facts.json'),JSON.stringify(facts));app.exit(0);
}catch(raw){originalFailure={raw};process.stderr.write('ORIGINAL_MAIN_INSTALLED_FIXED_API_OR_BIRTH_FAILED\n');app.exit(1);}
