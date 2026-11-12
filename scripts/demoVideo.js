// One command to the recording state: `npm run demo:video` (builds first). Starts the server with a
// fresh in-memory state and prints the page to open. The mode comes from .env: sandbox keys and
// LLM_BACKEND=account give the sandbox take; with no keys it is the local take (LOCAL MOCK badge,
// recorded Claude runs replayed with their date).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { config, modes } from '../server/config.js'

const server = spawn(process.execPath, [fileURLToPath(new URL('../server/index.js', import.meta.url))], { stdio: 'inherit', env: process.env })
const take = modes.paypal === 'sandbox' ? 'sandbox take (see docs/VIDEO_SCRIPT.md, take A)' : 'local take (see docs/VIDEO_SCRIPT.md, take B)'
process.stdout.write(`\nRecording state: ${take}\nOpen http://localhost:${config.port}/judge?film=1 in a fresh browser window at 1280x720, zoom 125%.\nIf the window was used before, press Start over first.\n\n`)
const stop = () => server.kill('SIGTERM')
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
server.on('exit', (code) => process.exit(code ?? 0))
