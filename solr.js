/**
 * Solr Database Module
 * 
 * PURPOSE: Provides interface to Solr database for storing and retrieving
 * job listings and company data. Solr is used as the primary data store
 * for the peviitor.ro job aggregation system.
 * 
 * This module handles:
 * - Querying jobs by company CIF
 * - Querying company data
 * - Adding/updating (upserting) jobs
 * - Deleting jobs by CIF or URL
 * - URL validation and cleanup
 * 
 * Solr Cores:
 * - job: Stores individual job listings
 * - company: Stores company metadata
 */

import fetch from "node-fetch";
import fs from "fs";
import puppeteer from "puppeteer";

// ============================================================================
// CONFIGURATION
// ============================================================================

// Solr core URLs
const SOLR_URL = "https://solr.peviitor.ro/solr/job";        // Job listings core
const SOLR_COMPANY_URL = "https://solr.peviitor.ro/solr/company"; // Company core

// HTTP request timeout in milliseconds
const TIMEOUT = 10000;

/**
 * Gets SOLR_AUTH from environment
 * @returns {string} - Base64 encoded auth credentials
 */
export function getSolrAuth() {
  return process.env.SOLR_AUTH;
}

// ============================================================================
// JOB OPERATIONS - Query, Add, Update, Delete
// ============================================================================

/**
 * Queries jobs from Solr by company CIF
 * @param {string} cif - Company CIF/CUI to search for
 * @returns {Promise<Object>} - Solr response with numFound and docs array
 */
