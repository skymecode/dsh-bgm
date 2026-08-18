import { chmodSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const binDir = join(root, 'native', 'bin')
mkdirSync(binDir, { recursive: true })

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

if (process.platform === 'darwin') {
  const sourceDir = join(root, 'native', 'macos', 'Sources')
  const sources = readdirSync(sourceDir)
    .filter(name => name.endsWith('.swift'))
    .sort()
    .map(name => join(sourceDir, name))
  const output = join(binDir, 'dsh-bgm-helper-macos')
  const infoPlist = join(root, 'native', 'macos', 'Info.plist')
  run('swiftc', [
    '-O',
    '-parse-as-library',
    '-framework', 'CoreAudio',
    '-framework', 'AudioToolbox',
    '-Xlinker', '-sectcreate',
    '-Xlinker', '__TEXT',
    '-Xlinker', '__info_plist',
    '-Xlinker', infoPlist,
    '-o', output,
    ...sources,
  ])
  run('codesign', ['--force', '--sign', '-', '--identifier', 'com.dsh.bgm.helper', output])
  chmodSync(output, 0o755)
  console.log(`built ${output}`)
} else if (process.platform === 'win32') {
  const project = join(root, 'native', 'windows', 'DshBgmHelper.csproj')
  const runtime = process.arch === 'arm64' ? 'win-arm64' : 'win-x64'
  const publishDir = join(root, 'native', 'windows', 'publish')
  run('dotnet', [
    'publish', project,
    '-c', 'Release',
    '-r', runtime,
    '--self-contained', 'true',
    '-p:PublishSingleFile=true',
    '-p:DebugType=None',
    '-o', publishDir,
  ])
  const output = join(binDir, 'dsh-bgm-helper-windows.exe')
  copyFileSync(join(publishDir, 'DshBgmHelper.exe'), output)
  console.log(`built ${output}`)
} else {
  console.log(`dsh-bgm: no native helper build for ${process.platform}`)
}
