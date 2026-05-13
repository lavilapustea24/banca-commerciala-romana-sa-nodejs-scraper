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

import puppeteer from "puppeteer";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, upsertJobs } from "./solr.js";

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
    
    // Navigate to careers page and wait for job table to render
    await page.goto(BCR_CAREERS_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    await page.waitForSelector('table#searchresults tbody tr.data-row', { timeout: TIMEOUT });
    
    // Extract job details directly from the listing table
    const jobs = await page.evaluate(() => {
      const baseUrl = 'https://erstegroup-careers.com';
      const rows = Array.from(document.querySelectorAll('table#searchresults tbody tr.data-row'));
      
      return rows.map(row => {
        const linkEl = row.querySelector('a.jobTitle-link');
        const locationEl = row.querySelector('td.colShifttype span.jobShifttype');
        const departmentEl = row.querySelector('td.colFacility span.jobFacility');
        
        const href = linkEl?.getAttribute('href') || '';
        const fullUrl = href.startsWith('http') ? href : baseUrl + href;
        
        const locText = locationEl?.innerText?.trim() || 'România';
        
        return {
          url: fullUrl,
          title: linkEl?.innerText?.trim() || '',
          location: [locText],
          department: departmentEl?.innerText?.trim() || 'Unknown',
          workmode: 'on-site',
          tags: []
        };
      });
    });
    
    console.log(`Found ${jobs.length} valid jobs on BCR careers page`);
    return jobs;

  } catch (err) {
    console.error("Error scraping BCR jobs:", err.message);
    return [];
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
    'Chitila', 'Mogoșoaia', 'Mogosoaia', 'Otopeni', 'Calarasi', 'Timis',
    'Caras-Severin', 'Caraș-Severin'
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

    console.log("\n✅ Scraping completed successfully!");

  } catch (err) {
    console.error("\n❌ Error in main workflow:", err.message);
    process.exit(1);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { scrapeBCRJobs, mapToJobModel, transformJobsForSOLR };

// ============================================================================
// ENTRY POINT
// ============================================================================

// Only run main() if this file is executed directly (not imported)
if (process.argv[1]?.endsWith("index.js") || import.meta.url === `file://${process.argv[1]}`) {
  main();
}
