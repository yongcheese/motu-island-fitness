# Motu

> 你的島嶼健身生活

A gamified 3D fitness application built with React, Three.js, and Firebase.
（Motu：玻里尼西亞語的「小島」。）

## Features
- **3D Tropical Island**: A beautiful scene with an animating ocean, a soft grass island, and a cute avatar.
- **AI Fitness Tracking**: placeholder for AI camera detection to guide your workouts.
- **Rewards System**: Earn gold from workouts to buy items in the shop.
- **Customization**: Use the shop and dressing room to style your island life.
- **Social & Progress**: Level up and track your XP as you exercise.

## Tech Stack
- **Frontend**: React 19, Vite, Tailwind CSS 4.
- **3D Engine**: @react-three/fiber, @react-three/drei, Three.js.
- **Database/Auth**: Firebase Firestore & Google Auth.
- **Animations**: Motion (framer-motion).

## Local Development Setup (如何在本機執行專案)

Since this is a modern React, TypeScript, and Vite-based development web application, **you cannot open it directly by double-clicking the `index.html` file** in your computer's browser. Directly double-clicking `index.html` will result in a blank page because browsers restrict local file execution (CORS) and cannot natively compile TypeScript.

To open and run the application on your computer, please follow these standard steps:

### Prerequisites (一、準備環境)
1. **Install Node.js**: Ensure you have Node.js installed on your computer. If not, download and install the recommended (LTS) version from [nodejs.org](https://nodejs.org/).
2. **Setup a Code Editor (Optional)**: It is recommended to use [Visual Studio Code](https://code.visualstudio.com/) to view or modify code.

---

### Step-by-Step Guide (二、執行步驟)

1. **Unzip the downloaded project folder** (解妥開壓縮檔)
   Unzip the exported ZIP file to a folder on your computer.

2. **Open your Terminal / Command Prompt** (打開終端機或命令提示字元)
   * Windows: Press `Win + R`, type `cmd`, and press Enter. Then use the command `cd` to navigate to the unzipped project folder.
   * macOS / Linux: Open the **Terminal** app, and type `cd ` (and drag your project folder into the terminal, then press Enter).

3. **Install Dependencies** (下載並安裝相依套件)
   Run the following terminal command. This downloads all required libraries (e.g., React, Three.js, Firebase) listed in `package.json`:
   ```bash
   npm install
   ```

4. **Environment Variables Config (Optional)** (配置環境變數，非必要)
   If you plan to use AI features powered by Gemini:
   * Copy the file `.env.example` and rename it to `.env`.
   * Open `.env` in a text editor and paste your own Gemini API key:
     ```env
     GEMINI_API_KEY="your_actual_gemini_api_key_here"
     ```

5. **Start the Local Development Server** (啟動本機開發伺服器)
   Run the following command to start Vite:
   ```bash
   npm run dev
   ```

6. **View the Application** (在瀏覽器中開啟)
   Once Started, look at your terminal output. It will show a URL (normally http://localhost:3000).
   * Open your web browser (Chrome, Edge, Safari, etc.) and navigate to:
     **[http://localhost:3000](http://localhost:3000)** (or the port specified in terminal).

---

## Technical Details & Production Build
To create a production-optimized build of the static files:
```bash
npm run build
```
This compile steps will bundle the assets into the `/dist` directory, ready to be served by any static host.
