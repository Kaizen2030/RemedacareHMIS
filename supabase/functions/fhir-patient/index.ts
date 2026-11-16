// Retired: the May 2026 fhir-patient function answered anyone without a sign-in. Use the FHIR API instead:
//   GET /functions/v1/fhir/Patient?identifier=…
// with an API key from Settings → FHIR API. This stub stays deployed so the old address stops returning data.
Deno.serve(() => new Response(JSON.stringify({
  resourceType: 'OperationOutcome',
  issue: [{ severity: 'error', code: 'not-supported', diagnostics: 'This endpoint has been retired. Use /functions/v1/fhir with an API key (see /functions/v1/fhir/metadata).' }],
}), { status: 410, headers: { 'Content-Type': 'application/fhir+json', 'Access-Control-Allow-Origin': '*' } }))
