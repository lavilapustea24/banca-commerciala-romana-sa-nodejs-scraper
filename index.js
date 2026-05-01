/**
 * BCR Job Scraper - Main Entry Point
 * 
 * PURPOSE: Scrapes job listings from BCR Careers (SuccessFactors) 
 * and stores them in Solr for peviitor.ro job aggregation platform.
 * 
 * This scraper handles:
 * - Company validation via ANAF
 * - Job listing extraction from SuccessFactors platform
 * - Data transformation to match Job Model schema
 * - Upserting jobs to Solr
 */

import fetch from "node-fetch";
import fs from "fs";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, deleteJobByUrl, upsertJobs } from "./solr.js";

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

// BCR job listings URL (SuccessFactors)
const BCR_CAREERS_URL = "https://erstegroup-careers.com/bcr/go/bcr-careire/4305601/";

// Request timeout in milliseconds
const TIMEOUT = 10000;

// Global variable to store company name after validation
let COMPANY_NAME = null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Promise-based sleep function
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// SCRAPING LOGIC - Extract job listings from BCR careers page
// ============================================================================

/**
 * Scrapes job listings from BCR SuccessFactors page using Puppeteer
 * SuccessFactors requires JavaScript rendering, so we use Puppeteer
 * 
 * @returns {Promise<Array>} - Array of job objects with full details
 */
