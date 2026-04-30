# Banca Comercială Română SA - Job Scraper

![WebScraper BCR to Peviitor](https://img.shields.io/badge/scraper-bcr-blue)

A Node.js scraper for extracting job listings from BCR Careers (SuccessFactors) and storing them in Solr for [peviitor.ro](https://peviitor.ro).

## Overview

This project automates the daily scraping of BCR job listings in Romania, ensuring the peviitor.ro job board stays up-to-date with the latest career opportunities at Banca Comercială Română.

## Features

- Scrapes job listings from BCR Careers (SuccessFactors platform)
- Validates company data via ANAF (Romanian National Fiscal Administration Agency)
- Stores jobs in Solr with proper data validation
- Follows Job Model and Company Model schemas from peviitor_core
- Environment-based configuration with `.env` support

## Project Structure

```
├── index.js           # Main scraper entry point
├── company.js         # Company validation via ANAF
├── demoanaf.js        # ANAF API integration
├── solr.js            # Solr database operations
├── package.json       # Node.js dependencies
├── .env               # Environment variables (not tracked by git)
├── .gitignore         # Git ignore rules
└── README.md          # This file
```

## Setup

### Prerequisites

- Node.js 16+
- npm
- GitHub CLI (gh) - for repository management

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file (already created and gitignored):

```
SOLR_AUTH=username:password
```

Or set the environment variable directly:

```bash
export SOLR_AUTH="your_username:your_password"
```

## Usage

### Run the Scraper

```bash
npm run scrape
```

Or directly:

```bash
node index.js
```

### Test Mode (scrape only first page)

```bash
node index.js --test
```

## Company Information

- **Company**: BANCA COMERCIALĂ ROMÂNĂ SA
- **Brand**: BCR
- **CIF**: 361757
- **Status**: Activ (verificat prin ANAF)
- **Website**: https://www.bcr.ro
- **Career Page**: https://erstegroup-careers.com/bcr/go/bcr-careire/4305601/

## Data Model

This scraper follows the peviitor.ro data models:

### Job Model Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | Full URL to job detail page |
| title | string | Yes | Position title (max 200 chars, diacritics accepted) |
| company | string | No | Company name (UPPERCASE, diacritics accepted) |
| cif | string | No | CIF/CUI of the company |
| location | string[] | No | Romanian cities with diacritics |
| tags | string[] | No | Skills/education (lowercase, no diacritics, max 20) |
| workmode | string | No | "remote", "on-site", or "hybrid" |
| salary | string | No | Salary range (format: "MIN-MAX CURRENCY") |
| date | date | No | ISO8601 scrape timestamp |
| status | string | No | "scraped", "tested", "verified", "published" |

## Workflow

1. **Company Validation**: Validates BCR exists and is active in ANAF
2. **Job Scraping**: Extracts job listings from BCR careers page
3. **Data Transformation**: Maps scraped data to Job Model schema
4. **Solr Storage**: Upserts jobs to peviitor.ro Solr database

## Technologies Used

- **Node.js** - JavaScript runtime
- **node-fetch** - HTTP client for API requests
- **Solr** - Search platform for job storage
- **ANAF API** (demoanaf.ro) - Romanian company validation

## Acknowledgments

This project was developed with assistance from:

- **[OpenCode](https://opencode.ai)** - AI-powered CLI tool for software engineering
- **Big Pickle LLM** - Large language model powering OpenCode

## License

Copyright (c) 2026 lavilapustea24

Licensed under the [MIT License](LICENSE).

## Managed By

This project is managed by [ASOCIAȚIA OPORTUNITĂȚI ȘI CARIERE](https://oportunitatisicariere.ro) and used as a web scraper for the [peviitor.ro](https://peviitor.ro) job board project.

## Disclaimer

This scraper is designed for educational purposes and legitimate job data aggregation for the Romanian job market. Please respect BCR's Terms of Service and robots.txt when using this scraper.

## About

Web scraper pentru a aduce locurile de muncă de la BCR în platforma peviitor.ro, folosind tehnologii moderne și respectând standardele peviitor.ro.
