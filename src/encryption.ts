import { createCipher, createDecipher, randomBytes, pbkdf2Sync } from 'crypto';
import { join } from 'path';
import { existsSync, writeFileSync, readFileSync } from 'fs';

export class EncryptionManager {
  private encryptionKey: Buffer;
  private keyPath: string;

  constructor(keyPath?: string) {
    this.keyPath = keyPath || join(process.env.HOME || process.cwd(), '.mcp', 'x', '.encryption_key');
    this.encryptionKey = this.getOrCreateEncryptionKey();
  }

  private getOrCreateEncryptionKey(): Buffer {
    try {
      // Try to get key from OS keychain first
      const keychainKey = this.getKeychainKey();
      if (keychainKey) {
        return Buffer.from(keychainKey, 'base64');
      }
    } catch (error) {
      console.warn('OS keychain not available, using fallback key storage');
    }

    // Fallback to environment variable
    if (process.env.X_MCP_ENCRYPTION_KEY) {
      return Buffer.from(process.env.X_MCP_ENCRYPTION_KEY, 'base64');
    }

    // Fallback to file-based key storage
    return this.getOrCreateFileKey();
  }

  private getKeychainKey(): string | null {
    try {
      // Dynamic import to handle cases where keytar isn't available
      const keytar = require('keytar');
      return keytar.getPasswordSync('x-mcp-server', 'encryption-key');
    } catch (error) {
      return null;
    }
  }

  private setKeychainKey(key: string): boolean {
    try {
      const keytar = require('keytar');
      keytar.setPasswordSync('x-mcp-server', 'encryption-key', key);
      return true;
    } catch (error) {
      return false;
    }
  }

  private getOrCreateFileKey(): Buffer {
    if (existsSync(this.keyPath)) {
      try {
        const keyData = readFileSync(this.keyPath, 'utf8');
        return Buffer.from(keyData, 'base64');
      } catch (error) {
        console.warn('Failed to read encryption key file, generating new key');
      }
    }

    // Generate new key
    const key = randomBytes(32); // 256-bit key
    const keyBase64 = key.toString('base64');

    try {
      // Try to store in keychain first
      if (this.setKeychainKey(keyBase64)) {
        console.log('Encryption key stored in OS keychain');
      } else {
        // Fallback to file storage
        writeFileSync(this.keyPath, keyBase64, { mode: 0o600 }); // Owner read/write only
        console.log(`Encryption key stored at: ${this.keyPath}`);
      }
    } catch (error) {
      console.error('Failed to store encryption key:', error);
      throw new Error('Unable to store encryption key securely');
    }

    return key;
  }

  encrypt(data: string): string {
    try {
      const iv = randomBytes(16);
      const cipher = createCipher('aes-256-cbc', this.encryptionKey);
      cipher.setAutoPadding(true);
      
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Prepend IV to encrypted data
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      throw new Error(`Encryption failed: ${error}`);
    }
  }

  decrypt(encryptedData: string): string {
    try {
      const [ivHex, encrypted] = encryptedData.split(':');
      if (!ivHex || !encrypted) {
        throw new Error('Invalid encrypted data format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const decipher = createDecipher('aes-256-cbc', this.encryptionKey);
      decipher.setAutoPadding(true);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error}`);
    }
  }

  hashPassword(password: string, salt?: string): { hash: string; salt: string } {
    const saltBuffer = salt ? Buffer.from(salt, 'hex') : randomBytes(16);
    const hash = pbkdf2Sync(password, saltBuffer, 100000, 64, 'sha512');
    
    return {
      hash: hash.toString('hex'),
      salt: saltBuffer.toString('hex')
    };
  }

  verifyPassword(password: string, hash: string, salt: string): boolean {
    const computed = this.hashPassword(password, salt);
    return computed.hash === hash;
  }

  generateSecureToken(length: number = 32): string {
    return randomBytes(length).toString('base64url');
  }

  maskToken(token: string): string {
    if (token.length <= 8) return '***';
    return token.slice(0, 4) + '...' + token.slice(-4);
  }
}

// Global encryption manager instance
export const encryption = new EncryptionManager();