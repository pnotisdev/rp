import { afterEach, describe, expect, it } from 'vitest'
import { originAllowed } from './originCheck.ts'

describe('originAllowed', () => {
  it('allows a request with no Origin (curl, same-origin shapes, verification passes)', () => {
    expect(originAllowed(undefined)).toBe(true)
    expect(originAllowed('')).toBe(true)
  })

  it('allows any loopback origin regardless of port', () => {
    expect(originAllowed('http://localhost:5173')).toBe(true)
    expect(originAllowed('http://localhost:51018')).toBe(true)
    expect(originAllowed('http://127.0.0.1:5173')).toBe(true)
    expect(originAllowed('http://127.0.0.1:41234')).toBe(true)
    expect(originAllowed('http://[::1]:5173')).toBe(true)
    expect(originAllowed('https://localhost:8443')).toBe(true)
  })

  it('rejects a present Origin from any non-loopback host', () => {
    expect(originAllowed('https://evil.example')).toBe(false)
    expect(originAllowed('http://192.168.1.50:5173')).toBe(false)
    expect(originAllowed('http://rp.localhost.evil.com')).toBe(false)
    expect(originAllowed('http://localhost.evil.com')).toBe(false)
  })

  it('rejects an unparseable or scheme-less Origin rather than trusting it', () => {
    expect(originAllowed('not a url')).toBe(false)
    expect(originAllowed('localhost:5173')).toBe(false) // no scheme: parses with an empty hostname
  })

  describe('RP_ALLOWED_ORIGINS (network deployments)', () => {
    afterEach(() => {
      delete process.env.RP_ALLOWED_ORIGINS
    })

    it('allows an exact origin listed in the env var, still rejecting others', () => {
      process.env.RP_ALLOWED_ORIGINS = 'http://192.168.1.9:8080, https://rp.example.com/'
      expect(originAllowed('http://192.168.1.9:8080')).toBe(true)
      expect(originAllowed('https://rp.example.com')).toBe(true)
      expect(originAllowed('http://192.168.1.9:9999')).toBe(false)
      expect(originAllowed('https://evil.example')).toBe(false)
    })

    it('treats a lone "*" as "disable the origin check"', () => {
      process.env.RP_ALLOWED_ORIGINS = '*'
      expect(originAllowed('https://anything.example')).toBe(true)
    })
  })
})
