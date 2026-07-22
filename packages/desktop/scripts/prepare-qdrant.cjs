const { createHash } = require('node:crypto')
const { access, chmod, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { spawn } = require('node:child_process')

const VERSION = '1.18.3'
const projectDir = resolve(__dirname, '..')
const targets = {
  'mac-arm64': {
    asset: 'qdrant-aarch64-apple-darwin.tar.gz',
    sha256: '0cb040a261035c316779bd7b4cca2e6ab39faf62640d6918bbbe320e2a9a6547',
  },
  'mac-x64': {
    asset: 'qdrant-x86_64-apple-darwin.tar.gz',
    sha256: '45bdd4642e7f25611e9cd74f9f91482b27c5376840cd8dc476da67b87abe25a6',
  },
  'linux-arm64': {
    asset: 'qdrant-aarch64-unknown-linux-musl.tar.gz',
    sha256: '1e738b45f90935c383b4076c30f377f390964cb5962b5bff24439812d157dc24',
  },
  'linux-x64': {
    asset: 'qdrant-x86_64-unknown-linux-musl.tar.gz',
    sha256: 'b4faedcdf8c9577bf1c8f2ab9b454636b87e056c116c99d49bd4f9fb2e634285',
  },
  'win-x64': {
    asset: 'qdrant-x86_64-pc-windows-msvc.zip',
    sha256: '984619bbd4032ace578656174c465c5d6b71d1267ecad5b7b4c21cc6549ca833',
  },
}

function hostTarget() {
  const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform
  return `${os}-${process.arch}`
}

function run(file, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(file, args, { cwd: projectDir, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('close', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${file} exited ${signal ?? code}`)))
  })
}

async function prepareQdrant(targetName) {
  const target = targets[targetName]
  if (!target) throw new Error(`Unsupported Qdrant target: ${targetName}`)
  const directory = join(projectDir, '.qdrant', targetName)
  const executable = join(directory, targetName.startsWith('win-') ? 'qdrant.exe' : 'qdrant')
  try {
    await access(executable)
    await writeExecutableManifest(directory, executable, targetName)
    return executable
  } catch { /* download the pinned official release below */ }

  await mkdir(directory, { recursive: true })
  const archive = join(directory, target.asset)
  const url = `https://github.com/qdrant/qdrant/releases/download/v${VERSION}/${target.asset}`
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Qdrant download failed (${response.status}): ${url}`)
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex')
  if (digest !== target.sha256) {
    await rm(archive, { force: true })
    throw new Error(`Qdrant checksum mismatch for ${target.asset}: expected ${target.sha256}, received ${digest}`)
  }

  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar'
  await run(tar, ['-xf', archive, '-C', directory])
  await rm(archive, { force: true })
  if (!targetName.startsWith('win-')) await chmod(executable, 0o755)
  await access(executable)
  await writeExecutableManifest(directory, executable, targetName)
  return executable
}

async function writeExecutableManifest(directory, executable, targetName) {
  const executableSha256 = createHash('sha256').update(await readFile(executable)).digest('hex')
  await writeFile(join(directory, 'qdrant-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    qdrantVersion: VERSION,
    target: targetName,
    executableSha256,
  }, null, 2)}\n`)
}

async function main() {
  const requested = process.argv.slice(2).filter((value) => value !== '--')
  const names = requested.length ? requested : [hostTarget()]
  for (const name of names) process.stdout.write(`Qdrant ${VERSION}: ${await prepareQdrant(name)}\n`)
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })

module.exports = { VERSION, hostTarget, prepareQdrant }
