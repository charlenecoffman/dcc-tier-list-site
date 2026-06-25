# DCC Rankings

Create and share tier lists for Dungeon Crawler Carl characters.

Live site: [dccrankings.com](https://dccrankings.com)

## Features

- Loads character data from the live Dungeon Crawler Carl Fandom/MediaWiki API.
- Supports drag-and-drop ranking from S tier through F tier.
- Saves progress locally in the browser.
- Generates shareable links without requiring accounts or a database.
- Exports the tier board as a PNG.
- Shows available character details with links back to the wiki.

## Local Development

```bash
cd dcc-tier-list-site
npm ci
npm run build
npm run serve
```

Then open [http://localhost:4173](http://localhost:4173).

## Deployment

The site builds to `dcc-tier-list-site/dist` and deploys to S3 through GitHub Actions.

Required GitHub Actions secrets:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET`
- `CLOUDFRONT_DISTRIBUTION_ID`

The deployment IAM user needs permission to list, write, and delete objects in the target S3 bucket, plus `cloudfront:CreateInvalidation` for the CloudFront distribution.

## Notes

This is a static TypeScript app. It does not store tier lists in a backend database. Local saves use `localStorage`, and share links encode tier assignments in the URL fragment using MediaWiki page IDs.
