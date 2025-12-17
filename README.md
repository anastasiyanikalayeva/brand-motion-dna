# Brand Motion DNA // AI DevTool 🧬

A creative developer tool that analyzes websites to extract "Motion DNA" for HTML5 banners. It uses Headless Chrome (Puppeteer) to scrape visual styles and Google Gemini AI to generate animation recommendations.

## 🚀 Features

*   **CTA Detective:** Finds the primary buttons, extracts exact RGB colors, Border Radius, and triggers Hover states to capture transitions.
*   **Font Sniffer:** Intercepts network traffic to find direct `.woff2` download links.
*   **AI Art Director:** Analyzes the CSS data to suggest a "Mood", specific GSAP easing curves, and animation direction.
*   **Anti-Cookie Logic:** Smart filtering to ignore Cookie Consent banners and focus on real UI elements.

## 🛠 Tech Stack

*   **Frontend:** HTML5, CSS (Cyber/Terminal Style), Vanilla JS
*   **Backend:** Node.js, Express
*   **Browser Automation:** Puppeteer
*   **AI:** Google Gemini API

## 📦 Installation

1.  Clone the repo
    ```bash
    git clone https://github.com/yourusername/brand-motion-tool.git
    ```
2.  Install NPM packages
    ```bash
    npm install
    ```
3.  Create a `.env` file and add your Google Gemini API Key:
    ```env
    GEMINI_API_KEY=AIzaSy...
    ```
4.  Run the server
    ```bash
    npm start
    ```
5.  Open `http://localhost:3000`

## ☁️ Deployment

Hosted on **Render.com**.
Requires `PUPPETEER_CACHE_DIR` environment variable set to `/opt/render/project/src/.cache/puppeteer`.