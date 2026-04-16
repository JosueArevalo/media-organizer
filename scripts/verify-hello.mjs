const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000/api/health';
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

const fail = (message) => {
  console.error(`[verify:hello] ${message}`);
  process.exit(1);
};

const checkBackend = async () => {
  const res = await fetch(backendUrl);
  if (!res.ok) {
    fail(`Backend returned HTTP ${res.status} at ${backendUrl}`);
  }

  const body = await res.json();
  if (body?.status !== 'ok') {
    fail(`Backend response did not contain status=ok. Received: ${JSON.stringify(body)}`);
  }

  console.log(`[verify:hello] Backend OK (${backendUrl})`);
};

const checkFrontend = async () => {
  const res = await fetch(frontendUrl);
  if (!res.ok) {
    fail(`Frontend returned HTTP ${res.status} at ${frontendUrl}`);
  }

  const html = await res.text();
  if (!/<title>\s*Media Organizer Dashboard\s*<\/title>/i.test(html)) {
    fail(`Frontend title check failed at ${frontendUrl}`);
  }

  console.log(`[verify:hello] Frontend OK (${frontendUrl})`);
};

const main = async () => {
  try {
    await checkBackend();
    await checkFrontend();
    console.log('[verify:hello] End-to-end hello world verification passed.');
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
};

main();
