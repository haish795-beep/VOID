# VOID BOT - Simple Express Backend

This minimal backend provides API endpoints for authentication, posts, bug reports and file uploads for the `bot-site` frontend.

Quick start

1. Open a terminal in `site/bot-site/server`.
2. Install dependencies:

```bash
npm install
```

3. Start server:

```bash
npm start
```

4. Open http://localhost:3000/index.html to view the site. The frontend will try to call API endpoints under `/api/*`.

Notes

- Uploaded files are stored in the `server/uploads/` directory and served at `/uploads/<filename>`.
- The server uses a simple JSON file `db.json` for persistence. This is not production-safe — replace with a proper DB for production.
- JWT secret can be set with `JWT_SECRET` environment variable.
