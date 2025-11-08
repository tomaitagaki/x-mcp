import { XHttpClient } from './http-client.js';
import { XAuthManager } from './auth.js';
import { XUser, Tweet, BookmarksResponse, XApiResponse } from './types.js';

export class XClient {
  private httpClient: XHttpClient;
  private authManager: XAuthManager;
  private cachedUser: XUser | null = null;
  private cachedBookmarks: { tweets: Tweet[]; nextToken?: string } | null = null;

  constructor(authManager: XAuthManager) {
    this.httpClient = new XHttpClient();
    this.authManager = authManager;
  }

  async getCurrentUser(): Promise<XUser> {
    if (this.cachedUser) {
      return this.cachedUser;
    }

    const accessToken = await this.authManager.getValidAccessToken();
    const response = await this.httpClient.get<XUser>('/users/me', accessToken, {
      'user.fields': 'id,username,name'
    });

    if (!response.data) {
      throw new Error('Failed to get current user');
    }

    this.cachedUser = response.data;
    return this.cachedUser;
  }

  async getBookmarks(options: {
    userId?: string;
    maxResults?: number;
    paginationToken?: string;
  } = {}): Promise<{ tweets: Tweet[]; nextToken?: string }> {
    const accessToken = await this.authManager.getValidAccessToken();
    
    let userId = options.userId;
    if (!userId) {
      const currentUser = await this.getCurrentUser();
      userId = currentUser.id;
    }

    const params: Record<string, string> = {
      'tweet.fields': 'id,text,created_at,author_id,public_metrics',
      'user.fields': 'id,username,name'
    };

    if (options.maxResults && options.maxResults <= 100) {
      params.max_results = options.maxResults.toString();
    }

    if (options.paginationToken) {
      params.pagination_token = options.paginationToken;
    }

    const response = await this.httpClient.get<BookmarksResponse>(
      `/users/${userId}/bookmarks`,
      accessToken,
      params
    );

    const tweets = response.data?.data || [];
    const nextToken = response.data?.meta?.next_token;

    this.cachedBookmarks = { tweets, nextToken };

    return { tweets, nextToken };
  }

  async addBookmark(options: { userId?: string; tweetId: string }): Promise<{ ok: boolean }> {
    const accessToken = await this.authManager.getValidAccessToken();
    
    let userId = options.userId;
    if (!userId) {
      const currentUser = await this.getCurrentUser();
      userId = currentUser.id;
    }

    const response = await this.httpClient.post(
      `/users/${userId}/bookmarks`,
      accessToken,
      { tweet_id: options.tweetId }
    );

    if (response.data?.bookmarked) {
      this.cachedBookmarks = null;
      return { ok: true };
    }

    throw new Error(`Failed to bookmark tweet: ${JSON.stringify(response.errors)}`);
  }

  async removeBookmark(options: { userId?: string; tweetId: string }): Promise<{ ok: boolean }> {
    const accessToken = await this.authManager.getValidAccessToken();
    
    let userId = options.userId;
    if (!userId) {
      const currentUser = await this.getCurrentUser();
      userId = currentUser.id;
    }

    const response = await this.httpClient.delete(
      `/users/${userId}/bookmarks/${options.tweetId}`,
      accessToken
    );

    if (response.data?.bookmarked === false) {
      this.cachedBookmarks = null;
      return { ok: true };
    }

    throw new Error(`Failed to remove bookmark: ${JSON.stringify(response.errors)}`);
  }

  async createTweet(options: {
    text: string;
    mediaIds?: string[];
    reply?: { inReplyToTweetId: string };
    quoteTweetId?: string;
  }): Promise<{ id: string; createdAt: string }> {
    const accessToken = await this.authManager.getValidAccessToken();

    const requestBody: any = {
      text: options.text
    };

    if (options.mediaIds && options.mediaIds.length > 0) {
      requestBody.media = {
        media_ids: options.mediaIds
      };
    }

    if (options.reply) {
      requestBody.reply = {
        in_reply_to_tweet_id: options.reply.inReplyToTweetId
      };
    }

    if (options.quoteTweetId) {
      requestBody.quote_tweet_id = options.quoteTweetId;
    }

    const response = await this.httpClient.post('/tweets', accessToken, requestBody);

    if (!response.data?.data) {
      throw new Error(`Failed to create tweet: ${JSON.stringify(response.errors)}`);
    }

    return {
      id: response.data.data.id,
      createdAt: response.data.data.created_at || new Date().toISOString()
    };
  }

  getCachedUser(): XUser | null {
    return this.cachedUser;
  }

  getCachedBookmarks(): { tweets: Tweet[]; nextToken?: string } | null {
    return this.cachedBookmarks;
  }

  clearCache(): void {
    this.cachedUser = null;
    this.cachedBookmarks = null;
  }

  getRateLimitInfo(endpoint: string) {
    return this.httpClient.getRateLimitInfo(endpoint);
  }

  checkRateLimitWarning(endpoint: string, threshold?: number): boolean {
    return this.httpClient.checkRateLimitWarning(endpoint, threshold);
  }
}