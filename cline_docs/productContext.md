# Product Context

## Purpose
This project implements a Model Context Protocol (MCP) server that provides authenticated access to Google Workspace APIs, specifically focusing on Gmail and Calendar functionality.

## Problems Solved
1. Provides a standardized interface for AI systems to interact with Google Workspace services
2. Handles complex OAuth authentication flows and token management
3. Manages multiple Google accounts securely
4. Simplifies integration with Gmail and Calendar services

## How It Works
- Implements a modular architecture focused on Gmail and Calendar functionality
- Uses OAuth 2.0 for authentication with automatic token refresh
- Provides simple verb-noun interfaces for AI agents
- Follows "simplest viable design" principle to prevent over-engineering
- Handles authentication through HTTP response codes (401/403)
- Moves OAuth mechanics into platform infrastructure
