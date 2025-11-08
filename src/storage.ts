import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { TokenData } from './types.js';

export class TokenStorage {
  private tokenPath: string;

  constructor(tokenPath?: string) {
    this.tokenPath = tokenPath || join(process.env.HOME || process.cwd(), '.x-mcp', 'tokens.json');
  }

  async ensureDirectory(): Promise<void> {
    const dir = dirname(this.tokenPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async saveTokens(tokenData: TokenData): Promise<void> {
    await this.ensureDirectory();
    const data = JSON.stringify(tokenData, null, 2);
    await writeFile(this.tokenPath, data, 'utf8');
  }

  async loadTokens(): Promise<TokenData | null> {
    try {
      if (!existsSync(this.tokenPath)) {
        return null;
      }
      
      const data = await readFile(this.tokenPath, 'utf8');
      const tokenData = JSON.parse(data) as TokenData;
      
      if (!tokenData.access_token || !tokenData.refresh_token) {
        return null;
      }
      
      return tokenData;
    } catch (error) {
      console.error('Failed to load tokens:', error);
      return null;
    }
  }

  async clearTokens(): Promise<void> {
    try {
      if (existsSync(this.tokenPath)) {
        await writeFile(this.tokenPath, '{}', 'utf8');
      }
    } catch (error) {
      console.error('Failed to clear tokens:', error);
    }
  }

  getTokenPath(): string {
    return this.tokenPath;
  }
}