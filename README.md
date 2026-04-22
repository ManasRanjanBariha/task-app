# TaskFlow - PWA Setup Guide

TaskFlow is now a **Progressive Web App (PWA)** that works offline and can be installed on your device!

## 🚀 Getting Started

### Option 1: Local Web Server (Recommended)
```bash
# Using Python 3
python -m http.server 8000

# Using Python 2
python -m SimpleHTTPServer 8000

# Using Node.js (with http-server)
npx http-server
```

Then open `http://localhost:8000` in your browser.

### Option 2: Direct File Access
Simply open `index.html` directly in your browser. This will work but some features may be limited.

---

## 📱 Install as App

### Desktop (Chrome/Edge)
1. Open the app in your browser
2. Click the **Install** button in the address bar (or menu ⋮ > "Install app")
3. The app will be added to your desktop/applications

### Mobile (iOS/Android)
1. Open the app in your browser
2. Tap **Share** → **Add to Home Screen**
3. The app will be added to your home screen

---

## 💾 Data Storage

### LocalStorage (Automatic)
- Data is automatically saved to browser localStorage
- Works offline
- Data persists between sessions

### JSON File (Optional)
1. Go to **Settings** → **Select Data File**
2. Choose where to save `taskflow-data.json`
3. All changes auto-save to this file
4. Use **Import JSON** to load data from a file

---

## 🔄 Offline Features

✅ **Works Completely Offline**
- All core features work without internet
- Data syncs when back online
- Cached assets load instantly

✅ **Auto-Caching**
- All app assets are cached automatically
- External CDN resources cached on first load

---

## 📋 File Structure

```
task-app/
├── index.html          # Main app (PWA-enabled)
├── index.js            # App logic + storage
├── index.css           # Styles
├── manifest.json       # PWA app configuration
├── sw.js               # Service Worker (offline support)
└── README.md           # This file
```

---

## 🐛 Troubleshooting

### "Install button not showing"
- Must be served over HTTP/HTTPS (use a local server)
- Service Worker must be registered successfully
- Check browser console for errors

### "Data not saving"
- Try "Select Data File" in Settings
- Check if localStorage is enabled
- Try exporting/importing JSON as backup

### "Service Worker not registering"
- Use a local server (not `file://`)
- Check console for any security errors
- Clear browser cache and reload

---

## 🛠️ Browser Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| PWA Install | ✅ | ✅ | ⚠️* | ✅ |
| Service Worker | ✅ | ✅ | ✅ | ✅ |
| LocalStorage | ✅ | ✅ | ✅ | ✅ |
| File System API | ✅ | ✅ | ✅ | ✅ |

*Safari: Use "Add to Home Screen" instead of install

---

## 📝 Version Info

- **Version**: 2.0.0 (PWA)
- **Last Updated**: April 2026
- **License**: MIT

Enjoy TaskFlow! 🎉
