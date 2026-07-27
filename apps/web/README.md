# Decisionate Web

Next.js frontend for Decisionate.

## Local Setup

Copy the example environment file and adjust values if needed:

```bash
cp .env.example .env.local
```

Run the development server:

```bash
npm run dev
```

Open http://localhost:3000.

## Environment

`NEXT_PUBLIC_API_URL` points the web app at the API. It defaults in code to `http://localhost:8000`, but deployed environments should set it explicitly.

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` configures the Clerk browser client. Set it to the publishable key for the deployed Clerk instance.

`NEXT_PUBLIC_ENABLE_API_BEARER_AUTH` enables Clerk bearer tokens on API requests when set to `true`. Keep it `false` for the local header-based development flow unless the API has Clerk JWT verification configured.

For shared dashboard links to work in deployment, the API must also allow the deployed web origin in `CORS_ALLOWED_ORIGINS`.
