import fetch from "node-fetch";

const SOLR_URL = "https://solr.peviitor.ro/solr/job";
const AUTH = "solr:SolrRocks";

const testJob = {
  url: "https://test-bcr.ro/job/test-position",
  title: "Test Position BCR",
  company: "BANCA COMERCIALA ROMANA SA",
  cif: "361757",
  location: ["București"],
  tags: ["test"],
  workmode: "on-site",
  date: new Date().toISOString(),
  status: "scraped"
};

try {
  // Try to upsert (insert/update) the test job
  const params = new URLSearchParams({ commit: "true" });
  
  const res = await fetch(`${SOLR_URL}/update?${params}`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(AUTH).toString("base64"),
      "Content-Type": "application/json"
    },
    body: JSON.stringify([testJob])
  });
  
  console.log(`Upsert status: ${res.status}`);
  
  if (!res.ok) {
    const text = await res.text();
    console.log("Error response:", text.substring(0, 500));
  } else {
    console.log("✅ Test job inserted successfully!");
    
    // Now try to delete the test job
    const deleteQuery = JSON.stringify({
      delete: { query: `url:"${testJob.url}"` }
    });
    
    const delRes = await fetch(`${SOLR_URL}/update?${params}`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(AUTH).toString("base64"),
        "Content-Type": "application/json"
      },
      body: deleteQuery
    });
    
    console.log(`Delete status: ${delRes.status}`);
    if (delRes.ok) {
      console.log("✅ Test job deleted successfully!");
    }
  }
} catch (err) {
  console.error("Error:", err.message);
}
