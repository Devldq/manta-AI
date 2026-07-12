/*
 * Single authoritative production staging boundary.  Both the smoke package
 * and electron-builder consume this exact app tree; a release cannot quietly
 * use different backend/provider/native dependency closure than the smoke.
 */
const { packageDirectory } = require('./package-smoke.cjs')

packageDirectory().catch((error) => { console.error(error); process.exitCode = 1 })
