const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { run, runDev } = require('./run-dev.cjs')

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function createChild(onKill = () => {}) {
  const child = new EventEmitter()
  child.kill = (signal) => { onKill(signal); return true }
  return child
}

test('restores the Node ABI after Electron exits', async () => {
  const calls = []
  await runDev({
    snapshotNodeAbi: async () => { calls.push('snapshot'); return 'backup' },
    rebuildForElectron: async () => { calls.push('rebuild') },
    launchElectron: async () => { calls.push('launch') },
    restoreNodeAbi: async (backup) => { calls.push(`restore:${backup}`) },
  })
  assert.deepEqual(calls, ['snapshot', 'rebuild', 'launch', 'restore:backup'])
})

test('restores the Node ABI when Electron rebuild fails', async () => {
  const calls = []
  await assert.rejects(() => runDev({
    snapshotNodeAbi: async () => 'backup',
    rebuildForElectron: async () => { throw new Error('rebuild failed') },
    launchElectron: async () => { calls.push('launch') },
    restoreNodeAbi: async (backup) => { calls.push(`restore:${backup}`) },
  }), /rebuild failed/)
  assert.deepEqual(calls, ['restore:backup'])
})

test('preserves both the primary and restore errors', async () => {
  const primaryError = new Error('rebuild failed')
  const restoreError = new Error('restore failed')

  await assert.rejects(() => runDev({
    snapshotNodeAbi: async () => 'backup',
    rebuildForElectron: async () => { throw primaryError },
    launchElectron: async () => {},
    restoreNodeAbi: async () => { throw restoreError },
  }), (error) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [primaryError, restoreError])
    return true
  })
})

for (const forwardedSignal of ['SIGINT', 'SIGTERM']) {
  test(`forwards ${forwardedSignal} to Electron once and restores the Node ABI`, async () => {
    assert.equal(typeof run, 'function')

    const calls = []
    const signalSource = new EventEmitter()
    let child
    let notifySpawned
    const spawned = new Promise((resolve) => { notifySpawned = resolve })

    const dev = runDev({
      snapshotNodeAbi: async () => { calls.push('snapshot'); return 'backup' },
      rebuildForElectron: async () => { calls.push('rebuild') },
      launchElectron: async () => run('electron', ['dist/main.js'], {}, {
        signalSource,
        spawn: () => {
          calls.push('spawn')
          child = new EventEmitter()
          child.kill = (signal) => { calls.push(`kill:${signal}`); return true }
          notifySpawned()
          return child
        },
      }),
      restoreNodeAbi: async (backup) => { calls.push(`restore:${backup}`) },
    })

    await spawned
    signalSource.emit(forwardedSignal)
    signalSource.emit(forwardedSignal)

    assert.deepEqual(calls, ['snapshot', 'rebuild', 'spawn', `kill:${forwardedSignal}`])

    child.emit('close', null, forwardedSignal)
    await assert.rejects(dev, new RegExp(`electron exited ${forwardedSignal}`))
    assert.deepEqual(calls, [
      'snapshot',
      'rebuild',
      'spawn',
      `kill:${forwardedSignal}`,
      'restore:backup',
    ])
    assert.equal(signalSource.listenerCount('SIGINT'), 0)
    assert.equal(signalSource.listenerCount('SIGTERM'), 0)

    signalSource.emit(forwardedSignal)
    assert.equal(calls.filter((call) => call === `kill:${forwardedSignal}`).length, 1)
  })
}

test('keeps both signal guards installed until restore completes', async () => {
  const signalSource = new EventEmitter()
  const restoreStarted = deferred()
  const releaseRestore = deferred()
  const spawned = deferred()
  const kills = []
  let child

  const dev = runDev({
    snapshotNodeAbi: async () => 'backup',
    rebuildForElectron: async () => {},
    launchElectron: async (runtime) => run('electron', [], {}, {
      ...runtime,
      spawn: () => {
        child = createChild((signal) => kills.push(signal))
        spawned.resolve()
        return child
      },
    }),
    restoreNodeAbi: async () => {
      restoreStarted.resolve()
      await releaseRestore.promise
    },
  }, { signalSource })

  await spawned.promise
  signalSource.emit('SIGINT')
  child.emit('close', null, 'SIGINT')
  await restoreStarted.promise

  assert.deepEqual(kills, ['SIGINT'])
  assert.equal(signalSource.listenerCount('SIGINT'), 1)
  assert.equal(signalSource.listenerCount('SIGTERM'), 1)

  signalSource.emit('SIGTERM')
  signalSource.emit('SIGINT')
  assert.deepEqual(kills, ['SIGINT'])

  releaseRestore.resolve()
  await assert.rejects(dev, /electron exited SIGINT/)
  assert.equal(signalSource.listenerCount('SIGINT'), 0)
  assert.equal(signalSource.listenerCount('SIGTERM'), 0)
})

test('guards a signal between child processes and forwards it to the next child', async () => {
  const signalSource = new EventEmitter()
  const kills = []
  let child

  const dev = runDev({
    snapshotNodeAbi: async () => 'backup',
    rebuildForElectron: async () => {},
    launchElectron: async (runtime) => {
      signalSource.emit('SIGTERM')
      const running = run('electron', [], {}, {
        ...runtime,
        spawn: () => {
          child = createChild((signal) => kills.push(signal))
          return child
        },
      })
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'))
      return running
    },
    restoreNodeAbi: async () => {},
  }, { signalSource })

  await assert.rejects(dev, /electron exited SIGTERM/)
  assert.deepEqual(kills, ['SIGTERM'])
  assert.equal(signalSource.listenerCount('SIGINT'), 0)
  assert.equal(signalSource.listenerCount('SIGTERM'), 0)
})

test('cleans signal listeners when a child emits an error', async () => {
  const signalSource = new EventEmitter()
  let child
  const running = run('electron', [], {}, {
    signalSource,
    spawn: () => {
      child = createChild()
      return child
    },
  })

  child.emit('error', new Error('spawn failed'))
  await assert.rejects(running, /spawn failed/)
  assert.equal(signalSource.listenerCount('SIGINT'), 0)
  assert.equal(signalSource.listenerCount('SIGTERM'), 0)
})

test('resolves on a successful child close and cleans signal listeners', async () => {
  const signalSource = new EventEmitter()
  let child
  const running = run('electron', [], {}, {
    signalSource,
    spawn: () => {
      child = createChild()
      return child
    },
  })

  child.emit('close', 0, null)
  await running
  assert.equal(signalSource.listenerCount('SIGINT'), 0)
  assert.equal(signalSource.listenerCount('SIGTERM'), 0)
})

test('uses a shell to spawn pnpm.cmd on Windows', async () => {
  const signalSource = new EventEmitter()
  let child
  let spawnOptions
  const running = run('pnpm.cmd', ['--version'], {}, {
    platform: 'win32',
    signalSource,
    spawn: (_file, _args, options) => {
      spawnOptions = options
      child = createChild()
      return child
    },
  })

  child.emit('close', 0, null)
  await running
  assert.equal(spawnOptions.shell, true)
})
