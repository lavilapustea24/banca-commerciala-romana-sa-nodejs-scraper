# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-30

### Added
- Initial release
- Job scraping from BCR Careers (SuccessFactors)
- Company validation via ANAF (BANCA COMERCIALĂ ROMÂNĂ SA, CIF: 361757)
- Solr integration for job storage
- GitHub Actions workflows for daily scraping and testing
- Test suite structure (unit, integration, E2E)
- ANAF API integration with fallback support
- Node 24 compatibility

### Features
- Automated daily job scraping at 6 AM UTC
- Company core validation and management
- Job URL validation
- Data integrity checks
- Romanian location filtering
- Work mode normalization

## License

Copyright (c) 2026 lavilapustea24
Licensed under MIT License
