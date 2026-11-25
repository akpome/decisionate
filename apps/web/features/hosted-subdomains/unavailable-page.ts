// Keep unavailable portals independent of Clerk, client scripts and private branding.
export const unavailablePortalPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="color-scheme" content="light dark">
  <title>Portal unavailable</title>
  <link rel="icon" href="/icons/portal-unavailable.svg" type="image/svg+xml">
  <style>
    :root { color-scheme: light dark; --background: #f8faf9; --text: #172321; --muted: #52615e; --accent: #0f766e; --button: #172321; --button-text: #fff; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--background); color: var(--text); font-family: Arial, Helvetica, sans-serif; letter-spacing: 0; }
    .shell { display: grid; align-items: center; min-height: 100vh; min-height: 100svh; padding: 64px 32px; }
    main { width: 100%; max-width: 520px; margin: 0 auto; }
    .portal-icon { display: block; width: 64px; height: 64px; margin-bottom: 32px; }
    .status { margin: 0 0 14px; color: var(--accent); font-size: 14px; font-weight: 600; line-height: 1.5; }
    h1 { max-width: 460px; margin: 0; font-size: 36px; line-height: 1.18; font-weight: 600; overflow-wrap: anywhere; }
    .description { max-width: 450px; margin: 22px 0 30px; color: var(--muted); font-size: 16px; line-height: 1.65; }
    .retry { display: inline-flex; align-items: center; justify-content: center; min-height: 46px; padding: 12px 22px; border: 1px solid var(--button); border-radius: 6px; background: var(--button); color: var(--button-text); text-decoration: none; font-size: 15px; font-weight: 600; line-height: 1.4; }
    .retry:hover { opacity: .88; }
    .retry:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }
    @media (max-width: 480px) { .shell { padding: 40px 24px; } }
    @media (prefers-color-scheme: dark) { :root { --background: #111918; --text: #f2f6f5; --muted: #b4c2be; --accent: #6ed3bb; --button: #f2f6f5; --button-text: #172321; } }
  </style>
</head>
<body>
  <div class="shell">
    <main aria-labelledby="portal-unavailable-title">
      <img class="portal-icon" src="/icons/portal-unavailable.svg" width="64" height="64" alt="" aria-hidden="true">
      <p class="status">Portal unavailable</p>
      <h1 id="portal-unavailable-title">We can't open this portal.</h1>
      <p class="description">Check the web address, or contact the workspace owner who shared this link with you.</p>
      <a class="retry" href="/">Try again</a>
    </main>
  </div>
</body>
</html>`

export const unavailablePortalHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}
