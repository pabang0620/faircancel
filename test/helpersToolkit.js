import { createRequire } from 'node:module'
import { createLiveClient } from '../server/paypal/liveClient.js'

// The Agent Toolkit calls PayPal through axios. This swaps axios's transport for a function, so the REAL
// toolkit code runs (handleToolCall, handleAxiosError, LlmError) and only the network is replaced.
// Nothing leaves the machine. The toolkit is CommonJS, so the same axios instance is loaded with require.
const axios = createRequire(import.meta.url)('axios')

export function installTransport(route) {
  const previous = axios.defaults.adapter
  const seen = []
  axios.defaults.adapter = async (config) => {
    seen.push({ method: config.method, url: config.url, headers: config.headers, data: config.data })
    const answer = config.url.endsWith('/v1/oauth2/token') ? { status: 200, data: { access_token: 'test-token', expires_in: 3600 } } : route(config)
    if (answer instanceof Error) throw answer
    if (answer.status >= 400) {
      throw new axios.AxiosError(`Request failed with status code ${answer.status}`, 'ERR_BAD_REQUEST', config, {}, { status: answer.status, statusText: '', headers: {}, data: answer.data, config })
    }
    return { status: answer.status, statusText: 'OK', headers: {}, data: answer.data, config }
  }
  return { seen, restore() { axios.defaults.adapter = previous } }
}

export const networkError = (text = 'connect ECONNREFUSED 127.0.0.1:443') => Object.assign(new Error(text), { request: {} })

// What PayPal answers when a subscription is in the wrong state (documented error body).
export const STATUS_INVALID_BODY = {
  name: 'UNPROCESSABLE_ENTITY',
  message: 'The requested action could not be performed, semantically incorrect, or failed business validation.',
  details: [{ issue: 'SUBSCRIPTION_STATUS_INVALID', description: 'Invalid subscription status for cancel action; subscription value status is SUSPENDED.' }],
}

export function liveWith(fetchImpl = async () => { throw new Error('no REST call expected') }) {
  return createLiveClient({ clientId: 'test-id', clientSecret: 'test-secret', fetchImpl })
}

// A fetch stand-in for the REST half of the live client. route(url) returns the JSON body.
export function fakeFetch(route) {
  return async (url) => {
    const body = url.includes('oauth2') ? { access_token: 'test-token', expires_in: 3600 } : route(url)
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
  }
}
