import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';

// Build with node scripts/package-cli.mjs --no-pack first. Uses real bundled Codex,
// a signed-out private home, and a test registry key that Chrome never consults.
test('packaged Windows CLI registers the store bridge and serves a private signed-out workspace',
  {skip:process.platform!=='win32', timeout:60000}, async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(),'canvasdoc packaged Windows-'));
    const key = `HKCU\\Software\\CanvasdocTests\\${path.basename(temp)}`;
    const support = path.join(temp,'support');
    const reservation = net.createServer().listen(0,'127.0.0.1');
    await once(reservation,'listening');
    const port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>(resolve=>reservation.close(()=>resolve()));
    let child: ReturnType<typeof spawn> | undefined;
    let ws: WebSocket | undefined;
    try {
      child = spawn(process.execPath, [path.resolve('release/canvasdoc/canvasdoc.mjs'), '--folder', path.join(temp,'workspace'), '--origin', 'http://localhost:3210', '--no-open', '--no-diagnostics'], {
        env: {...process.env, CANVASDOC_SUPPORT_DIR:support, CANVASDOC_STATE_DIR:path.join(support,'workspaces'), CANVASDOC_CONFIG_DIR:path.join(temp,'settings'), CANVASDOC_CHROME_HOSTS_DIR:support, CANVASDOC_NATIVE_REGISTRY_KEY:key, CANVASDOC_CONNECTOR_PORT:String(port), CANVASDOC_TELEMETRY_URL:'http://127.0.0.1:9'},
        stdio:['ignore','pipe','pipe'], windowsHide:true,
      });
      let output = '';
      await new Promise<void>((resolve,reject)=>{
        const timer = setTimeout(()=>reject(Error('CLI readiness timed out: '+output)),45000);
        child!.once('error',error=>{clearTimeout(timer);reject(error)});
        child!.once('exit',code=>{clearTimeout(timer);reject(Error(`CLI exited ${code}: ${output}`))});
        child!.stderr!.on('data',chunk=>output+=chunk);
        child!.stdout!.on('data',chunk=>{output+=chunk;if(output.includes('Canvasdoc is ready')){clearTimeout(timer);resolve()}});
      });
      const manifestPath = path.join(support,'com.canvasdoc.connector.json');
      const registry = execFileSync('reg.exe',['query',key,'/ve'],{encoding:'utf8',windowsHide:true});
      assert.ok(registry.includes(await realpath(manifestPath)));
      const manifest = JSON.parse(await readFile(manifestPath,'utf8'));
      assert.deepEqual(manifest.allowed_origins,['chrome-extension://pbibigofgbljlhhaadjgiikdkjiahhap/']);
      assert.equal(manifest.path,await realpath(path.join(support,'native-host.cmd')));
      const config = JSON.parse(await readFile(path.join(support,'connection.json'),'utf8'));
      ws = new WebSocket(`ws://127.0.0.1:${port}`,{origin:'http://localhost:3210'});
      await once(ws,'open');
      const response = once(ws,'message');
      ws.send(JSON.stringify({type:'connect',token:config.token,account:'canvasdoc:v1:http://localhost:3210:101'}));
      const hello = JSON.parse(String((await response)[0]));
      assert.equal(hello.type,'connected');
      assert.equal(hello.codexAccount.signedIn,false);
      const identity = JSON.parse(await readFile(path.join(temp,'workspace','.canvasdoc','config.json'),'utf8'));
      const privateHome = path.join(support,'workspaces',identity.workspaceId,'codex-home');
      assert.ok(privateHome.startsWith(support));
      assert.match(output,/Keep this terminal open/);
    } finally {
      ws?.terminate();
      if(child?.pid && child.exitCode===null) {
        const exited=once(child,'exit');
        try {
          execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'pipe',windowsHide:true});
        } catch (error) {
          // A descendant can exit during taskkill's tree walk. Ignore that
          // race only when the tracked CLI process is already gone.
          let gone = false;
          try { process.kill(child.pid,0); } catch (probe) {
            gone = (probe as NodeJS.ErrnoException).code === 'ESRCH';
          }
          if (!gone) throw error;
        }
        await exited;
      }
      try { execFileSync('reg.exe',['delete',key,'/f'],{stdio:'ignore',windowsHide:true}); } catch {}
      await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  });
