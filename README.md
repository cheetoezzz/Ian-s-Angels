# Pickleball Queue

A simple, offline-first Progressive Web App (PWA) for managing fair player rotation on a single pickleball court.

## Features

- **Session-Based Play**: Organize games into sessions for better tracking
- **Fair Queue Algorithm**: Players with fewer games played are always prioritized
- **Offline-First**: Works without internet after initial load
- **No Installation Required**: Runs directly in the browser
- **Local Data Storage**: All data saved to browser localStorage
- **JSON Backup**: Export and import your data for backup or transfer
- **Mobile-Friendly**: Designed for touch screens and mobile use
- **PWA Support**: Installable on Android devices via "Add to Home Screen"
- **Data Migration**: Automatically migrates old data structure to new session-based format

## How to Run Locally

1. Download or clone all files to a folder on your computer
2. Open `index.html` directly in any modern web browser (Chrome, Firefox, Safari, Edge)
3. The app will work immediately - no installation or build process required

## How to Test on Android Phone

### Option 1: GitHub Pages (Recommended)

1. Create a GitHub repository and upload all files
2. Enable GitHub Pages in repository settings
3. Open the GitHub Pages URL on your Android Chrome browser
4. Tap the browser menu (three dots)
5. Tap "Add to Home screen"
6. The app will be installed and behave like a native app

### Option 2: Other Free Hosting

You can also use these free hosting services:
- **Netlify**: Drag and drop the folder to netlify.com
- **Vercel**: Import the project or drag and drop
- **Surge.sh**: Run `surge` in the folder (requires Node.js)
- **Any static web hosting**: Upload files to any web server

### Option 3: Local Network

