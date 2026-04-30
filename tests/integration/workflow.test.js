import { jest } from '@jest/globals';

describe('Integration: API Workflow', () => {
  
  describe('Full company validation workflow', () => {
    it.skip('should go from brand to validated company (ANAF API can return 500)', async () => {
      const demoanaf = await import('../../demoanaf.js');
      const company = await import('../../company.js');
      const solr = await import('../../solr.js');
      
      const searchResults = await demoanaf.searchCompany('BCR');
      expect(searchResults.length).toBeGreaterThan(0);
      
      const bcrCompany = searchResults.find(c => 
        c.name.toUpperCase().includes('BCR') && c.statusLabel === 'Funcțiune'
      );
      expect(bcrCompany).toBeDefined();
      
      const anafData = await demoanaf.getCompanyFromANAF(bcrCompany.cui.toString());
      expect(anafData.name).toBe('BANCA COMERCIALĂ ROMÂNĂ SA');
      
      const companyResult = await company.validateAndGetCompany();
      expect(companyResult.status).toBe('active');
      expect(companyResult.cif).toBe('361757');
      
      const solrResult = await solr.querySOLR(companyResult.cif);
      expect(solrResult.numFound).toBeGreaterThan(0);
    });
  });

  describe('Company data consistency', () => {
    it.skip('should have matching data across ANAF, Peviitor and SOLR (timeout issues)', async () => {
      const company = await import('../../company.js');
      const solr = await import('../../solr.js');
      
      const companyResult = await company.validateAndGetCompany();
      
      const solrResult = await solr.queryCompanySOLR(`company:${companyResult.company}*`);
      expect(solrResult.docs[0].brand).toBe('BCR');
    });
  });

  describe('Company Core Model Validation', () => {
    it('should have all required fields per company model', async () => {
      const solr = await import('../../solr.js');
      
      const result = await solr.queryCompanySOLR('id:361757');
      expect(result.numFound).toBe(1);
      
      const bcr = result.docs[0];
      
      // Required: id, company
      expect(bcr.id).toBe('361757');
      expect(bcr.company).toBeDefined();
      
      // All other model fields should exist per company-model.md
      expect(bcr.brand).toBe('BCR');
      expect(bcr.status).toBeDefined();
      expect(['activ', 'suspendat', 'inactiv', 'radiat']).toContain(bcr.status);
      expect(bcr.location).toBeDefined();
      expect(Array.isArray(bcr.location)).toBe(true);
      expect(bcr.lastScraped).toBeDefined();
      expect(bcr.scraperFile).toBeDefined();
    });
  });
});
