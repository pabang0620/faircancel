import { z } from 'zod'

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function parse(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) throw new HttpError(400, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  return result.data
}

export const sessionIdSchema = z.string().uuid()
export const subscriptionIdSchema = z.string().regex(/^I-[A-Z0-9]{6,32}$/)