1. Host the files on a local web server (e.g., using Python's `http.server`)
2. Find your computer's local IP address
3. Access the URL from your phone on the same WiFi network
4. Add to home screen from Chrome

## Important Notes

### This is a PWA, Not an APK

- This is a **Progressive Web App**, not a native Android app
- It does **not** require:
  - Node.js
  - npm
  - Expo
  - React Native
  - Flutter
  - Android Studio
  - Gradle
  - Any build tools
  - Any backend server
  - Firebase or cloud storage
  - Login or authentication

### Data Storage

- All data is saved **locally** in your browser/device using localStorage
- Data persists even after closing the browser
- Data persists even after restarting your phone
- Use the **Export JSON Backup** feature to save your data externally
- Use the **Import JSON Backup** feature to restore data or transfer to another device

### Internet Requirement

- Internet is **only required** for the initial load
- Once loaded, the app works **completely offline**
- The service worker caches all files for offline use

## Usage Guide

### Adding Players

1. Go to the "Queue" tab
2. Enter a player name in the input field
3. Click "Add Player"
4. The player will be added as active by default

### Managing Players

- **Activate/Deactivate**: Use the toggle switch next to each player
  - Only active players are eligible for games
  - Inactive players are excluded from the queue
- **Remove**: Click the "Remove" button to delete a player
  - You cannot remove a player currently in an active game

### Starting a Session

1. Go to the "Queue" tab
2. Ensure you have added players and activated them
3. Click "Start New Session"
4. A new session will be created with the current date/time
5. You can now generate games within this session

**Note**: You must start a session before generating games. Games are organized within sessions for better tracking.

### Generating a Game

1. Ensure you have an active session
2. Ensure you have at least 4 active players
3. Click "Generate Next Game"
4. The app will select 4 players using the fair queue algorithm:
   - Players with fewer games played are prioritized
   - Among equal games played, those who waited longer are prioritized
   - Among equal wait times, those who played least recently are prioritized
   - Randomness is only used as a final tie-breaker
5. The selected players are split into Team A and Team B (2 players each)

### Completing a Game

1. After the game is finished, click "Complete Game"
2. The 4 players' games played count will increase
3. The game is saved to the active session
4. The queue is updated for the next game

### Canceling a Game

1. If you need to cancel a generated game, click "Cancel Current Game"
2. The game is removed without saving to history
3. No player statistics are updated
4. The session remains active

### Ending a Session

1. Go to the "Queue" tab
2. Click "End Session" in the Active Session section
3. If there's a current game, you must complete or cancel it first
4. If there are no completed games, you'll be asked to confirm
5. The session will be saved to past sessions
6. You can start a new session after ending the current one

### Viewing Past Sessions

1. Go to the "Sessions" tab
2. View all completed sessions with start/end times
3. Each session shows the number of games and players
4. Click "Expand" to view all games within a session
5. Sessions are listed in reverse chronological order

### Data Backup

#### Export JSON Backup

1. Go to the "Data" tab
2. Click "Export JSON Backup"
3. A JSON file will be downloaded with the current date in the filename
4. Save this file as a backup

#### Import JSON Backup

1. Go to the "Data" tab
2. Click "Import JSON Backup"
3. Select a previously exported JSON file
4. Confirm the import to replace all current data

#### Clear Past Sessions

1. Go to the "Data" tab
2. Click "Clear Past Sessions"
3. Confirm to delete all past sessions
4. Players and current session are not affected

#### Reset All Data

1. Go to the "Data" tab
2. Click "Reset All Data"
3. Confirm to delete everything (players, sessions, settings)
4. This cannot be undone

## Data Migration

The app automatically migrates data from the old structure to the new session-based format when you first use the updated version.

### What Gets Migrated

- **Players**: All existing players are preserved
- **Current Game**: If there was an active game, it's moved into a new active session
- **Past Games**: All past games are grouped into a single completed session named "Imported Previous Games"
- **Settings**: Game numbers are preserved, session numbers are initialized

### Migration Process

1. When you open the app with old data, it detects the old structure
2. The migration function automatically converts the data
3. The migrated data is saved to localStorage
4. The app continues to work with the new session-based structure
5. No data is lost during migration

### After Migration

- Your old games are now organized in sessions
- You can continue using the app normally
- Exported backups will use the new structure
- You can end the migrated session and start fresh sessions

## Fair Queue Algorithm Details

The selection algorithm prioritizes players in this order:

1. **Lowest games played** - Players who have played fewer games are always selected first
2. **Oldest waiting time** - Among equal games played, players who have waited longer are prioritized
3. **Least recently played** - Among equal wait times, players who played least recently are prioritized
4. **Random tie-breaker** - Only if all above criteria are equal

This ensures:
- No player keeps playing repeatedly while others are behind
- All active players' game counts stay balanced
- No player is more than 1 game ahead unless unavoidable due to player count

## Adding Custom Icons

The manifest.json references icon files (icon-192.png and icon-512.png). To add custom icons:

1. Create or find PNG images
2. Resize to 192x192 and 512x512 pixels
3. Name them `icon-192.png` and `icon-512.png`
4. Place them in the same folder as the other files
5. Refresh/reinstall the PWA to see the new icons

If you don't add icons, the app will still work but may show a default browser icon.

## File Structure

```
pickleball-queue/
├── index.html          # Main HTML file
├── styles.css          # CSS styling
├── app.js              # Application logic
├── manifest.json       # PWA manifest
├── service-worker.js   # Offline caching
├── README.md           # This file
└── (optional icons)    # icon-192.png, icon-512.png
```

## Browser Compatibility

- Chrome/Edge (recommended for PWA features)
- Firefox
- Safari (iOS PWA support varies)
- Any modern browser with localStorage support

## Troubleshooting

### App won't install on Android

- Ensure you're using Chrome browser
- Make sure the site is served over HTTPS (or localhost)
- Check that manifest.json is accessible
- Try clearing browser cache and reloading

### Data not saving

- Ensure localStorage is enabled in your browser
- Check browser privacy/incognito mode (localStorage may be disabled)
- Try a different browser

### Service worker not registering

- Ensure files are served via HTTP (not file://) for service worker to work
- For local testing, use a local server or upload to hosting
- Service workers require HTTPS or localhost

## License

Free to use and modify for personal or commercial purposes.

## Support

This is a simple, standalone application with no external dependencies. If you encounter issues:
- Check that all files are in the same folder
- Ensure you're using a modern browser
- Try clearing browser cache
- Check browser console for errors (F12 → Console)
#   I a n - s - A n g e l s  
 