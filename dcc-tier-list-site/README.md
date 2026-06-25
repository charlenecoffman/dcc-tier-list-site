# Dungeon Crawler Carl Tier List

A static TypeScript site for ranking Dungeon Crawler Carl characters.

The app loads character names, page URLs, summaries, and images from the live Dungeon Crawler Carl Fandom MediaWiki Action API. Character names are not hardcoded.

## Local Development

```powershell
npm install
npm run build
npm run serve
```

Open `http://localhost:4173`.

## Static Hosting

The compiled site is written to `dist/` and can be uploaded to S3 static website hosting or served through CloudFront.

The included GitHub Actions workflow deploys on pushes to `main`.

Required repository secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET`

Optional repository secret:

- `CLOUDFRONT_DISTRIBUTION_ID`

## Sharing And Persistence

Local progress is saved in `localStorage`, which fits the "remember this browser" requirement better than cookies because the tier data can get too large for cookie limits.

The share button creates a URL fragment containing only tier assignments by MediaWiki page ID. A friend opening the link still fetches live wiki data, then applies the shared ranking. New characters from the API stay available in the unranked pool.

For short permanent public links, add an API Gateway endpoint backed by Lambda and DynamoDB:

- Browser sends tier JSON to API Gateway.
- Lambda validates and writes a record to DynamoDB.
- Lambda returns a short ID.
- Shared links use `?share=abc123`.

Do not call DynamoDB directly from the browser with AWS credentials. It exposes write capability to anyone who can inspect the app. Cognito can make direct DynamoDB access safer, but API Gateway plus Lambda is the cleaner MVP boundary.
