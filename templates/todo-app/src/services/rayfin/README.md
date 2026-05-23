# Rayfin Service Integration

This directory contains the implementations of the application services using the Rayfin client.

## Services

- `RayfinAuthService`: Implements the `IAuthService` interface using the Rayfin authentication API
- `RayfinInitializer`: Provides utility functions to initialize the Rayfin client

## Usage

To use these services, you need to initialize the ServiceContainer with the "rayfin" mode:

```typescript
// In main.tsx or app initialization
import { ServiceContainer } from './services/ServiceContainer';

// Initialize with Rayfin services
ServiceContainer.create('rayfin');
```

## Requirements

- A running backend service that implements the Rayfin API
- The `@microsoft/rayfin-client` package installed

## Testing Without Backend

When developing without a backend service:

1. Use mock mode instead:

   ```typescript
   ServiceContainer.create('mock');
   ```

2. This will use the mock services that store data in localStorage.

## Switching Between Mock and Rayfin

The application is designed to easily switch between mock and real implementations:

```typescript
// For development without backend
ServiceContainer.create('mock');

// For production with backend
ServiceContainer.create('rayfin');
```

This allows for easy testing and development without requiring a running backend service.
