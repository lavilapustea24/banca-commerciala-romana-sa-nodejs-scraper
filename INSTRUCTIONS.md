# INSTRUCTIONS

## How to run locally

1. Clone the repository
2. Install dependencies: `npm install`
3. Create `.env` file with: `SOLR_AUTH=solr:SolrRocks`
4. Run scraper: `npm run scrape`

## Environment Variables

- `SOLR_AUTH`: Solr authentication credentials (format: `username:password`)

## Build/Run Commands

- `npm run scrape` - Run the scraper to fetch and update BCR jobs
- `npm run test:unit` - Run unit tests
- `npm run test:integration` - Run integration tests
- `npm run test:e2e` - Run end-to-end tests

## Test Framework

- Jest with ESM support (`--experimental-vm-modules`)
- Test files located in `tests/unit/`, `tests/integration/`, `tests/e2e/`

## Repository Structure

- `index.js` - Main scraper logic
- `company.js` - Company validation via ANAF
- `demoanaf.js` - ANAF API helper
- `solr.js` - Solr operations
- `.github/workflows/scrape.yml` - Automated scraping (daily)
- `.github/workflows/test.yml` - Automated testing (on push/PR)
