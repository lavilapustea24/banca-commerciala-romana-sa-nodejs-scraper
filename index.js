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
 * Scrapes job listings from BCR SuccessFactors page
 * Note: BCR uses SuccessFactors which requires JavaScript rendering.
 * This is a simplified version - in production you might need Puppeteer/Playwright.
 * 
 * @returns {Promise<Array>} - Array of job objects
 */
async function scrapeBCRJobs() {
  console.log("=== Step 3: Scraping BCR job listings ===\n");
  console.log(`Fetching: ${BCR_CAREERS_URL}`);

  try {
    const res = await fetch(BCR_CAREERS_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      timeout: TIMEOUT
    });

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status} for ${BCR_CAREERS_URL}`);
    }

    const html = await res.text();
    
    // Parse job listings from HTML
    // SuccessFactors structure: jobs are in tables/divs with specific classes
    const jobs = parseBCRJobsFromHTML(html);
    
    console.log(`Found ${jobs.length} jobs on BCR careers page`);
    return jobs;

  } catch (err) {
    console.error("Error scraping BCR jobs:", err.message);
    // Return empty array if scraping fails
    return [];
  }
}

/**
 * Parses HTML content to extract job listings
 * This is a simplified parser - actual implementation depends on page structure
 * 
 * @param {string} html - HTML content of BCR careers page
 * @returns {Array} - Array of job objects with url, title, location, department
 */
function parseBCRJobsFromHTML(html) {
  const jobs = [];
  
  // Basic regex-based extraction (simplified)
  // In production, use cheerio or similar for proper HTML parsing
  
  // Look for job links pattern: /bcr/job/...
  const jobLinkRegex = /href="(\/bcr\/job\/[^"]+)"/g;
  const titleRegex = />([^<]+)<\/a>/g;
  
  let match;
  const jobLinks = [];
  
  while ((match = jobLinkRegex.exec(html)) !== null) {
    jobLinks.push(match[1]);
  }
  
  // Remove duplicates
  const uniqueLinks = [...new Set(jobLinks)];
  
  console.log(`Found ${uniqueLinks.length} unique job links`);
  
  // For each job link, create a basic job object
  // In a full implementation, you'd fetch each job page for details
  uniqueLinks.forEach((link, index) => {
    const url = `https://erstegroup-careers.com${link}`;
    
    // Extract title from URL (simplified)
    // URL format: /bcr/job/Location-Job-Title/1388723633/
    const urlParts = link.split('/').filter(p => p);
    const titleFromUrl = urlParts.length > 2 ? urlParts[2] : 'Job Position';
    
    // Convert URL-friendly title back to readable format
    const title = titleFromUrl
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase()); // Simple title case
    
    // Extract location from URL (first part before dash)
    const locationMatch = titleFromUrl.match(/^([A-Za-z]+)-/);
    const location = locationMatch ? [locationMatch[1]] : ['România'];
    
    jobs.push({
      url,
      title,
      location,
      department: 'Unknown', // Would need to fetch job page for details
      workmode: 'on-site', // Default, would need to check job details
      tags: [] // Would extract from job description
    });
  });
  
  return jobs;
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
    // Step 2: Validate company via ANAF (this also gets the CIF)
    console.log("\n=== Step 2: Validate company via ANAF ===");
    const { company, cif } = await validateAndGetCompany();
    COMPANY_NAME = company;
    const localCif = cif;
    
    // Step 1: Get existing jobs count from Solr (moved here to use the dynamic CIF)
    console.log("=== Step 1: Get existing jobs count ===");
    const existingResult = await querySOLR(localCif);
    const existingCount = existingResult.numFound;
    console.log(`Found ${existingCount} existing jobs in SOLR`);
    
    // Step 3: Scrape jobs from BCR careers page
    const rawJobs = await scrapeBCRJobs();
    const scrapedCount = rawJobs.length;
    console.log(`📊 Jobs scraped from BCR website: ${scrapedCount}`);

    if (scrapedCount === 0) {
      console.log("No jobs found. Exiting.");
      return;
    }

    // Step 4: Map to Job Model
    const jobs = rawJobs.map(job => mapToJobModel(job, localCif));

    // Create payload
    const payload = {
      source: "bcr.ro",
      scrapedAt: new Date().toISOString(),
      company: COMPANY_NAME,
      cif: localCif,
      jobs
    };

    // Step 5: Transform for Solr
    console.log("\nTransforming jobs for SOLR...");
    const transformedPayload = transformJobsForSOLR(payload);
    
    // Save to file for debugging
    fs.writeFileSync("jobs.json", JSON.stringify(transformedPayload, null, 2), "utf-8");
    console.log("Saved jobs.json");

    // Step 6: Delete old jobs (those not in current scrape)
    console.log("\n=== Step 6: Delete old jobs ===");
    const currentUrls = new Set(transformedPayload.jobs.map(j => j.url));
    const oldJobsResult = await querySOLR(localCif);
    
    for (const oldJob of oldJobsResult.docs) {
      if (!currentUrls.has(oldJob.url)) {
        console.log(`Deleting old job: ${oldJob.title}`);
        await deleteJobByUrl(oldJob.url);
      }
    }
    
    // Step 7: Upsert to Solr
    console.log("\n=== Step 7: Upsert jobs to SOLR ===");
    await upsertJobs(transformedPayload.jobs);

    // Step 7: Final count
    const finalResult = await querySOLR(localCif);
    console.log(`\n📊 === SUMMARY ===`);
    console.log(`📊 Jobs existing in SOLR before scrape: ${existingCount}`);
    console.log(`📊 Jobs scraped from BCR website: ${scrapedCount}`);
    console.log(`📊 Jobs in SOLR after scrape: ${finalResult.numFound}`);
    console.log(`====================`);

    console.log("\n=== DONE ===");
    console.log("BCR scraper completed successfully!");

  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

// Export functions for testing
export { scrapeBCRJobs, mapToJobModel, transformJobsForSOLR };

// Run main when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
