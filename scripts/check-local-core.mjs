const endpoints = [
  ['API health', 'http://localhost:4000/api/v1/health'],
  ['Customers', 'http://localhost:4000/api/v1/customers?organizationId=org_demo'],
  ['Channels', 'http://localhost:4000/api/v1/funding-channels?organizationId=org_demo'],
];

let failed = false;
for (const [name, url] of endpoints) {
  try {
    const response = await fetch(url, { headers: { 'x-user-id': 'usr_admin' } });
    console.log(`${response.ok ? 'PASS' : 'FAIL'} ${name} ${response.status}`);
    failed ||= !response.ok;
  } catch (error) {
    failed = true;
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : error}`);
  }
}
process.exit(failed ? 1 : 0);
