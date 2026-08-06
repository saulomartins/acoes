const { createHash } = require('crypto');
const { existsSync, mkdirSync, readdirSync, writeFileSync } = require('fs');
const { join, resolve } = require('path');
const { spawnSync } = require('child_process');

const mobileDir = resolve(__dirname, '..');
const repositoryDir = resolve(mobileDir, '..');
const releasesDir = resolve(repositoryDir, 'releases');
const isWindows = process.platform === 'win32';
const npmBinDir = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '';
const eas = isWindows ? join(npmBinDir, 'eas.cmd') : 'eas';
const railway = isWindows ? join(npmBinDir, 'railway.cmd') : 'railway';
const argumentsList = process.argv.slice(2);
const has = (flag) => argumentsList.includes(flag);
const value = (flag) => {
  const index = argumentsList.indexOf(flag);
  return index >= 0 ? argumentsList[index + 1] : undefined;
};

const run = (command, args, cwd = mobileDir, capture = false) => {
  const windowsShim = isWindows && /\.(cmd|bat)$/i.test(command);
  const executable = windowsShim ? (process.env.ComSpec || 'cmd.exe') : command;
  const executableArgs = windowsShim
    ? ['/d', '/c', 'call', command, ...args]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return result.stdout || '';
};

const parseJsonOutput = (output) => {
  const start = output.indexOf('{');
  if (start < 0) throw new Error('EAS did not return JSON.');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < output.length; index += 1) {
    const character = output[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return JSON.parse(output.slice(start, index + 1));
  }
  throw new Error('EAS returned incomplete JSON.');
};

const buildView = (id) => parseJsonOutput(run(eas, ['build:view', id, '--json'], mobileDir, true));
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const findApkSigner = () => {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (isWindows ? 'C:\\Android\\Sdk' : '');
  const toolsRoot = join(sdkRoot, 'build-tools');
  if (!existsSync(toolsRoot)) return null;
  const versions = readdirSync(toolsRoot).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = join(toolsRoot, version, isWindows ? 'apksigner.bat' : 'apksigner');
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const submitBuild = () => {
  const output = run(eas, ['build', '--platform', 'android', '--profile', 'production-apk', '--non-interactive', '--no-wait'], mobileDir, true);
  const match = output.match(/builds\/([0-9a-f-]{36})/i);
  if (!match) throw new Error(`Could not identify EAS build ID.\n${output}`);
  console.log(`EAS build submitted: ${match[1]}`);
  return match[1];
};

const download = async (url, target) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`APK download failed: HTTP ${response.status}`);
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
};

(async () => {
  mkdirSync(releasesDir, { recursive: true });
  let buildId = value('--build-id');
  if (has('--start')) buildId = submitBuild();
  if (!buildId) throw new Error('Use --start or --build-id <id>.');

  let build = buildView(buildId);
  console.log(`Build ${build.id}: ${build.status} (${build.appVersion || '?'} / ${build.appBuildVersion || '?'})`);
  if (has('--check')) return;
  if (build.status !== 'FINISHED' && !has('--wait')) {
    console.log(`Build is not finished. Resume with: npm run release:apk:resume -- --build-id ${buildId}`);
    return;
  }
  while (build.status === 'IN_QUEUE' || build.status === 'IN_PROGRESS' || build.status === 'NEW') {
    console.log(`Waiting for EAS (${build.status})...`);
    await delay(60_000);
    build = buildView(buildId);
  }
  if (build.status !== 'FINISHED') throw new Error(`EAS build ended with status ${build.status}.`);

  const artifactUrl = build.artifacts?.applicationArchiveUrl || build.artifacts?.buildUrl;
  if (!artifactUrl || !artifactUrl.toLowerCase().includes('.apk')) throw new Error('Finished build did not provide an APK URL.');
  const fileName = `lar-em-dia-${build.appVersion}-build-${build.appBuildVersion}-production.apk`;
  const apkPath = join(releasesDir, fileName);
  await download(artifactUrl, apkPath);
  const bytes = require('fs').readFileSync(apkPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase();
  console.log(`APK saved: ${apkPath}`);
  console.log(`SHA-256: ${sha256}`);

  const apksigner = findApkSigner();
  if (!apksigner) throw new Error('apksigner was not found; APK will not be published without signature verification.');
  run(apksigner, ['verify', '--verbose', '--print-certs', apkPath], mobileDir);

  if (!has('--no-publish')) {
    run(railway, [
      'ssh', '--service', 'acoes', '--environment', 'production',
      'npm', 'run', 'releases:seed-android', '--',
      artifactUrl, build.appVersion, build.appBuildVersion, sha256,
    ], repositoryDir);
    console.log(`Android ${build.appVersion} build ${build.appBuildVersion} published in Instalar aplicativo.`);
  }

  const stateFile = has('--no-publish') ? 'last-validated-apk.json' : 'latest-android-release.json';
  writeFileSync(join(releasesDir, stateFile), JSON.stringify({
    buildId, version: build.appVersion, buildNumber: build.appBuildVersion,
    fileName, sha256, artifactUrl, published: !has('--no-publish'), completedAt: new Date().toISOString(),
  }, null, 2));
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
