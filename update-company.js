/**
 * Update BCR company data in SOLR company core
 * Run: node update-company.js
 */

import fetch from "node-fetch";

const SOLR_COMPANY_URL = "https://solr.peviitor.ro/solr/company";
const AUTH = process.env.SOLR_AUTH || "solr:SolrRocks";

async function main() {
  console.log("=".repeat(50));
  console.log("Update BCR Company Data in SOLR");
  console.log("=".repeat(50));

  // Correct company data per demoANAF
  const companyData = [{
    id: "361757",
    company: "BANCA COMERCIALA ROMANA SA",
    brand: "BCR",
    status: "activ",
    location: ["București"],
    website: ["https://www.bcr.ro"],
    career: ["https://erstegroup-careers.com/bcr/go/bcr-careire/4305601/"],
    lastScraped: "2026-04-30",
    scraperFile: "https://raw.githubusercontent.com/lavilapustea24/banca-commerciala-romana-sa-nodejs-scraper/master/.github/workflows/scrape.yml"
  }];

  // First delete old data
  console.log("\nStep 1: Delete old company data...");
  const delRes = await fetch(`${SOLR_COMPANY_URL}/update?commit=true`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(AUTH).toString("base64"),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ delete: { query: "id:361757" } })
  });

  console.log(`Delete status: ${delRes.status}`);
  if (!delRes.ok) {
    console.log("Delete response:", await delRes.text());
  }

  // Add correct data
  console.log("\nStep 2: Add correct company data...");
  const addRes = await fetch(`${SOLR_COMPANY_URL}/update?commit=true`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(AUTH).toString("base64"),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(companyData)
  });

  console.log(`Add status: ${addRes.status}`);
  
  if (addRes.ok) {
    console.log("✅ Company data updated successfully!");
    
    // Verify
    console.log("\nStep 3: Verify update...");
    const verifyRes = await fetch(`${SOLR_COMPANY_URL}/select?q=id:361757&rows=1&wt=json`, {
      headers: {
        "Authorization": "Basic " + Buffer.from(AUTH).toString("base64")
      }
    });
    
    if (verifyRes.ok) {
      const data = await verifyRes.json();
      if (data.response.numFound > 0) {
        console.log("✅ Verification passed!");
        console.log("Company:", data.response.docs[0].company);
        console.log("Brand:", data.response.docs[0].brand);
      }
    }
  } else {
    console.log("❌ Update failed:", await addRes.text());
  }
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
