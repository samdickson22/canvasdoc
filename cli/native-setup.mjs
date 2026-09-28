import { access, mkdir, copyFile, writeFile, readFile, chmod, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Test overrides keep a developer's live Chrome bridge and background service untouched.
export const supportDirectory = () => process.env.CANVASDOC_SUPPORT_DIR || path.join(os.homedir(), 'Library/Application Support/Canvasdoc');
export const chromeHostsDirectory = () => process.env.CANVASDOC_CHROME_HOSTS_DIR || path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
// Chromium browsers install the same store extension; each reads native hosts from its own profile folder.
const browserFolders = ['Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Canary', 'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge', 'Arc/User Data', 'Vivaldi', 'com.operasoftware.Opera'];
export async function nativeHostDirectories(applicationSupport = path.join(os.homedir(), 'Library/Application Support')) {
  if (process.env.CANVASDOC_CHROME_HOSTS_DIR) return [process.env.CANVASDOC_CHROME_HOSTS_DIR];
  const directories = [];
  for (const folder of browserFolders) {
    const browser = path.join(applicationSupport, folder);
    if (folder === 'Google/Chrome' || await access(browser).then(() => true, () => false)) directories.push(path.join(browser, 'NativeMessagingHosts'));
  }
  return directories;
}
export const launchAgentsDirectory = () => process.env.CANVASDOC_LAUNCH_AGENTS_DIR || path.join(os.homedir(), 'Library/LaunchAgents');
export const launchLabel = () => process.env.CANVASDOC_LAUNCH_LABEL || 'com.canvasdoc.connector';
export const logDirectory = () => process.env.CANVASDOC_LOG_DIR || path.join(os.homedir(), 'Library/Logs/Canvasdoc');
const serviceTarget = (label) => `gui/${process.getuid()}/${label}`;
/** Command the Chrome bridge runs when the connector socket is refused. */
export const kickstartCommand = (label = launchLabel()) => ['/bin/launchctl', 'kickstart', serviceTarget(label)];

export async function registerNative(tokenFile, extensionIds, origin, port, chromeDirectory, bridgeDirectory = supportDirectory(), kickstart, log) {
  if(process.platform !== 'darwin') throw new Error('Native setup currently supports macOS.');
  const ids=[].concat(extensionIds);
  if(!ids.length||ids.some(id=>!/^[a-p]{32}$/.test(id))) throw new Error('Invalid Chrome extension ID.');
  const directory=bridgeDirectory;await mkdir(directory,{recursive:true,mode:0o700});
  const host=path.join(directory,'native-host.mjs');
  await copyFile(fileURLToPath(new URL('./native-host.mjs',import.meta.url)),host);
  const token=(await readFile(tokenFile,'utf8')).trim();
  const configuration=path.join(directory,'connection.json');
  await writeFile(configuration,JSON.stringify({origin,port,token,...(kickstart?{kickstart}:{}),...(log?{log}:{})}),{mode:0o600});
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  const launcher=path.join(directory,'native-host.sh');
  await writeFile(launcher,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(host)} --connection-config ${quote(configuration)}\n`,{mode:0o700});
  await chmod(launcher,0o700);
  const manifest=JSON.stringify({name:'com.canvasdoc.connector',description:'Canvasdoc local agent connection',path:launcher,type:'stdio',allowed_origins:ids.map(id=>`chrome-extension://${id}/`)},null,2);
  const directories=chromeDirectory?[].concat(chromeDirectory):await nativeHostDirectories();
  for(const hosts of directories){await mkdir(hosts,{recursive:true});await writeFile(path.join(hosts,'com.canvasdoc.connector.json'),manifest,{mode:0o600});}
  return directories;
}

const xml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
/** launchd job for the connector: starts at login and restarts after a failure. */
export function launchAgentPlist({ label, program, root, env, log }) {
  const strings = values => values.map(value => `    <string>${xml(value)}</string>`).join('\n');
  const dict = Object.entries(env).map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${strings(program)}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${dict}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

function launchctl(args) {
  return new Promise((resolve, reject) => {
    execFile('/bin/launchctl', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim()));
      else resolve(stdout);
    });
  });
}

/** Writes the job and (re)loads it. A previous copy is unloaded first so the new program takes effect. */
export async function installLaunchAgent({ label = launchLabel(), directory = launchAgentsDirectory(), program, root, env, log, run = launchctl }) {
  if (process.platform !== 'darwin') throw new Error('Background service setup currently supports macOS.');
  await mkdir(directory, { recursive: true });
  await mkdir(path.dirname(log), { recursive: true });
  const plist = path.join(directory, `${label}.plist`);
  await run(['bootout', serviceTarget(label)]).catch(() => {});
  await writeFile(plist, launchAgentPlist({ label, program, root, env, log }), { mode: 0o644 });
  let attempt = 0;
  for (;;) {
    try { await run(['bootstrap', `gui/${process.getuid()}`, plist]); return plist; }
    catch (error) {
      // launchd reports EIO briefly while the previous instance finishes unloading.
      if (++attempt >= 6) throw new Error(`Could not start the Canvasdoc service: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

export async function removeLaunchAgent({ label = launchLabel(), directory = launchAgentsDirectory(), run = launchctl } = {}) {
  await run(['bootout', serviceTarget(label)]).catch(() => {});
  await unlink(path.join(directory, `${label}.plist`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

/** Restarts a running service after settings changed; a missing service is not an error. */
export async function restartLaunchAgent({ label = launchLabel(), run = launchctl } = {}) {
  await run(['kickstart', '-k', serviceTarget(label)]).catch(() => {});
}
