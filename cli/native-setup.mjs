import { mkdir, copyFile, writeFile, readFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function registerNative(root, extensionId, origin, port, chromeDirectory = path.join(os.homedir(),'Library/Application Support/Google/Chrome/NativeMessagingHosts'), bridgeDirectory = path.join(os.homedir(),'Library/Application Support/Canvasdoc')) {
  if(process.platform !== 'darwin') throw new Error('Native setup currently supports macOS.');
  if(!/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid Chrome extension ID.');
  const directory=bridgeDirectory;await mkdir(directory,{recursive:true,mode:0o700});
  const host=path.join(directory,'native-host.mjs');
  await copyFile(fileURLToPath(new URL('./native-host.mjs',import.meta.url)),host);
  const token=(await readFile(path.join(root,'.canvasdoc/dev-connection-token'),'utf8')).trim();
  const configuration=path.join(directory,'connection.json');
  await writeFile(configuration,JSON.stringify({origin,port,token}),{mode:0o600});
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  const launcher=path.join(directory,'native-host.sh');
  await writeFile(launcher,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(host)} --connection-config ${quote(configuration)}\n`,{mode:0o700});
  await chmod(launcher,0o700);
  const hosts=chromeDirectory;await mkdir(hosts,{recursive:true});
  await writeFile(path.join(hosts,'com.canvasdoc.connector.json'),JSON.stringify({name:'com.canvasdoc.connector',description:'Canvasdoc local agent connection',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${extensionId}/`]},null,2),{mode:0o600});
}
