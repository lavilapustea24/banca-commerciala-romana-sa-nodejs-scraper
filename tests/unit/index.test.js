import { jest } from '@jest/globals';

describe('index.js', () => {
  let index;
  
  beforeAll(async () => {
    index = await import('../../index.js');
  });

  describe('scrapeBCRJobs', () => {
    it('should return an array of job objects', async () => {
      const jobs = await index.scrapeBCRJobs();
      
      expect(Array.isArray(jobs)).toBe(true);
      if (jobs.length > 0) {
        expect(jobs[0]).toHaveProperty('url');
        expect(jobs[0]).toHaveProperty('title');
        expect(jobs[0]).toHaveProperty('location');
      }
    });
  });

  describe('mapToJobModel', () => {
    it('should map raw job to Job Model schema', () => {
      const rawJob = {
        url: 'https://erstegroup-careers.com/bcr/job/test-position/123/',
        title: 'Test Position',
        location: ['București'],
        tags: ['javascript', 'nodejs'],
        workmode: 'on-site'
      };
      
      const result = index.mapToJobModel(rawJob, '361757', 'BANCA COMERCIALA ROMANA SA');
      
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('company');
      expect(result).toHaveProperty('cif');
      expect(result.company).toBe('BANCA COMERCIALA ROMANA SA');
      expect(result.cif).toBe('361757');
    });

    it('should remove diacritics from tags', () => {
      const rawJob = {
        url: 'https://erstegroup-careers.com/bcr/job/test/123/',
        title: 'Test',
        tags: ['java', 'învățare', 'dezvoltare'],
        location: ['București']
      };
      
      const result = index.mapToJobModel(rawJob, '361757');
      
      // Tags should be lowercase and without diacritics
      if (result.tags) {
        result.tags.forEach(tag => {
          expect(tag).toBe(tag.toLowerCase());
          expect(tag).not.toMatch(/[ăâîșț]/);
        });
      }
    });
  });

  describe('transformJobsForSOLR', () => {
    it('should transform jobs for SOLR storage', () => {
      const payload = {
        company: 'Banca Comercială Română SA',
        cif: '361757',
        jobs: [
          {
            url: 'https://test.ro/job1',
            title: 'Job 1',
            location: ['București'],
            workmode: 'on-site'
          }
        ]
      };
      
      const result = index.transformJobsForSOLR(payload);
      
      expect(result.company).toBe('BANCA COMERCIALĂ ROMÂNĂ SA');
      expect(result.jobs[0].location).toBeDefined();
    });

    it('should filter invalid locations', () => {
      const payload = {
        company: 'BCR',
        cif: '361757',
        jobs: [
          {
            url: 'https://test.ro/job1',
            title: 'Job 1',
            location: ['InvalidCity', 'București'],
            workmode: 'remote'
          }
        ]
      };
      
      const result = index.transformJobsForSOLR(payload);
      
      // Should only keep valid Romanian cities
      expect(result.jobs[0].location).not.toContain('InvalidCity');
      expect(result.jobs[0].location).toContain('București');
    });
  });
});
