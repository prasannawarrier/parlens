# Parlens Mirror Creation

This guide explains how to create your own mirror of Parlens and release it on the web using GitHub Pages—completely free!

## 1. Fork the Repository

"Forking" creates your own copy of the project that you can edit.

1. Go to the main repository page (the one you are looking at now).
2. Click the **Fork** button in the top right corner.
3. Click "Create fork". You now have your own version at `github.com/YOUR_USERNAME/parlens-pwa`.

## 2. Enable GitHub Pages

GitHub Pages is a free service that hosts your website.

1. Go to your new repository's **Settings** tab.
2. On the left sidebar, click **Pages**.
3. Under **Build and deployment**, select **Source** as "GitHub Actions" (if available) OR "Deploy from a branch".
   * *If using "Deploy from a branch":* Select `gh-pages` branch (This branch is created automatically after you run the deploy script below).

## 3. Clone to Your Computer (Optional)

If you want to make changes or run the deploy script manually:

1. Open your terminal (Command Prompt on Windows, Terminal on Mac).
2. Type `git clone` and paste your repository URL:
   ```bash
   git clone https://github.com/YOUR_USERNAME/parlens-pwa.git
   ```
3. Go into the folder:
   ```bash
   cd parlens-pwa
   ```
4. Install the software dependencies:
   ```bash
   npm install
   ```

## 4. Deploy the App

To publish your app to the web:

1. In your terminal, run:
   ```bash
   npm run deploy
   ```
2. This command builds the app and pushes it to the `gh-pages` branch.
3. Wait about 2-3 minutes.
4. Your app will be live at: `https://YOUR_USERNAME.github.io/parlens-pwa/`

## Troubleshooting

- **Page 404 Not Found?**
  - Make sure `vite.config.ts` matches your repository name.
  - Look for this line: `base: '/parlens-pwa/',`
  - If your repo is named something else, change `/parlens-pwa/` to `/YOUR-REPO-NAME/`.

- **White Screen?**
  - Check the Console in your browser's Developer Tools (F12) for errors.
  - Ensure all dependencies installed correctly with `npm install`.
