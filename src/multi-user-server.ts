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

import { XConfig, AuthError } from './types.js';
import { XDatabase } from './database.js';
import { SessionManager } from './session-manager.js';
import { TokenManager } from './token-manager.js';
import { OAuthManager } from './oauth-manager.js';
import { MultiUserXClient } from './multi-user-x-client.js';

class MultiUserXMCPServer {
  private server: Server;
  private config: XConfig;
  private db: XDatabase;
  private sessionManager: SessionManager;
  private tokenManager: TokenManager;
  private oauthManager: OAuthManager;
  private xClient: MultiUserXClient;

  constructor() {
    this.server = new Server(
      {
        name: 'x-mcp-server',
        version: '2.0.0',
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
      redirectUri: process.env.X_REDIRECT_URI || 'http://127.0.0.1:3000/auth/x/cb',
      hostedMode: process.env.X_HOSTED_MODE === 'true',
      baseUrl: process.env.X_BASE_URL
    };

    this.db = new XDatabase();
    this.sessionManager = new SessionManager(this.db);
    this.tokenManager = new TokenManager(this.config, this.db);
    this.oauthManager = new OAuthManager(this.config, this.db);
    this.xClient = new MultiUserXClient(this.tokenManager, this.sessionManager);

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'mcp://x/user/me',
          mimeType: 'application/json',
          name: 'Current User',
          description: 'Current authenticated X user information (session-specific)',
        },
        {
          uri: 'mcp://x/bookmarks/latest',
          mimeType: 'application/json',
          name: 'Latest Bookmarks',
          description: 'Last fetched bookmarks page for current user (session-specific)',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const context = this.extractContext(request);

      try {
        switch (uri) {
          case 'mcp://x/user/me': {
            const user = await this.xClient.getCurrentUser(context);
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
            const cached = this.xClient.getCachedBookmarksForUser(context);
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
      } catch (error) {
        if (this.isAuthError(error)) {
          throw new McpError(ErrorCode.InvalidRequest, this.formatAuthError(error));
        }
        throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : String(error));
      }
    });

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'auth/start',
          description: 'Start OAuth authentication flow (loopback or hosted pairing)',
          inputSchema: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                enum: ['loopback', 'hosted'],
                description: 'Authentication mode: loopback for local/single-user, hosted for multi-user',
                default: 'loopback'
              }
            }
          },
        },
        {
          name: 'auth/status',
          description: 'Check authentication status for pairing code',
          inputSchema: {
            type: 'object',
            properties: {
              pairing_code: {
                type: 'string',
                description: 'Pairing code from auth/start (required for hosted mode)',
              },
            },
          },
        },
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
      const context = this.extractContext(request);

      try {
        switch (name) {
          case 'auth/start': {
            this.validateConfig();
            
            const mode = ((args as any)?.mode as string) || 'loopback';
            let result;
            
            if (mode === 'hosted') {
              result = await this.oauthManager.startHostedAuth();
            } else {
              result = await this.oauthManager.startLoopbackAuth();
              
              if (result.authorize_url) {
                console.log('🔐 Please open this URL in your browser to authorize:');
                console.log(result.authorize_url);
              }
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'auth/status': {
            const pairingCode = (args as any)?.pairing_code as string;
            if (!pairingCode) {
              throw new McpError(ErrorCode.InvalidParams, 'pairing_code is required for auth/status');
            }

            const result = await this.oauthManager.checkPairingStatus(pairingCode);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'bookmarks.list': {
            const result = await this.xClient.getBookmarks({
              userId: (args as any)?.user_id as string | undefined,
              maxResults: (args as any)?.max_results as number | undefined,
              paginationToken: (args as any)?.pagination_token as string | undefined,
            }, context);

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
              userId: (args as any)?.user_id as string | undefined,
              tweetId: (args as any)?.tweet_id as string,
            }, context);

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
              userId: (args as any)?.user_id as string | undefined,
              tweetId: (args as any)?.tweet_id as string,
            }, context);

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
              text: (args as any)?.text as string,
              mediaIds: (args as any)?.media_ids as string[] | undefined,
              reply: (args as any)?.reply as { inReplyToTweetId: string } | undefined,
              quoteTweetId: (args as any)?.quote_tweet_id as string | undefined,
            }, context);

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
        if (this.isAuthError(error)) {
          throw new McpError(ErrorCode.InvalidRequest, this.formatAuthError(error));
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(ErrorCode.InternalError, errorMessage);
      }
    });
  }

  private extractContext(request: any): { sessionId?: string; sessionSecret?: string } {
    return this.sessionManager.extractSessionContext(request);
  }

  private validateConfig(): void {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Missing X_CLIENT_ID or X_CLIENT_SECRET environment variables'
      );
    }
  }

  private isAuthError(error: any): error is AuthError {
    return error && typeof error.code === 'string' && error.code.startsWith('auth_');
  }

  private formatAuthError(error: AuthError): string {
    let message = error.message;
    
    if (error.login_url) {
      message += `\n🔗 Login URL: ${error.login_url}`;
    }
    
    if (error.missing_scopes && error.missing_scopes.length > 0) {
      message += `\n🔒 Missing scopes: ${error.missing_scopes.join(', ')}`;
    }
    
    return message;
  }

  async run(): Promise<void> {
    try {
      // Cleanup expired sessions on startup
      this.sessionManager.cleanupExpiredSessions();
      
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      console.error('🚀 X MCP Server v2.0 running on stdio');
      console.error('💡 Multi-user OAuth with encrypted token storage');
      console.error('🔐 Supports both loopback and hosted pairing flows');
      
    } catch (error) {
      console.error('❌ Server startup failed:', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.oauthManager.stop();
      this.db.close();
      console.error('🛑 Server shutdown complete');
    } catch (error) {
      console.error('⚠️ Error during shutdown:', error);
    }
  }
}

// Handle graceful shutdown
const server = new MultiUserXMCPServer();

process.on('SIGINT', async () => {
  console.error('\n🛑 Received SIGINT, shutting down gracefully...');
  await server.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('\n🛑 Received SIGTERM, shutting down gracefully...');
  await server.shutdown();
  process.exit(0);
});

server.run().catch(async (error) => {
  console.error('💥 Server error:', error);
  await server.shutdown();
  process.exit(1);
});