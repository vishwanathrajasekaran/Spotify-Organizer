# VR Spotify Organizer

Ranks your Spotify **Liked Songs** by Last.fm global listening counts and turns them into private playlists.
You can name every playlist yourself, group by rank, popularity tier, album/movie, release year or decade, or year or decade added, filter by artist, album and decade, and give each playlist a generated cover.

**How it works:** it is a static website. Everything runs in your browser. There is no server and no database.
Spotify login uses PKCE (no client secret), and your keys and songs stay in your browser.

**Why bring your own keys?** Spotify limits each app in Development Mode to a handful of users. If everyone uses their own Spotify app,
that limit never applies, and nothing of yours is shared. Spotify no longer provides a track popularity score, so this tool uses Last.fm counts instead.

## What you need
| Account | Cost | Notes |
|---|---|---|
| [GitHub](https://github.com/signup) | Free | Stores the code |
| [Vercel](https://vercel.com/signup) | Free (Hobby plan) | Hosts the site. Sign up with your GitHub account |
| [Spotify](https://developer.spotify.com/dashboard) | Free app, **Premium account required for the app owner** | Development Mode rule |
| [Last.fm](https://www.last.fm/api/account/create) | Free | API key |

Also install [Node.js 18 or newer](https://nodejs.org) if you want to run it on your own computer.

---

## Step 1: Run it on your computer (recommended first)
1. Unzip the project and open a terminal in the folder.
2. Run:
   ```bash
   npm install
   npm run dev
   ```
3. Open **http://127.0.0.1:5173** (use `127.0.0.1`, not `localhost`).
4. Create your keys (see Step 4 for the Spotify app and Step 5 for Last.fm), then paste them on the setup screen.

## Step 2: Put the code on GitHub
**Option A: with the website (no commands)**
1. Go to https://github.com/new, name the repository `vr-spotify-organizer`, choose **Public** or **Private**, and click **Create repository**.
2. Click **uploading an existing file**.
3. Unzip the project on your computer, then drag the **contents** of the folder (`src`, `package.json`, `vercel.json`, `index.html`, and the rest) into the page. Do not upload `node_modules` or `dist` if they exist.
4. Click **Commit changes**.

**Option B: with git**
```bash
cd vr-spotify-organizer
git init
git add .
git commit -m "First version"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/vr-spotify-organizer.git
git push -u origin main
```
The repository contains no secrets, so it is safe to make it public.

## Step 3: Deploy on Vercel
1. Go to https://vercel.com/new and sign in with GitHub.
2. Find `vr-spotify-organizer` and click **Import**.
3. Leave everything as it is. Vercel detects **Vite** automatically. No environment variables are needed.
4. Click **Deploy** and wait about a minute.
5. Copy your address, for example `https://vr-spotify-organizer.vercel.app`. Use this production address, not a preview link (preview links ask for a Vercel login).

## Step 4: Create your Spotify app and connect it to your site
1. Go to https://developer.spotify.com/dashboard and click **Create app**.
2. Enter a name and description, choose **Web API**, and accept the terms.
3. Under **Redirect URIs**, add **both** of these and click **Add** and **Save**:
   - `http://127.0.0.1:5173/callback` (for running on your computer)
   - `https://YOUR-SITE.vercel.app/callback` (your Vercel address plus `/callback`)
4. Open **Settings** and copy the **Client ID**. You do not need the client secret.
5. If you will log in with a different Spotify account than the app owner, add that account under **User Management**.

## Step 5: Create your Last.fm key
1. Go to https://www.last.fm/api/account/create and fill in the form (the callback URL can be blank).
2. Copy the **API key** (not the shared secret).

## Step 6: First use
1. Open your Vercel address. Paste your Spotify **Client ID** and **Last.fm API key**, then click **Save and continue**.
2. Click **Connect Spotify** and approve the permissions.
3. Click **Analyze my songs**. The first run takes a few minutes (about 4 songs per second). Keep the tab open. Results are saved in your browser, so later runs are fast.
4. Choose your options, type your own names into the playlist name boxes, and check the preview.
5. Optional: tick **Add cover art**. Then click **Create / Update playlists**.

## Updating the site
Change the files on GitHub (or push with git). Vercel redeploys automatically.

## Sharing it
Send people your Vercel address. Each person creates their own Spotify app and Last.fm key, and adds `https://YOUR-SITE.vercel.app/callback` to their own Spotify app's redirect URIs.

---

## Troubleshooting
| Problem | Fix |
|---|---|
| "INVALID_CLIENT: Invalid redirect URI" | The redirect URI in your Spotify app must match the address bar exactly, including `https://` and `/callback`. |
| Spotify shows an error on `localhost` | Use `http://127.0.0.1:5173`, not `localhost`. |
| 403 from Spotify | The Spotify app owner needs Premium, and your account must be in **User Management**. |
| "Could not reach Last.fm through the /lastfm proxy" | Make sure `vercel.json` was uploaded to the root of the repository, then redeploy. When running locally, use `npm run dev`. |
| A playlist shows "already exists that this app didn't create" | Rename that playlist in Spotify, or type a different name in the name box here. |
| Cover art not uploaded | Disconnect and connect again so Spotify can ask for the image-upload permission. |
| Page shows a blank screen on `/callback` after a redeploy | Open the site's main address and connect again. |

## Privacy and safety
- Your keys are held in your browser only: this tab by default, or this device if you tick **Remember my keys**. **Disconnect and clear keys** removes them.
- Last.fm requests pass through your own site's `/lastfm` path (a Vercel rewrite) because browsers block direct calls. Nothing is stored there, but your Last.fm key is part of the request, as with any Last.fm call.
- Analysis only reads your Liked Songs. Playlists are changed only when you click the button, and only playlists created by this app (marked in their description). Liked Songs and your other playlists are never touched.
- Spotify permissions requested: read Liked Songs, read your playlists, edit your private playlists, upload playlist covers.

## Notes
- If you rename a playlist after it was created, the next update creates a new playlist under the new name and lists the old one as left unchanged. Delete the old one in Spotify.
- Automatic scheduled refresh is not available in this version because a static site cannot run while your browser is closed.
