#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { XAuthManager } from './auth.js';
import { XClient } from './x-client.js';
import { TokenStorage } from './storage.js';
import { XConfig } from './types.js';

class XMCPServer {
  private server: Server;
  private authManager: XAuthManager;
  private xClient: XClient;
  private tokenStorage: TokenStorage;
  private config: XConfig;

  constructor() {
    this.server = new Server(
      {
        name: 'x-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.config = {
      clientId: process.env.X_CLIENT_ID || '',
      clientSecret: process.env.X_CLIENT_SECRET || '',
      redirectUri: process.env.X_REDIRECT_URI || 'http://localhost:3000/callback'
    };

    this.tokenStorage = new TokenStorage();
    this.authManager = new XAuthManager(this.config);
    this.xClient = new XClient(this.authManager);

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'mcp://x/user/me',
          mimeType: 'application/json',
          name: 'Current User',
          description: 'Current authenticated X user information',
        },
        {
          uri: 'mcp://x/bookmarks/latest',
          mimeType: 'application/json',
          name: 'Latest Bookmarks',
          description: 'Last fetched bookmarks page with pagination token',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case 'mcp://x/user/me': {
          await this.ensureAuthenticated();
          const user = await this.xClient.getCurrentUser();
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(user, null, 2),
              },
            ],
          };
        }

        case 'mcp://x/bookmarks/latest': {
          await this.ensureAuthenticated();
          const cached = this.xClient.getCachedBookmarks();
          const data = cached || { tweets: [], nextToken: null };
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        }

        default:
          throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
      }
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'bookmarks.list',
          description: 'List user bookmarks with pagination support',
          inputSchema: {
            type: 'object',
            properties: {
              user_id: {
                type: 'string',
                description: 'User ID (defaults to authenticated user)',
              },
              max_results: {
                type: 'number',
                description: 'Maximum results per page (1-100, default: 10)',
                minimum: 1,
                maximum: 100,
              },
              pagination_token: {
                type: 'string',
                description: 'Token for next page of results',
              },
            },
          },
        },
        {
          name: 'bookmarks.add',
          description: 'Add a tweet to bookmarks',
          inputSchema: {
            type: 'object',
            properties: {
              user_id: {
                type: 'string',
                description: 'User ID (defaults to authenticated user)',
              },
              tweet_id: {
                type: 'string',
                description: 'ID of the tweet to bookmark',
              },
            },
            required: ['tweet_id'],
          },
        },
        {
          name: 'bookmarks.remove',
          description: 'Remove a tweet from bookmarks',
          inputSchema: {
            type: 'object',
            properties: {
              user_id: {
                type: 'string',
                description: 'User ID (defaults to authenticated user)',
              },
              tweet_id: {
                type: 'string',
                description: 'ID of the tweet to remove from bookmarks',
              },
            },
            required: ['tweet_id'],
          },
        },
        {
          name: 'tweet.create',
          description: 'Create a new tweet',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Tweet text content',
                maxLength: 280,
              },
              media_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of media IDs to attach',
              },
              reply: {
                type: 'object',
                properties: {
                  in_reply_to_tweet_id: {
                    type: 'string',
                    description: 'ID of tweet to reply to',
                  },
                },
                required: ['in_reply_to_tweet_id'],
              },
              quote_tweet_id: {
                type: 'string',
                description: 'ID of tweet to quote',
              },
            },
            required: ['text'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        await this.ensureAuthenticated();

        switch (name) {
          case 'bookmarks.list': {
            const result = await this.xClient.getBookmarks({
              userId: args.user_id,
              maxResults: args.max_results,
              paginationToken: args.pagination_token,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'bookmarks.add': {
            const result = await this.xClient.addBookmark({
              userId: args.user_id,
              tweetId: args.tweet_id,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'bookmarks.remove': {
            const result = await this.xClient.removeBookmark({
              userId: args.user_id,
              tweetId: args.tweet_id,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'tweet.create': {
            const result = await this.xClient.createTweet({
              text: args.text,
              mediaIds: args.media_ids,
              reply: args.reply,
              quoteTweetId: args.quote_tweet_id,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('authenticate') || errorMessage.includes('token')) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Authentication error: ${errorMessage}. Please run the authentication flow.`
          );
        }
        
        throw new McpError(ErrorCode.InternalError, errorMessage);
      }
    });
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('Missing X_CLIENT_ID or X_CLIENT_SECRET environment variables');
    }

    const tokenData = await this.tokenStorage.loadTokens();
    if (tokenData) {
      this.authManager.setTokenData(tokenData);
    }

    if (!this.authManager.getTokenData()) {
      throw new Error('Not authenticated. Please complete OAuth flow first.');
    }

    if (!this.authManager.hasRequiredScopes()) {
      const missing = this.authManager.getMissingScopes();
      throw new Error(
        `Missing required scopes: ${missing.join(', ')}. ` +
        'Please re-authenticate with correct scopes.'
      );
    }

    try {
      await this.authManager.getValidAccessToken();
      const currentToken = this.authManager.getTokenData();
      if (currentToken) {
        await this.tokenStorage.saveTokens(currentToken);
      }
    } catch (error) {
      throw new Error(`Token validation failed: ${error}`);
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('X MCP server running on stdio');
  }
}

const server = new XMCPServer();
server.run().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});