export async function querySOLR(cif) {
  const AUTH = process.env.SOLR_AUTH;
  if (!AUTH) throw new Error("SOLR_AUTH not set in environment");

  const params = new URLSearchParams({
    q: `cif:${cif}`,  // Query by CIF field
    rows: 100,        // Limit results
    wt: "json"        // Return JSON format
  });

  const res = await fetch(`${SOLR_URL}/select?${params}`, {
    headers: {
      "Authorization": "Basic " + Buffer.from(AUTH).toString("base64"),
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SOLR query error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  return data.response;
}

// ============================================================================
// COMPANY OPERATIONS - Query company data from Solr
// ============================================================================

/**
 * Queries company data from Solr company core
 * @param {string} companyQuery - Solr query string (e.g., "company:BCR*" or "id:361757")
 * @returns {Promise<Object>} - Solr response with company docs
 */
export async function queryCompanySOLR(companyQuery) {
  const AUTH = process.env.SOLR_AUTH;
  if (!AUTH) throw new Error("SOLR_AUTH not set in environment");

  const params = new URLSearchParams({
    q: companyQuery,
    rows: 10,
    wt: "json"
  });

  const res = await fetch(`${SOLR_COMPANY_URL}/select?${params}`, {
    headers: {
      "Authorization": "Basic " + Buffer.from(AUTH).toString("base64"),
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SOLR company query error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  return data.response;
}

// ============================================================================
// DELETE OPERATIONS - Remove jobs from Solr
// ============================================================================

/**
 * Deletes all jobs for a company by CIF
 * Used when a company becomes inactive in ANAF
 * @param {string} cif - Company CIF to delete jobs for
 */
export async function deleteJobsByCIF(cif) {
  const AUTH = process.env.SOLR_AUTH;
  if (!AUTH) throw new Error("SOLR_AUTH not set in environment");

  const params = new URLSearchParams({ commit: "true" });

  // Use Solr delete by query
  const deleteQuery = JSON.stringify({
    delete: { query: `cif:${cif}` }
  });

  const res = await fetch(`${SOLR_URL}/update?${params}`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(AUTH).toString("base64"),
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    body: deleteQuery
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SOLR delete error: ${res.status} - ${text}`);
  }

  console.log("✅ Jobs deleted from SOLR.");
}

/**
 * Deletes a single job by its URL
 * Used when a job posting is no longer available
 * @param {string} url - Job URL to delete
 */
export async function deleteJobByUrl(url) {
  const AUTH = process.env.SOLR_AUTH;
  if (!AUTH) throw new Error("SOLR_AUTH not set in environment");

  const params = new URLSearchParams({ commit: "true" });

  const deleteQuery = JSON.stringify({
    delete: { query: `url:"${url}"` }
  });

  const res = await fetch(`${SOLR_URL}/update?${params}`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(AUTH).toString("base64"),
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    body: deleteQuery
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SOLR delete error: ${res.status} - ${text}`);
  }
}

// ============================================================================
// UPSERT OPERATIONS - Add or update jobs
// ============================================================================

/**
 * Upserts (adds or updates) jobs to Solr
 * Jobs are matched by URL - if URL exists, job is updated; otherwise, new job is added
 * @param {Array} jobs - Array of job objects to upsert
 */
export async function upsertJobs(jobs) {
  const AUTH = process.env.SOLR_AUTH;
  if (!AUTH) throw new Error("SOLR_AUTH not set in environment");

  const params = new URLSearchParams({ commit: "true" });

  const body = JSON.stringify(jobs);

  const res = await fetch(`${SOLR_URL}/update?${params}`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(AUTH).toString("base64"),
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SOLR upsert error: ${res.status} - ${text}`);
  }

  console.log(`✅ Upserted ${jobs.length} jobs to SOLR.`);
}

// ============================================================================
// URL VALIDATION - Verify job URLs are still active
// ============================================================================

/**
 * Checks if a job URL is still valid using Puppeteer
 * Verifies: 1) Page loads without 404, 2) Page contains job description content
 * @param {string} url - URL to check
 * @returns {Promise<Object>} - Status info {url, status, valid, error, isJobPage}
 */
async function checkUrl(url) {
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
      return { url, status: response?.status() || 0, valid: false, isJobPage: false };
    }
    
    // Check if page contains job-related content (not expired/removed)
    const pageContent = await page.evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      
      // Check for common "job not found" or "expired" indicators
      const expiredIndicators = [
        'job not found', 'position not found', 'job expired', 'posting expired',
        'no longer available', 'nu mai este disponibil', 'locul nu mai este disponibil',
        '404', 'not found', 'error', 'expired'
      ];
      
      const hasExpired = expiredIndicators.some(indicator => body.includes(indicator));
      
      // Check if it looks like a job page (has job-related content)
      const jobIndicators = [
        'job', 'position', 'role', 'responsibilities', 'requirements',
        'loc de muncă', 'job description', 'apply', 'aplică', 'candidat'
      ];
      
      const hasJobContent = jobIndicators.some(indicator => body.includes(indicator));
      
      return { hasExpired, hasJobContent, title: document.title };
    });
    
    const isValid = !pageContent.hasExpired && pageContent.hasJobContent;
    
    return { 
      url, 
      status: response.status(), 
      valid: isValid, 
      isJobPage: pageContent.hasJobContent,
      title: pageContent.title
    };
    
  } catch (err) {
    return { url, status: 0, valid: false, isJobPage: false, error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

// ============================================================================
// VERIFICATION WORKFLOW - Check and clean up invalid URLs
// ============================================================================

/**
 * Verifies job URLs using Puppeteer to ensure they are valid job description pages
 * Removes expired/invalid jobs from Solr
 */
async function runVerification(cif) {
  console.log("=== Verify SOLR Jobs (with Puppeteer) ===\n");

  // Get current jobs from Solr
  const result = await querySOLR(cif);
  console.log(`Total jobs in SOLR for CIF ${cif}: ${result.numFound}`);

  if (result.numFound === 0) {
    console.log("No jobs to verify.");
    return;
  }

  console.log("\nVerifying each job URL with Puppeteer...");
  
  const invalidUrls = [];
  const validJobs = [];

  for (let i = 0; i < result.docs.length; i++) {
    const job = result.docs[i];
    console.log(`[${i+1}/${result.docs.length}] Checking: ${job.title || 'Unknown'}`);
    console.log(`  URL: ${job.url}`);
    
    const checkResult = await checkUrl(job.url);
    
    if (checkResult.valid && checkResult.isJobPage) {
      console.log(`  ✅ Valid job page (${checkResult.status})`);
      validJobs.push(job);
    } else {
      console.log(`  ❌ Invalid/expired (${checkResult.status}${checkResult.isJobPage ? '' : ', not a job page'})`);
      invalidUrls.push(job.url);
    }
    
    // Small delay between checks
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Delete invalid URLs from Solr
  if (invalidUrls.length > 0) {
    console.log(`\n⚠️ ${invalidUrls.length} invalid/expired jobs found - deleting from SOLR...`);
    for (const url of invalidUrls) {
      await deleteJobByUrl(url);
    }
    console.log(`✅ Deleted ${invalidUrls.length} invalid jobs from SOLR`);
  } else {
    console.log("\n✅ All jobs are valid!");
  }
}

// ============================================================================
// EXTRACT WORKFLOW - Backup jobs before scraping
// ============================================================================

/**
 * Extracts current jobs from Solr and saves to backup file
 * Used before scraping to preserve existing job data
 * @param {string} cif - Company CIF
 */
async function runExtract(cif) {
  console.log("=== Extract existing jobs from SOLR ===\n");

  try {
    const result = await querySOLR(cif);
    console.log(`Found ${result.numFound} existing jobs in SOLR for CIF ${cif}`);

    if (result.numFound === 0) {
      console.log("No existing jobs to backup.");
      return;
    }

    // Save backup
    const backup = {
      extractedAt: new Date().toISOString(),
      cif: cif,
      count: result.numFound,
      jobs: result.docs
    };

    fs.writeFileSync("jobs_existing.json", JSON.stringify(backup, null, 2), "utf-8");
    console.log("\n✅ Saved existing jobs to jobs_existing.json\n");
  } catch (err) {
    console.error("Failed to extract existing jobs:", err.message);
    process.exit(1);
  }
}

// ============================================================================
// COMPANY QUERY WORKFLOW - Query company core
// ============================================================================

/**
 * Queries companies from Solr company core
 * Useful for debugging and verification
 * @param {Array} args - Command line arguments
 */
async function runCompanyQuery(args) {
  console.log("=== Query Company in SOLR ===\n");
  
  const query = args[1] || "company:BCR*";
  console.log(`Query: ${query}`);
  
  const result = await queryCompanySOLR(query);
  console.log(`Found ${result.numFound} companies`);
  
  if (result.docs?.length) {
    console.log("\nFirst company:");
    console.log(JSON.stringify(result.docs[0], null, 2));
  }
}

// ============================================================================
// STANDALONE MODE - Run solr.js directly for maintenance tasks
// ============================================================================

/**
 * Usage:
 *   node solr.js <CIF>              - Verify jobs for a company
 *   node solr.js extract <CIF>      - Extract jobs to backup file
 *   node solr.js company            - Query companies
 */
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("solr.js")) {
  const args = process.argv.slice(2);
  
  if (args.includes("extract")) {
    // Extract mode: backup jobs to file
    const cif = args[1] || null;
    if (!cif) {
      console.error("Error: CIF required. Usage: node solr.js extract <CIF>");
      process.exit(1);
    }
    await runExtract(cif);
  } else if (args.includes("company")) {
    // Company query mode
    await runCompanyQuery(args);
  } else {
    // Verification mode
    const cif = args[0] || null;
    if (!cif) {
      console.error("Error: CIF required. Usage: node solr.js <CIF>");
      process.exit(1);
    }
    await runVerification(cif);
  }
}
