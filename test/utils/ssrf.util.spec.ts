import { BusinessException } from '../../src/common/exceptions/business.exception'
import { validateUrl, isPrivateHost } from '../../src/common/utils/ssrf.util'

describe('SSRF Protection', () => {
  describe('validateUrl', () => {
    it('should accept valid public HTTPS URLs', () => {
      const result = validateUrl('https://wazuh.example.com:55000/api')
      expect(result.hostname).toBe('wazuh.example.com')
    })

    it('should accept valid HTTP URLs', () => {
      const result = validateUrl('http://grafana.example.com:3000')
      expect(result.hostname).toBe('grafana.example.com')
    })

    it('should reject invalid URLs', () => {
      expect(() => validateUrl('not-a-url')).toThrow(BusinessException)
    })

    it('should reject private IP 127.0.0.1', () => {
      expect(() => validateUrl('http://127.0.0.1:8080')).toThrow(BusinessException)
    })

    it('should reject private IP 10.x.x.x', () => {
      expect(() => validateUrl('http://10.0.1.5:9200')).toThrow(BusinessException)
    })

    it('should reject private IP 192.168.x.x', () => {
      expect(() => validateUrl('http://192.168.1.1')).toThrow(BusinessException)
    })

    it('should reject private IP 172.16.x.x', () => {
      expect(() => validateUrl('http://172.16.0.1')).toThrow(BusinessException)
    })

    it('should reject localhost', () => {
      expect(() => validateUrl('http://localhost:4000')).toThrow(BusinessException)
    })

    it('should reject link-local addresses', () => {
      expect(() => validateUrl('http://169.254.169.254')).toThrow(BusinessException)
    })

    it('should reject FTP protocol', () => {
      expect(() => validateUrl('ftp://files.example.com')).toThrow(BusinessException)
    })

    it('should enforce allowlist when provided', () => {
      const allowed = ['wazuh.corp.com', 'misp.corp.com']
      expect(() => validateUrl('https://evil.com', allowed)).toThrow(BusinessException)
      expect(validateUrl('https://wazuh.corp.com', allowed).hostname).toBe('wazuh.corp.com')
    })

    it('should allow subdomains of allowed hosts', () => {
      const allowed = ['corp.com']
      const result = validateUrl('https://api.wazuh.corp.com', allowed)
      expect(result.hostname).toBe('api.wazuh.corp.com')
    })
  })

  describe('isPrivateHost', () => {
    it('should detect 127.x.x.x as private', () => {
      expect(isPrivateHost('127.0.0.1')).toBe(true)
    })

    it('should detect 10.x.x.x as private', () => {
      expect(isPrivateHost('10.0.0.1')).toBe(true)
    })

    it('should detect localhost as private', () => {
      expect(isPrivateHost('localhost')).toBe(true)
    })

    it('should not flag public IPs', () => {
      expect(isPrivateHost('8.8.8.8')).toBe(false)
    })
  })
})
