import { config, modes } from './config.js'
import { createApp } from './app.js'

const { app, services } = createApp({ config, modes, clock: { now: () => Date.now() } })

services.scanSeeds().catch(() => null)

// Scheduled resumes, cancels PayPal could not take, and refunds waiting on a pending payment.
const timer = setInterval(() => { services.runDueWork().catch(() => null) }, 30_000)
timer.unref()

app.listen(config.port, () => {
  console.log(`FairCancel on http://localhost:${config.port}`)
  console.log(`Modes: PayPal=${modes.paypal} Claude=${modes.llm} (${config.llmBackend}) refund path=${config.refundPath}`)
})
