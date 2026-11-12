import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createState } from './state.js'
import { createServices } from './services.js'
import { createRouter, errorHandler } from './routes.js'
import { createPolicyStore } from './policy.js'
import { createSeedFile } from './seedPool.js'
import { createMockPaypal } from './paypal/mockClient.js'
import { createLiveClient } from './paypal/liveClient.js'

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')

export function createApp({ config, modes, clock, sandbox, agent } = {}) {
  const policyStore = createPolicyStore({ file: path.join(config.dataDir, 'policy.json'), clock })
  const local = createMockPaypal({ clock, v2RefundWorks: config.mockV2Refund, suspendedCancelWorks: config.mockSuspendedCancel })
  const live = sandbox !== undefined ? sandbox : (modes.paypal === 'sandbox' ? createLiveClient({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret }) : null)
  const state = createState({ clock, local, sandbox: live, policyStore, config })
  const services = createServices(state, { seedFile: createSeedFile(path.join(config.dataDir, 'seeds.json')), agent })

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 'loopback')
  app.use(express.json({ limit: '50kb' }))
  app.use('/api', createRouter(services, { modes, config }))
  if (existsSync(distDir)) {
    app.use(express.static(distDir))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }
  app.use(errorHandler)
  return { app, services, state }
}
