import { XApiResponse, RateLimitInfo } from './types.js';

export class XHttpClient {
  private baseUrl = 'https://api.x.com/2';
  private rateLimitInfo: Map<string, RateLimitInfo> = new Map();

  async makeRequest<T = any>(
    endpoint: string, 
    accessToken: string, 
    options: RequestInit = {}
  ): Promise<XApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    };

    let attempt = 0;
    const maxRetries = 3;
    const baseDelay = 1000;

    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, {
          ...options,
          headers
        });

        this.updateRateLimitInfo(endpoint, response.headers);

        if (response.status === 429) {
          const resetTime = parseInt(response.headers.get('x-rate-limit-reset') || '0');
          const waitTime = Math.max(resetTime * 1000 - Date.now(), baseDelay * Math.pow(2, attempt));
          
          if (attempt < maxRetries) {
            console.warn(`Rate limited on ${endpoint}. Waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
            await this.sleep(waitTime);
            attempt++;
            continue;
          }
          
          throw new Error(`Rate limit exceeded on ${endpoint}. Try again later.`);
        }

        if (response.status >= 500) {
          if (attempt < maxRetries) {
            const waitTime = baseDelay * Math.pow(2, attempt);
            console.warn(`Server error ${response.status} on ${endpoint}. Retrying in ${waitTime}ms (${attempt + 1}/${maxRetries})`);
            await this.sleep(waitTime);
            attempt++;
            continue;
          }
          
          throw new Error(`Server error ${response.status} on ${endpoint}`);
        }

        const responseData = await response.json();

        if (!response.ok) {
          throw new Error(`API error ${response.status}: ${JSON.stringify(responseData)}`);
        }

        return responseData;

      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        
        const waitTime = baseDelay * Math.pow(2, attempt);
        console.warn(`Request failed on ${endpoint}. Retrying in ${waitTime}ms (${attempt + 1}/${maxRetries}):`, error);
        await this.sleep(waitTime);
        attempt++;
      }
    }

    throw new Error(`Max retries exceeded for ${endpoint}`);
  }

  private updateRateLimitInfo(endpoint: string, headers: Headers): void {
    const remaining = headers.get('x-rate-limit-remaining');
    const reset = headers.get('x-rate-limit-reset');
    const limit = headers.get('x-rate-limit-limit');

    if (remaining && reset && limit) {
      this.rateLimitInfo.set(endpoint, {
        remaining: parseInt(remaining),
        reset: parseInt(reset),
        limit: parseInt(limit)
      });
    }
  }

  getRateLimitInfo(endpoint: string): RateLimitInfo | null {
    return this.rateLimitInfo.get(endpoint) || null;
  }

  checkRateLimitWarning(endpoint: string, threshold: number = 10): boolean {
    const info = this.getRateLimitInfo(endpoint);
    return info ? info.remaining <= threshold : false;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async get<T = any>(endpoint: string, accessToken: string, params?: Record<string, string>): Promise<XApiResponse<T>> {
    let url = endpoint;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    return this.makeRequest<T>(url, accessToken, { method: 'GET' });
  }

  async post<T = any>(endpoint: string, accessToken: string, body?: any): Promise<XApiResponse<T>> {
    return this.makeRequest<T>(endpoint, accessToken, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined
    });
  }

  async delete<T = any>(endpoint: string, accessToken: string): Promise<XApiResponse<T>> {
    return this.makeRequest<T>(endpoint, accessToken, { method: 'DELETE' });
  }
}