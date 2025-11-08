import { XHttpClient } from './http-client.js';
import { TokenManager } from './token-manager.js';
import { SessionManager } from './session-manager.js';
import { User, XUser, Tweet, BookmarksResponse, XApiResponse } from './types.js';

export class MultiUserXClient {
  private httpClient: XHttpClient;
  private tokenManager: TokenManager;
  private sessionManager: SessionManager;
  private userCache: Map<number, XUser> = new Map();
  private bookmarksCache: Map<number, { tweets: Tweet[]; nextToken?: string }> = new Map();

  constructor(tokenManager: TokenManager, sessionManager: SessionManager) {
    this.httpClient = new XHttpClient();
    this.tokenManager = tokenManager;
    this.sessionManager = sessionManager;
  }

  private async getUserFromContext(context?: { sessionId?: string; sessionSecret?: string }): Promise<User> {
    return this.sessionManager.requireUser(context?.sessionId, context?.sessionSecret);
  }

  async getCurrentUser(context?: { sessionId?: string; sessionSecret?: string }): Promise<XUser> {
    const user = await this.getUserFromContext(context);
    
    // Check cache first
    const cached = this.userCache.get(user.id);
    if (cached) {
      return cached;
    }

    const accessToken = await this.tokenManager.validateToolAccess(user, 'users.read');
    const response = await this.httpClient.get<XUser>('/users/me', accessToken, {
      'user.fields': 'id,username,name'
    });

    if (!response.data) {
      throw new Error('Failed to get current user');
    }

    // Update cache
    this.userCache.set(user.id, response.data);
    
    // Also update database with latest user info if it has changed
    if (response.data.username !== user.x_username || response.data.name !== user.display_name) {
      this.sessionManager['db'].updateUser(user.id, {
        x_username: response.data.username,
        display_name: response.data.name || response.data.username
      });
    }

    return response.data;
  }

  async getBookmarks(
    options: {
      userId?: string;
      maxResults?: number;
      paginationToken?: string;
    } = {},
    context?: { sessionId?: string; sessionSecret?: string }
  ): Promise<{ tweets: Tweet[]; nextToken?: string }> {
    const user = await this.getUserFromContext(context);
    const accessToken = await this.tokenManager.validateToolAccess(user, 'bookmarks.list');
    
    let userId = options.userId;
    if (!userId) {
      const currentUser = await this.getCurrentUser(context);
      userId = currentUser.id;
    }

    const params: Record<string, string> = {
      'tweet.fields': 'id,text,created_at,author_id,public_metrics',
      'user.fields': 'id,username,name',
      'expansions': 'author_id'
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

    // Update cache
    this.bookmarksCache.set(user.id, { tweets, nextToken });

    return { tweets, nextToken };
  }

  async addBookmark(
    options: { userId?: string; tweetId: string },
    context?: { sessionId?: string; sessionSecret?: string }
  ): Promise<{ ok: boolean }> {
    const user = await this.getUserFromContext(context);
    const accessToken = await this.tokenManager.validateToolAccess(user, 'bookmarks.add');
    
    let userId = options.userId;
    if (!userId) {
      const currentUser = await this.getCurrentUser(context);
      userId = currentUser.id;
    }

    const response = await this.httpClient.post(
      `/users/${userId}/bookmarks`,
      accessToken,
      { tweet_id: options.tweetId }
    );

    if (response.data?.bookmarked) {
      // Clear bookmarks cache for this user
      this.bookmarksCache.delete(user.id);
      return { ok: true };
    }

    throw new Error(`Failed to bookmark tweet: ${JSON.stringify(response.errors)}`);
  }

  async removeBookmark(
    options: { userId?: string; tweetId: string },
    context?: { sessionId?: string; sessionSecret?: string }
  ): Promise<{ ok: boolean }> {
    const user = await this.getUserFromContext(context);
    const accessToken = await this.tokenManager.validateToolAccess(user, 'bookmarks.remove');
    
    let userId = options.userId;
    if (!userId) {
      const currentUser = await this.getCurrentUser(context);
      userId = currentUser.id;
    }

    const response = await this.httpClient.delete(
      `/users/${userId}/bookmarks/${options.tweetId}`,
      accessToken
    );

    if (response.data?.bookmarked === false) {
      // Clear bookmarks cache for this user
      this.bookmarksCache.delete(user.id);
      return { ok: true };
    }

    throw new Error(`Failed to remove bookmark: ${JSON.stringify(response.errors)}`);
  }

  async createTweet(
    options: {
      text: string;
      mediaIds?: string[];
      reply?: { inReplyToTweetId: string };
      quoteTweetId?: string;
    },
    context?: { sessionId?: string; sessionSecret?: string }
  ): Promise<{ id: string; createdAt: string }> {
    const user = await this.getUserFromContext(context);
    const accessToken = await this.tokenManager.validateToolAccess(user, 'tweet.create');

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

  // Cache management methods
  getCachedUser(context?: { sessionId?: string; sessionSecret?: string }): XUser | null {
    try {
      const user = this.sessionManager.getUserFromSession(context?.sessionId, context?.sessionSecret);
      return user ? this.userCache.get(user.id) || null : null;
    } catch {
      return null;
    }
  }

  getCachedBookmarksForUser(context?: { sessionId?: string; sessionSecret?: string }): { tweets: Tweet[]; nextToken?: string } | null {
    try {
      const user = this.sessionManager.getUserFromSession(context?.sessionId, context?.sessionSecret);
      return user ? this.bookmarksCache.get(user.id) || null : null;
    } catch {
      return null;
    }
  }

  clearCacheForUser(userId: number): void {
    this.userCache.delete(userId);
    this.bookmarksCache.delete(userId);
  }

  clearAllCache(): void {
    this.userCache.clear();
    this.bookmarksCache.clear();
  }

  // Rate limit information
  getRateLimitInfo(endpoint: string) {
    return this.httpClient.getRateLimitInfo(endpoint);
  }

  checkRateLimitWarning(endpoint: string, threshold?: number): boolean {
    return this.httpClient.checkRateLimitWarning(endpoint, threshold);
  }

  // User management helpers
  async getUserTokenInfo(context?: { sessionId?: string; sessionSecret?: string }) {
    const user = await this.getUserFromContext(context);
    return this.tokenManager.getUserTokenInfo(user);
  }

  async validateUserAccess(toolName: string, context?: { sessionId?: string; sessionSecret?: string }) {
    const user = await this.getUserFromContext(context);
    return this.tokenManager.validateUserTokens(user, toolName);
  }
}