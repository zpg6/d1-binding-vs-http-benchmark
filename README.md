# D1 Binding vs HTTP Benchmark

> [!NOTE]
> This benchmark accompanies [drizzle-orm PR #4881](https://github.com/drizzle-team/drizzle-orm/pull/4881) which adds REST-based D1 HTTP driver support to Drizzle ORM.

A comprehensive performance benchmark comparing Cloudflare D1 database access via **direct binding** vs **HTTP API** from _within_ Cloudflare Workers. This tool helps quantify the performance benefits of using D1 bindings versus making HTTP requests to the D1 API from within the Cloudflare datacenter.

## See the Results

![One time results](./screenshot.png)

## Run it Yourself - Quick Start

1. **Install dependencies:**

    ```bash
    pnpm install
    ```

2. **Configure `wrangler.toml`** (see [Configuration](#configuration) below)

3. **Create and migrate database:**

    ```bash
    wrangler d1 create your-database-name
    pnpm run db:migrate:prod
    ```

4. **Deploy to Cloudflare Workers:**

    ```bash
    pnpm run deploy
    ```

5. **Run benchmark:**
   Navigate to your deployed Worker URL at `/benchmark` to run the performance tests within Cloudflare's datacenter for accurate latency measurements.

## Configuration

Update these variables in `wrangler.toml`:

```toml
# Database Configuration
[[d1_databases]]
binding = "DATABASE"
database_name = "your-database-name"        # Replace with your DB name
database_id = "your-database-id"            # Replace with your DB ID

# API Access Variables
[vars]
CLOUDFLARE_ACCOUNT_ID = "your-account-id"   # Replace with your Cloudflare account ID
CLOUDFLARE_DATABASE_ID = "your-database-id" # Same as database_id above
CLOUDFLARE_API_TOKEN = "your-api-token"     # Replace with your API token with D1 permissions
```

### Getting Your Values

-   **Account ID**: Found in Cloudflare dashboard sidebar
-   **Database ID**: From `wrangler d1 create` command output
-   **API Token**: Create at [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) with D1:Edit permissions

## Available Scripts

-   `pnpm run dev` - Start development server with benchmark UI
-   `pnpm run deploy` - Deploy to Cloudflare Workers
-   `pnpm run db:migrate:prod` - Apply database migrations

---

_Powered by [better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare)_