async function scrapeBCRJobs() {
  console.log("=== Step 3: Scraping BCR job listings (with Puppeteer) ===\n");
  console.log(`Fetching: ${BCR_CAREERS_URL}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    // Navigate to careers page
    await page.goto(BCR_CAREERS_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    
    // Extract job links from the page
    const jobLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="job"], a[href*="position"], a[href*="careers"]'));
      return links
        .map(a => a.href)
        .filter(href => href && href.includes('erstegroup-careers.com'))
        .filter((href, index, self) => self.indexOf(href) === index); // unique only
    });
    
    console.log(`Found ${jobLinks.length} unique job links`);
    
    // Visit each job page to get details and verify it's a real job page
    const jobs = [];
    for (const url of jobLinks) {
      try {
        console.log(`  Checking: ${url}`);
        
        // Navigate to job page
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });
        
        // Check for 404 or error status
        if (!response || response.status() >= 400) {
          console.log(`    ❌ HTTP ${response?.status() || 'ERR'} - skipping`);
          continue;
        }
        
        // Extract job details and verify it's a job page
        const jobData = await page.evaluate((jobUrl) => {
          const title = document.querySelector('h1, .job-title, [class*="title"]')?.innerText?.trim();
          const location = document.querySelector('[class*="location"], .job-location')?.innerText?.trim();
          const description = document.querySelector('[class*="description"], .job-description, [class*="content"]')?.innerText?.trim();
          const bodyText = document.body.innerText.toLowerCase();
          
          // Check if this is actually a job page
          const hasJobIndicators = 
            (title && title.length > 5) &&
            (bodyText.includes('responsibilities') || 
             bodyText.includes('requirements') || 
             bodyText.includes('job description') ||
             bodyText.includes('loc de munca') ||
             bodyText.includes('apply') || 
             bodyText.includes('aplica'));
          
          // Check for expired/removed indicators
          const expiredIndicators = [
            'job not found', 'position not found', 'job expired', 
            'posting expired', 'no longer available', 
            'nu mai este disponibil', 'locul nu mai este disponibil',
            '404', 'not found'
          ];
          
          const isExpired = expiredIndicators.some(indicator => bodyText.includes(indicator));
          
          return { 
            title, 
            location, 
            description: description?.substring(0, 500), 
            isJobPage: hasJobIndicators && !isExpired,
            isExpired,
            url: jobUrl,
            pageTitle: document.title
          };
        }, url);
        
        if (jobData.isJobPage && jobData.title) {
          jobs.push({
            url: jobData.url,
            title: jobData.title,
            location: jobData.location ? [jobData.location] : ['România'],
            department: 'Unknown',
            workmode: 'on-site',
            tags: []
          });
          console.log(`    ✅ Valid job: ${jobData.title}`);
        } else {
          console.log(`    ❌ Not a valid job page${jobData.isExpired ? ' (expired)' : ''}`);
        }
        
        // Small delay to avoid rate limiting
        await sleep(1000);
        
      } catch (err) {
        console.log(`    ⚠️ Error checking job: ${err.message}`);
      }
    }
    
    console.log(`Found ${jobs.length} valid jobs on BCR careers page`);
    return jobs;

  } catch (err) {
    console.error("Error scraping BCR jobs:", err.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Verifies if a job page is still valid (not expired/removed)
 * Uses Puppeteer to check page content
 * @param {string} url - Job URL to verify
 * @param {string} title - Job title for logging
 * @returns {Promise<boolean>} - True if job page is still valid
 */
async function verifyJobPage(url, title = 'Unknown') {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    
    // Check for 404 or error status
    if (!response || response.status() >= 400) {
      console.log(`    ❌ HTTP ${response?.status() || 'ERR'} - ${title}`);
      return false;
    }
    
    // Check page content for expiration indicators
    const pageData = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      
      const expiredIndicators = [
        'job not found', 'position not found', 'job expired', 
        'posting expired', 'no longer available', 
        'nu mai este disponibil', 'locul nu mai este disponibil',
        '404', 'not found'
      ];
      
      const isExpired = expiredIndicators.some(indicator => bodyText.includes(indicator));
      
      // Check if it still looks like a job page
      const jobIndicators = [
        'job', 'position', 'role', 'responsibilities', 'requirements',
        'loc de munca', 'job description', 'apply', 'aplica', 'candidat'
      ];
      
      const hasJobContent = jobIndicators.some(indicator => bodyText.includes(indicator));
      
      return { isExpired, hasJobContent, title: document.title };
    });
    
    if (pageData.isExpired) {
      console.log(`    ❌ Job expired: ${pageData.title}`);
      return false;
    }
    
    if (!pageData.hasJobContent) {
      console.log(`    ❌ Not a job page anymore: ${pageData.title}`);
      return false;
    }
    
    return true;
    
  } catch (err) {
    console.log(`    ⚠️ Error verifying job: ${err.message}`);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

// ============================================================================
// DATA TRANSFORMATION - Map to Job Model schema
// ============================================================================

/**
 * Maps raw job data to Solr-compatible job model
 * @param {Object} rawJob - Job object from scraper
 * @param {string} cif - Company CIF
 * @param {string} companyName - Company name
 * @returns {Object} - Job object ready for Solr
 */
function mapToJobModel(rawJob, cif, companyName = COMPANY_NAME) {
  const now = new Date().toISOString();

  const job = {
    url: rawJob.url,
    title: rawJob.title.substring(0, 200), // Max 200 chars per model
    company: companyName,
    cif: cif,
    location: rawJob.location?.length ? rawJob.location : undefined,
    tags: rawJob.tags?.length ? rawJob.tags.map(t => t.toLowerCase().replace(/[ăâîșț]/g, '')) : undefined, // Remove diacritics per model
    workmode: rawJob.workmode || undefined,
    salary: rawJob.salary || undefined,
    date: now,
    status: "scraped"
  };

  // Remove undefined fields
  Object.keys(job).forEach((k) => job[k] === undefined && delete job[k]);

  return job;
}

/**
 * Transforms jobs for Solr storage
 * - Company name to UPPERCASE
 * - Filter/validate locations
 * - Normalize workmode
 * 
 * @param {Object} payload - Object with jobs array
 * @returns {Object} - Transformed payload
 */
function transformJobsForSOLR(payload) {
  // Romanian cities for validation
  const romanianCities = [
    'București', 'Bucuresti', 'Cluj-Napoca', 'Cluj Napoca',
    'Timișoara', 'Timisoara', 'Iași', 'Iasi', 'Brașov', 'Brasov',
    'Constanța', 'Constanta', 'Craiova', 'Bacău', 'Sibiu',
    'Târgu Mureș', 'Targu Mures', 'Oradea', 'Baia Mare', 'Satu Mare',
    'Ploiești', 'Ploiesti', 'Pitești', 'Pitesti', 'Arad', 'Galați', 'Galati',
    'Brăila', 'Braila', 'Drobeta-Turnu Severin', 'Râmnicu Vâlcea', 'Ramnicu Valcea',
    'Buzău', 'Buzau', 'Botoșani', 'Botosani', 'Zalău', 'Zalau', 'Hunedoara', 'Deva',
    'Suceava', 'Bistrița', 'Bistrita', 'Tulcea', 'Călărași', 'Calarasi',
    'Giurgiu', 'Alba Iulia', 'Slatina', 'Piatra Neamț', 'Piatra Neamt', 'Roman',
    'Dumbrăvița', 'Dumbravita', 'Voluntari', 'Popești-Leordeni', 'Popesti-Leordeni',
    'Chitila', 'Mogoșoaia', 'Mogosoaia', 'Otopeni', 'Calarasi', 'Timis'
  ];

  const citySet = new Set(romanianCities.map(c => c.toLowerCase()));

  const normalizeWorkmode = (wm) => {
    if (!wm) return undefined;
    const lower = wm.toLowerCase();
    if (lower.includes('remote')) return 'remote';
    if (lower.includes('office') || lower.includes('on-site') || lower.includes('site')) return 'on-site';
    return 'hybrid';
  };

  const transformed = {
    ...payload,
    company: payload.company?.toUpperCase(),
    jobs: payload.jobs.map(job => {
      // Filter locations to valid Romanian cities
      const validLocations = (job.location || []).filter(loc => {
        const lower = loc.toLowerCase().trim();
        if (lower === 'romania' || lower === 'românia') return true;
        return citySet.has(lower);
      }).map(loc => loc.toLowerCase() === 'romania' ? 'România' : loc);

      return {
        ...job,
        location: validLocations.length > 0 ? validLocations : ['România'],
        workmode: normalizeWorkmode(job.workmode)
      };
    })
  };

  return transformed;
}

// ============================================================================
// MAIN ORCHESTRATION
// ============================================================================

/**
 * Main function - orchestrates the complete scraping workflow
 */
async function main() {
  const testOnlyOnePage = process.argv.includes("--test");
  
  try {
    // Step 1: Validate company via ANAF
    console.log("=== Step 1: Validate company via ANAF ===\n");
    const companyData = await validateAndGetCompany();
    COMPANY_NAME = companyData.company;
    const cif = companyData.cif;

    // Step 2: Check existing jobs in SOLR
    console.log("\n=== Step 2: Check existing jobs in SOLR ===\n");
    const existingJobs = await querySOLR(cif);
    console.log(`Jobs found in SOLR for CIF ${cif}: ${existingJobs.numFound}`);

    // Step 3: Scrape BCR job listings (with Puppeteer)
    const scrapedJobs = await scrapeBCRJobs();

    if (scrapedJobs.length === 0) {
      console.log("\n⚠️ No jobs scraped. Keeping existing jobs in SOLR.");
      return;
    }

    console.log(`\n=== Step 4: Scraped ${scrapedJobs.length} jobs ===\n`);

    // Step 5: Map to Job Model schema
    const jobsForSolr = scrapedJobs.map(job => mapToJobModel(job, cif));

    // Step 6: Transform for SOLR
    const payload = transformJobsForSOLR({
      company: COMPANY_NAME,
      cif: cif,
      jobs: jobsForSolr
    });

    // Step 7: Upsert to SOLR
    console.log(`\n=== Step 7: Upsert ${payload.jobs.length} jobs to SOLR ===\n`);
    await upsertJobs(payload.jobs);

    // Step 8: Delete old jobs not found in current scrape
    console.log("\n=== Step 8: Clean up old jobs ===\n");
    const currentUrls = new Set(scrapedJobs.map(j => j.url));
    
    if (existingJobs.docs) {
      const oldJobs = existingJobs.docs.filter(job => !currentUrls.has(job.url));
      
      if (oldJobs.length > 0) {
        console.log(`Found ${oldJobs.length} old jobs to delete:`);
        for (const job of oldJobs) {
          console.log(`  Deleting: ${job.title} - ${job.url}`);
          await deleteJobByUrl(job.url);
        }
      } else {
        console.log("No old jobs to delete.");
      }
    }

    // Step 9: Verify all current jobs are still valid (not expired)
    console.log("\n=== Step 9: Verify current jobs with Puppeteer ===\n");
    console.log(`Checking ${scrapedJobs.length} scraped jobs for expiration...`);
    
    for (const job of scrapedJobs) {
      try {
        const isValid = await verifyJobPage(job.url);
        if (!isValid) {
          console.log(`  ❌ Job expired or invalid: ${job.title} - ${job.url}`);
          await deleteJobByUrl(job.url);
        } else {
          console.log(`  ✅ Job still valid: ${job.title}`);
        }
        await sleep(1000); // Rate limiting
      } catch (err) {
        console.log(`  ⚠️ Error verifying job: ${job.title} - ${err.message}`);
      }
    }

    console.log("\n✅ Scraping completed successfully!");

  } catch (err) {
    console.error("\n❌ Error in main workflow:", err.message);
    process.exit(1);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { scrapeBCRJobs, mapToJobModel };

// ============================================================================
// ENTRY POINT
// ============================================================================

// Only run main() if this file is executed directly (not imported)
if (process.argv[1]?.endsWith("index.js") || import.meta.url === `file://${process.argv[1]}`) {
  main();
}
