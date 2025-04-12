/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./event-details.html",
    "./settings.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}", // Scan Vue and TS files
  ],
  theme: {
    extend: {
      colors: {
        'theme-bg-dark': '#181a1d',      // Very dark grey background
        'theme-bg-panel': '#2d3035',     // Panel/Top Bar background
        'theme-accent-blue': '#90b6f0',  // Light blue accent (nav, path)
        'theme-accent-orange': '#f0a070', // Orange accent (buttons)
        'theme-text-light': '#e5e7eb',   // Light grey text
        'theme-text-white': '#ffffff',   // White text
        'theme-border': '#3a3d42',       // Subtle border color
      } // Added missing comma here
    },
  },
  plugins: [],
}