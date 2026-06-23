# Static Hosting

This app can be hosted as a static site. You do not need the local Node server for the normal learning workflow.

## GitHub Pages

1. Create a new GitHub repository.
2. Upload the files from this folder.
3. In GitHub, open Settings -> Pages.
4. Set the source to the main branch.
5. Open the GitHub Pages URL after it finishes publishing.

## Password

The app uses a browser password screen from `site-config.js`.

Default password:

```text
papertrade
```

This is casual privacy for a static learning app. It is not the same as private server security because static hosts still send the app files to the browser.

To change the password:

1. Pick a new password.
2. Generate a SHA-256 hash for it.
3. Replace `passwordHash` in `site-config.js`.

## Static Host Options

These hosts can serve this app without a server:

- GitHub Pages
- Netlify
- Cloudflare Pages
- Vercel static project

For stronger privacy later, use the host's built-in access protection, such as Cloudflare Access or Netlify password protection.
