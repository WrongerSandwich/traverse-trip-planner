// This endpoint was retired in #138. The file is kept as a stub so that
// tests/api-itinerary.test.js continues to import cleanly until the
// dead-code cleanup pass in #139 removes both this stub and the test file.
export function POST() {
  return new Response('Gone', { status: 410 });
}
