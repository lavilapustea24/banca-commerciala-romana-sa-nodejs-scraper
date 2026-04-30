import fetch from "node-fetch";

const SOLR_URL = "https://solr.peviitor.ro/solr/job";

const params = new URLSearchParams({
  q: "*:*",
  rows: 1,
  wt: "json"
});

try {
  // Try with Basic Auth
  const AUTH = "solr:SolrRocks";
  const res = await fetch(`${SOLR_URL}/select?${params}`, {
    headers: {
      "Authorization": "Basic " + Buffer.from(AUTH).toString("base64")
    }
  });
  
  console.log(`Status (with auth): ${res.status}`);
  
  if (!res.ok) {
    const text = await res.text();
    console.log("Response:", text.substring(0, 500));
  } else {
    const data = await res.json();
    console.log("✅ Solr is accessible with auth!");
    console.log(`Found ${data.response.numFound} jobs in index`);
  }
} catch (err) {
  console.error("Error:", err.message);
}
